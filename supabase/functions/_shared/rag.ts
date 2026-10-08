// Módulo compartilhado do RAG próprio (Gemini + pgvector).
import { getDocumentProxy, extractText } from "npm:unpdf@0.12.1";
import { Buffer } from "node:buffer";

export const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
export const EMBED_MODEL = 'gemini-embedding-001';
export const EMBED_DIM = 768;

// ───────────────────────── Espécie (sem IA) ─────────────────────────
export type Species = 'cat' | 'dog' | 'both';

const CAT_RE = /\b(gatos?|gatas?|felinos?|felinas?|cats?|feline|felis)\b/gi;
const DOG_RE = /\b(c[aã]es|c[aã]o|cachorros?|cadelas?|caninos?|caninas?|dogs?|canine|canis)\b/gi;

const count = (re: RegExp, text: string) => (text.match(re) || []).length;

/** Espécie citada numa pergunta: 'cat' | 'dog' | 'both' (as duas) | null (nenhuma). */
export function detectQuestionSpecies(text: string): Species | null {
  const cat = count(CAT_RE, text) > 0;
  const dog = count(DOG_RE, text) > 0;
  if (cat && dog) return 'both';
  if (cat) return 'cat';
  if (dog) return 'dog';
  return null;
}

/** Espécie de um documento, a partir do nome, das tags e da frequência no texto. */
export function detectDocumentSpecies(name: string, tags: string[], text: string): Species {
  const head = `${name} ${tags.join(' ')}`;
  const nameCat = count(CAT_RE, head), nameDog = count(DOG_RE, head);
  if (nameCat > 0 && nameDog === 0) return 'cat';
  if (nameDog > 0 && nameCat === 0) return 'dog';
  if (nameCat > 0 && nameDog > 0) return 'both';
  const sample = text.slice(0, 40000);
  const c = count(CAT_RE, sample), d = count(DOG_RE, sample);
  if (c >= 8 && c >= d * 5) return 'cat';
  if (d >= 8 && d >= c * 5) return 'dog';
  return 'both';
}

// ───────────────────────── Texto → trechos ─────────────────────────
export type Page = { page: number; text: string };
export type Chunk = { index: number; pageStart: number; pageEnd: number; content: string };

const TARGET_CHARS = 1800;
const OVERLAP_CHARS = 250;

export function chunkPages(pages: Page[]): Chunk[] {
  const chunks: Chunk[] = [];
  let buf = '';
  let startPage = pages[0]?.page ?? 1;
  let endPage = startPage;

  const flush = () => {
    const content = buf.trim();
    if (content.length > 80) {
      chunks.push({ index: chunks.length, pageStart: startPage, pageEnd: endPage, content });
    }
  };

  for (const { page, text } of pages) {
    const pieces = text
      .replace(/\r/g, '')
      .split(/\n{2,}|(?<=[.!?])\s+(?=[A-ZÀ-Ú0-9])/)
      .map((p) => p.replace(/\s+/g, ' ').trim())
      .filter(Boolean);

    for (let piece of pieces) {
      // pedaços gigantes (tabelas sem pontuação) são cortados
      while (piece.length > TARGET_CHARS) {
        const cut = piece.lastIndexOf(' ', TARGET_CHARS) > 0 ? piece.lastIndexOf(' ', TARGET_CHARS) : TARGET_CHARS;
        if (buf) { buf += ' ' + piece.slice(0, cut); } else { buf = piece.slice(0, cut); startPage = page; }
        endPage = page;
        flush();
        buf = buf.slice(-OVERLAP_CHARS);
        startPage = page;
        piece = piece.slice(cut).trim();
      }
      if (!piece) continue;
      if (!buf) startPage = page;
      buf += (buf ? ' ' : '') + piece;
      endPage = page;
      if (buf.length >= TARGET_CHARS) {
        flush();
        buf = buf.slice(-OVERLAP_CHARS);
        startPage = page;
      }
    }
  }
  flush();
  return chunks;
}

