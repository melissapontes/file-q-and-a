/**
 * Debug: Por que o documento UTI é encontrado mas não citado?
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Ler credenciais do .env
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

console.log('🔍 Testando query: "como tratar infeccao urinaria em caes?"\n');

const { data, error } = await supabase.functions.invoke('ask-document', {
  body: { question: 'como tratar infeccao urinaria em caes?' }
});

if (error) {
  console.error('❌ Erro:', error);
} else {
  console.log('📊 RESPOSTA:\n');
  console.log(data.answer);
  console.log('\n📚 REFERÊNCIAS CITADAS:', data.references);
  console.log('\n🔎 DOCUMENTOS CONSULTADOS:');
  if (data.all_relevant_sources) {
    data.all_relevant_sources.forEach((doc, i) => {
      const icon = doc.cited ? '✅' : '❌';
      console.log(`${icon} ${i + 1}. ${doc.filename} (score: ${doc.score?.toFixed(4) || 'N/A'})`);
    });
  }
  console.log('\n📈 ESTATÍSTICAS:', data.stats);
}
