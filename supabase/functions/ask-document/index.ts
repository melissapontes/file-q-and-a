// Pergunta → busca híbrida no pgvector → resposta do Gemini com citações. Sem OpenAI.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import {
  buildTsQuery,
  detectQuestionSpecies,
  embedTexts,
  geminiGenerate,
  toPgVector,
} from "../_shared/rag.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-gemini-key',
};

const SYSTEM_INSTRUCTIONS = `Voce e um assistente especialista em nefrologia e urologia veterinaria.

REGRAS DE GROUNDING (OBRIGATORIAS):
1. Use APENAS os TRECHOS fornecidos na mensagem do usuario.
2. Se os trechos nao contiverem informacao suficiente para responder, diga: "Nao encontrei informacoes suficientes sobre [topico] nos documentos disponiveis." Nao complemente com conhecimento proprio.
3. Cite o trecho [N] SOMENTE quando a informacao especifica que voce esta afirmando veio do texto desse trecho. Se voce nao pode apontar o trecho exato, nao cite.
4. NUNCA invente dados, dosagens, valores de referencia ou diagnosticos. Copie doses, unidades, vias e frequencias exatamente como estao no trecho.

FORMATO DE RESPOSTA:
- Organize em topicos numerados quando houver multiplos pontos
- Inclua detalhes especificos quando presentes: medicamentos, dosagens (em **negrito**), via de administracao, frequencia, valores de referencia
- Use citacoes [1], [2] imediatamente apos cada informacao, com o numero do TRECHO. Para varios trechos use [1][3]
- A lista de referencias sera gerada automaticamente; nao a escreva

IDIOMA:
- SEMPRE responda em PORTUGUES (pt-BR)
- Os documentos podem estar em ingles, mas sua resposta deve ser em portugues`;

