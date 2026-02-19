/**
 * Debug: Verificar busca para oxalato
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

const envContent = readFileSync('.env', 'utf-8');
const lines = envContent.split('\n');
let supabaseUrl, supabaseKey;

for (const line of lines) {
  if (line.startsWith('VITE_SUPABASE_URL=')) {
    supabaseUrl = line.split('=')[1].trim().replace(/"/g, '');
  }
  if (line.startsWith('VITE_SUPABASE_PUBLISHABLE_KEY=') || line.startsWith('VITE_SUPABASE_ANON_KEY=')) {
    supabaseKey = line.split('=')[1].trim().replace(/"/g, '');
  }
}

const supabase = createClient(supabaseUrl, supabaseKey);

console.log('🔍 Testando: "como tratar caes com oxalato de calcio?"\n');

const { data, error } = await supabase.functions.invoke('ask-document', {
  body: { question: 'como tratar caes com oxalato de calcio?' }
});

if (error) {
  console.error('❌ Erro:', error);
} else {
  console.log('📊 RESPOSTA:\n', data.answer);
  console.log('\n📚 CITAÇÕES:', data.references);
  console.log('\n🔎 DOCUMENTOS ENCONTRADOS:');
  if (data.all_relevant_sources) {
    data.all_relevant_sources.forEach(doc => {
      console.log(`  ${doc.cited ? '✅' : '❌'} ${doc.filename} (${(doc.score * 100).toFixed(2)}%)`);
    });
  }
}