// ───────────────────────── Extração de texto ─────────────────────────
export async function extractPages(
  bytes: Uint8Array,
  fileName: string,
  mimeType: string,
  geminiKey: string,
): Promise<Page[]> {
  const lower = fileName.toLowerCase();

  if (mimeType === 'application/pdf' || lower.endsWith('.pdf')) {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const { text } = await extractText(pdf, { mergePages: false });
    const pages = (text as string[]).map((t, i) => ({ page: i + 1, text: t }));
    const total = pages.reduce((n, p) => n + p.text.trim().length, 0);
    if (total >= 200) return pages;
    // PDF escaneado (sem camada de texto): transcreve com o Gemini
    console.log(`PDF sem texto (${total} chars) — transcrevendo com Gemini`);
    return [{ page: 1, text: await geminiTranscribePdf(bytes, geminiKey) }];
  }

  if (lower.endsWith('.xlsx') || lower.endsWith('.xls') || mimeType.includes('spreadsheet') || mimeType === 'application/vnd.ms-excel') {
    const XLSX = await import('https://esm.sh/xlsx@0.18.5');
    const wb = XLSX.read(bytes, { type: 'array' });
    return wb.SheetNames.map((name: string, i: number) => ({
      page: i + 1,
      text: `Planilha: ${name}\n\n${XLSX.utils.sheet_to_csv(wb.Sheets[name])}`,
    }));
  }

  if (lower.endsWith('.docx')) {
    const mammoth = await import('npm:mammoth@1.8.0');
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return [{ page: 1, text: value }];
  }

  // txt / md
  return [{ page: 1, text: new TextDecoder().decode(bytes) }];
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

async function geminiTranscribePdf(bytes: Uint8Array, key: string): Promise<string> {
  const data = await geminiGenerate({
    contents: [{ role: 'user', parts: [
      { inline_data: { mime_type: 'application/pdf', data: toBase64(bytes) } },
      { text: 'Transcreva TODO o texto deste documento, fielmente, incluindo tabelas (use linhas separadas por |). Não resuma, não traduza, não comente.' },
    ] }],
    generationConfig: { temperature: 0, maxOutputTokens: 60000 },
  }, key);
  return data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') ?? '';
}

// ───────────────────────── Geração (com fallback de modelo) ─────────────────────────
// Modelos liberados variam por conta e ficam sobrecarregados (503); tentamos em cadeia.
export function modelChain(): string[] {
  const preferred = Deno.env.get('GEMINI_MODEL');
  const chain = ['gemini-3.7-flash', 'gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite'];
  return [...new Set([...(preferred ? [preferred] : []), ...chain])];
}

export async function geminiGenerate(body: unknown, key: string): Promise<any> {
  let lastError = '';
  for (const model of modelChain()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const resp = await fetch(`${GEMINI_BASE}/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (resp.ok) {
        const data = await resp.json();
        data._model = model;
        return data;
      }
      lastError = `${model} HTTP ${resp.status}: ${(await resp.text()).slice(0, 300)}`;
      console.warn(`Gemini falhou — ${lastError}`);
      if (resp.status === 503 || resp.status === 500) { await new Promise((r) => setTimeout(r, 1200)); continue; }
      break; // 404/429/403: próximo modelo
    }
  }
  throw new Error(`Gemini indisponível: ${lastError}`);
}

// ───────────────────────── Embeddings ─────────────────────────
export class RateLimitWait extends Error {}

export async function embedTexts(
  texts: string[],
  taskType: 'RETRIEVAL_DOCUMENT' | 'RETRIEVAL_QUERY',
  key: string,
  deadline = Infinity,
): Promise<number[][]> {
  const out: number[][] = [];
  const BATCH = 20;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    let attempt = 0;
    while (true) {
      const resp = await fetch(`${GEMINI_BASE}/models/${EMBED_MODEL}:batchEmbedContents`, {
        method: 'POST',
        headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: batch.map((t) => ({
            model: `models/${EMBED_MODEL}`,
            content: { parts: [{ text: t }] },
            taskType,
            outputDimensionality: EMBED_DIM,
          })),
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        for (const e of data.embeddings) out.push(normalize(e.values));
        break;
      }
      const errText = await resp.text();
      if (resp.status === 429 || resp.status >= 500) {
        // O Gemini informa quanto esperar: "retryDelay": "23s"
        const m = errText.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
        const waitMs = Math.min((m ? parseFloat(m[1]) * 1000 : 2000 * (attempt + 1)) + 500, 60000);
        if (/PerDay|per day/i.test(errText)) throw new Error(`Cota diária do Gemini esgotada: ${errText.slice(0, 200)}`);
        if (Date.now() + waitMs > deadline) throw new RateLimitWait(`limite do Gemini; tente de novo em ${Math.ceil(waitMs / 1000)}s`);
        if (++attempt > 6) throw new Error(`Gemini embeddings HTTP ${resp.status}: ${errText.slice(0, 300)}`);
        console.log(`Gemini ${resp.status}: aguardando ${Math.ceil(waitMs / 1000)}s`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(`Gemini embeddings HTTP ${resp.status}: ${errText.slice(0, 300)}`);
    }
  }
  return out;
}

// Vetores truncados (768 de 3072) precisam ser normalizados
function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/** pgvector aceita o formato de texto '[0.1,0.2,...]' */
export const toPgVector = (v: number[]) => `[${v.join(',')}]`;

// ───────────────────────── Busca ─────────────────────────
const STOPWORDS = new Set(('a o as os um uma de do da dos das em no na nos nas por para com sem sobre entre e ou que qual quais como quando onde ' +
  'ser ter foi sao esta estao pode podem deve devem mais menos muito muita ja nao sim se seu sua ao aos the of and for with in on to is are what how').split(' '));

/** Monta uma expressão tsquery segura ("termo1 | termo2 | ...") a partir da pergunta. */
export function buildTsQuery(question: string): string {
  const words = question
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
  return [...new Set(words)].slice(0, 12).map((w) => w.replace(/-/g, '')).filter(Boolean).join(' | ');
}

// ───────────────────────── Ingestão de um documento (retomável) ─────────────────────────
export type IngestResult = {
  id: string; name: string; status: 'completed' | 'partial' | 'skipped';
  species?: Species; chunks?: number; total?: number; pages?: number; note?: string;
};

export async function ingestDocument(
  supabase: any,
  docId: string,
  geminiKey: string,
  opts: { deadline?: number; force?: boolean } = {},
): Promise<IngestResult> {
  const deadline = opts.deadline ?? Date.now() + 90_000;
  const { data: doc, error } = await supabase
    .from('documents')
    .select('id, original_name, mime_type, storage_path, tags, processing_status, chunk_count')
    .eq('id', docId)
    .single();
  if (error || !doc) throw new Error(`Documento não encontrado: ${docId}`);
  if (!doc.storage_path) throw new Error('Documento sem arquivo no Storage');
  if (!opts.force && doc.processing_status === 'completed' && doc.chunk_count > 0) {
    return { id: docId, name: doc.original_name, status: 'skipped', chunks: doc.chunk_count };
  }

  await supabase.from('documents').update({ processing_status: 'processing', error_message: null }).eq('id', docId);

  try {
    const { data: blob, error: dlError } = await supabase.storage.from('documents').download(doc.storage_path);
    if (dlError || !blob) throw new Error(`Falha ao baixar do Storage: ${dlError?.message}`);
    const bytes = new Uint8Array(await blob.arrayBuffer());

    const pages = await extractPages(bytes, doc.original_name, doc.mime_type, geminiKey);
    const fullText = pages.map((p) => p.text).join('\n');
    const chunks = chunkPages(pages);
    if (chunks.length === 0) throw new Error('Nenhum texto extraído do documento');

    const species = detectDocumentSpecies(doc.original_name, doc.tags || [], fullText);
    const title = doc.original_name.replace(/\.[^.]+$/, '');

    // Retomada: só embute os trechos que ainda não foram gravados (a menos que force)
    if (opts.force) await supabase.from('rag_chunks').delete().eq('document_id', docId);
    const { data: existingRows } = await supabase.from('rag_chunks').select('chunk_index').eq('document_id', docId);
    const done = new Set<number>((existingRows || []).map((r: any) => r.chunk_index));
    const todo = chunks.filter((c) => !done.has(c.index));

    let stoppedEarly = '';
    const STEP = 20;
    for (let i = 0; i < todo.length; i += STEP) {
      if (Date.now() > deadline) { stoppedEarly = 'tempo da execução esgotado'; break; }
      const part = todo.slice(i, i + STEP);
      let embeddings: number[][];
      try {
        embeddings = await embedTexts(part.map((c) => `${title}\n\n${c.content}`), 'RETRIEVAL_DOCUMENT', geminiKey, deadline);
      } catch (e) {
        if (e instanceof RateLimitWait) { stoppedEarly = e.message; break; }
        throw e;
      }
      const rows = part.map((c, k) => ({
        document_id: docId, chunk_index: c.index, page_start: c.pageStart, page_end: c.pageEnd,
        content: c.content, species, embedding: toPgVector(embeddings[k]),
      }));
      const { error: insError } = await supabase.from('rag_chunks').upsert(rows, { onConflict: 'document_id,chunk_index' });
      if (insError) throw new Error(`Falha ao gravar trechos: ${insError.message}`);
      part.forEach((c) => done.add(c.index));
    }

    const complete = done.size >= chunks.length;
    await supabase.from('documents')
      .update({
        processing_status: complete ? 'completed' : 'processing',
        species, chunk_count: done.size,
        error_message: complete ? null : `Indexação parcial (${done.size}/${chunks.length}): ${stoppedEarly}`,
      })
      .eq('id', docId);
    return {
      id: docId, name: doc.original_name, status: complete ? 'completed' : 'partial',
      species, chunks: done.size, total: chunks.length, pages: pages.length, note: stoppedEarly || undefined,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await supabase.from('documents').update({ processing_status: 'error', error_message: message }).eq('id', docId);
    throw e;
  }
}
