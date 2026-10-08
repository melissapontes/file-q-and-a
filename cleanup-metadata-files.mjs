// Remove do vector store os arquivos "_metadata.txt" legados e limpa documents.metadata_file_id.
// Uso (PowerShell):  $env:OPENAI_API_KEY="sk-..."; $env:OPENAI_VECTOR_STORE_ID="vs_..."; $env:SUPABASE_SERVICE_ROLE_KEY="..."
//   node cleanup-metadata-files.mjs          -> só lista (dry-run)
//   node cleanup-metadata-files.mjs --apply  -> apaga de verdade
import fs from 'node:fs';

const apply = process.argv.includes('--apply');
const { OPENAI_API_KEY, OPENAI_VECTOR_STORE_ID, SUPABASE_SERVICE_ROLE_KEY } = process.env;
const SUPABASE_URL = fs.readFileSync('.env', 'utf8').match(/VITE_SUPABASE_URL="([^"]+)"/)?.[1];
if (!OPENAI_API_KEY || !OPENAI_VECTOR_STORE_ID) throw new Error('Defina OPENAI_API_KEY e OPENAI_VECTOR_STORE_ID');

const oa = (path, init = {}) => fetch(`https://api.openai.com/v1${path}`, {
  ...init,
  headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, 'OpenAI-Beta': 'assistants=v2', ...(init.headers || {}) },
});

// 1) lista todos os arquivos do vector store e filtra os *_metadata.txt
const targets = [];
let after = '';
do {
  const page = await (await oa(`/vector_stores/${OPENAI_VECTOR_STORE_ID}/files?limit=100${after}`)).json();
  for (const vf of page.data ?? []) {
    const f = await (await oa(`/files/${vf.id}`)).json();
    if (f.filename?.endsWith('_metadata.txt')) targets.push({ id: vf.id, name: f.filename });
  }
  after = page.has_more ? `&after=${page.last_id}` : '';
} while (after);

console.log(`${targets.length} arquivo(s) de metadados encontrados:`);
targets.forEach(t => console.log(' -', t.name, t.id));
if (!apply) { console.log('\nDry-run. Rode com --apply para apagar.'); process.exit(0); }

// 2) remove do vector store e apaga o arquivo
for (const t of targets) {
  await oa(`/vector_stores/${OPENAI_VECTOR_STORE_ID}/files/${t.id}`, { method: 'DELETE' });
  await oa(`/files/${t.id}`, { method: 'DELETE' });
  console.log('apagado:', t.name);
}

// 3) limpa a coluna no banco (opcional, precisa da service role)
if (SUPABASE_SERVICE_ROLE_KEY && SUPABASE_URL) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/documents?metadata_file_id=not.is.null`, {
    method: 'PATCH',
    headers: { apikey: SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ metadata_file_id: null }),
  });
  console.log('documents.metadata_file_id limpo:', r.status);
}