const MATCH_COUNT = 8;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  try {
    // TEMPORÁRIO: x-gemini-key só vale enquanto o secret GEMINI_API_KEY não está gravado no projeto. Remover depois.
    const geminiKey = Deno.env.get('GEMINI_API_KEY') || req.headers.get('x-gemini-key');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!geminiKey) throw new Error('GEMINI_API_KEY não configurada nas Edge Functions');

    const supabase = createClient(supabaseUrl, serviceKey);
    const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authError || !user) return json({ error: 'Unauthorized' }, 401);

    // ── Entrada: JSON ou multipart (com arquivos/imagens anexados à pergunta) ──
    const contentType = req.headers.get('content-type') || '';
    let question = '';
    const attachmentParts: any[] = [];
    let attachedText = '';

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData();
      question = (formData.get('question') as string) || '';
      for (const file of formData.getAll('files') as File[]) {
        try {
          const name = file.name.toLowerCase();
          const bytes = new Uint8Array(await file.arrayBuffer());
          if (/\.(jpe?g|png)$/.test(name)) {
            attachmentParts.push({ inline_data: { mime_type: file.type || 'image/jpeg', data: toBase64(bytes) } });
          } else if (name.endsWith('.pdf')) {
            attachmentParts.push({ inline_data: { mime_type: 'application/pdf', data: toBase64(bytes) } });
          } else {
            attachedText += `\n\n[Arquivo anexado: ${file.name}]\n${new TextDecoder().decode(bytes).slice(0, 20000)}`;
          }
        } catch (e) {
          console.error(`Erro ao processar anexo ${file.name}:`, e);
        }
      }
    } else {
      question = (await req.json()).question;
    }
    if (!question) throw new Error('Question is required');
    console.log('Question:', question);

    // ── Contexto determinístico (sem IA) ──
    const species = detectQuestionSpecies(question);
    const speciesFilter = species === 'cat' || species === 'dog' ? species : null;
    const isProtocolQuery = /protocolo/i.test(question);

    // ── Busca: embedding da pergunta + busca híbrida com filtro de espécie ──
    const [queryEmbedding] = await embedTexts([question], 'RETRIEVAL_QUERY', geminiKey, Date.now() + 20_000);
    const { data: matches, error: matchError } = await supabase.rpc('match_chunks', {
      query_embedding: toPgVector(queryEmbedding),
      query_text: buildTsQuery(question),
      p_species: speciesFilter,
      match_count: MATCH_COUNT,
    });
    if (matchError) throw new Error(`Falha na busca: ${matchError.message}`);
    const chunks: any[] = matches || [];
    console.log(`Retrieved ${chunks.length} chunks (species filter: ${speciesFilter ?? 'none'})`);

    // ── Prompt ──
    const pageLabel = (c: any) => c.page_start === c.page_end || !c.page_end ? `p. ${c.page_start}` : `p. ${c.page_start}-${c.page_end}`;
    const context = chunks.length
      ? chunks.map((c, i) => `[${i + 1}] Fonte: ${c.original_name} (${pageLabel(c)})\n${c.content}`).join('\n\n---\n\n')
      : '(nenhum trecho encontrado)';

    const extra: string[] = [];
    if (speciesFilter === 'cat') extra.push('A pergunta é sobre GATOS. Se um trecho tratar apenas de cães, NÃO use suas doses ou valores; se só houver dados de cães, informe isso explicitamente.');
    if (speciesFilter === 'dog') extra.push('A pergunta é sobre CÃES. Se um trecho tratar apenas de gatos, NÃO use suas doses ou valores; se só houver dados de gatos, informe isso explicitamente.');
    if (isProtocolQuery) extra.push('Esta pergunta é sobre protocolo de tratamento: inclua medicamentos, doses (em **negrito**), via de administração e frequência. Se os trechos não trouxerem doses, informe isso explicitamente.');

    const userText = `TRECHOS DOS DOCUMENTOS:\n\n${context}\n\n=====\n${attachedText ? `Material anexado pelo usuário:${attachedText}\n\n` : ''}PERGUNTA: ${question}`;

    const data = await geminiGenerate({
      systemInstruction: { parts: [{ text: [SYSTEM_INSTRUCTIONS, ...extra].join('\n\n') }] },
      contents: [{ role: 'user', parts: [...attachmentParts, { text: userText }] }],
      generationConfig: { temperature: 0, maxOutputTokens: 4096 },
    }, geminiKey);
    console.log(`Answered with model ${data._model}`);

    const rawAnswer: string = data.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') ?? '';

    // ── Citações: [n] do modelo → documentos reais (valida, renumera por documento) ──
    const docNumber = new Map<string, number>(); // original_name → nº da referência
    const references: string[] = [];
    const citedChunkIdx = new Set<number>();

    let answer = rawAnswer.trim() || 'Desculpe, não consegui gerar uma resposta.';
    answer = answer.replace(/\[(\d+(?:\s*[,;]\s*\d+)*)\]/g, (_m, list: string) => {
      const nums: number[] = [];
      for (const raw of list.split(/[,;]/)) {
        const idx = parseInt(raw.trim(), 10) - 1;
        const chunk = chunks[idx];
        if (!chunk) continue; // citação inventada: removida
        citedChunkIdx.add(idx);
        if (!docNumber.has(chunk.original_name)) {
          docNumber.set(chunk.original_name, references.length + 1);
          references.push(chunk.original_name);
        }
        const n = docNumber.get(chunk.original_name)!;
        if (!nums.includes(n)) nums.push(n);
      }
      return nums.map((n) => `[${n}]`).join('');
    });
    // [1][1][1] → [1] (vários trechos do mesmo documento seguidos)
    answer = answer.replace(/(\[(\d+)\])(?:\s*\[\2\])+/g, '$1');

    // ── Fontes consultadas (uma por documento) ──
    const allRelevantSources: any[] = [];
    const seen = new Set<string>();
    chunks.forEach((c, i) => {
      if (seen.has(c.document_id)) return;
      seen.add(c.document_id);
      allRelevantSources.push({
        file_id: c.document_id,
        filename: c.original_name,
        score: c.score,
        cited: chunks.some((x, j) => x.document_id === c.document_id && citedChunkIdx.has(j)),
        pages: chunks.filter((x) => x.document_id === c.document_id).map(pageLabel),
      });
    });

    // ── Log ──
    try {
      await supabase.from('rag_query_logs').insert({
        question,
        documents_fetched: seen.size,
        documents_analyzed: chunks.map((c, i) => ({
          filename: c.original_name, pages: pageLabel(c), score: c.score, cited: citedChunkIdx.has(i),
        })),
        final_selection: `hybrid_search: ${chunks.length} trechos, ${citedChunkIdx.size} citados, modelo ${data._model}`,
        answer_preview: answer.substring(0, 500) + (answer.length > 500 ? '...' : ''),
        status: 'success',
      });
    } catch (e) {
      console.log('Could not save query log:', e);
    }

    return json({
      answer,
      references,
      all_relevant_sources: allRelevantSources,
      stats: {
        total_consulted: allRelevantSources.length,
        total_cited: references.length,
        consultation_coverage: `${references.length}/${allRelevantSources.length} documentos citados`,
      },
    });
  } catch (error) {
    console.error('Error in ask-document function:', error);
    return json({
      error: error instanceof Error ? error.message : 'Erro interno do servidor',
      details: error instanceof Error ? error.stack || '' : '',
    }, 500);
  }
});
