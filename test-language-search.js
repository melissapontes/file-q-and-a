/**
 * Test: Query em inglês para documento UTI
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

console.log('🔍 Teste 1: Query em PORTUGUÊS\n');
let { data, error } = await supabase.functions.invoke('ask-document', {
  body: { question: 'como tratar infeccao urinaria em caes?' }
});

if (!error && data.all_relevant_sources) {
  console.log('Documentos encontrados:');
  data.all_relevant_sources.forEach(doc => {
    console.log(`  - ${doc.filename} (${(doc.score * 100).toFixed(2)}%)`);
  });
}

console.log('\n🔍 Teste 2: Query em INGLÊS\n');
({ data, error } = await supabase.functions.invoke('ask-document', {
  body: { question: 'how to treat urinary tract infections in dogs?' }
}));

if (!error && data.all_relevant_sources) {
  console.log('Documentos encontrados:');
  data.all_relevant_sources.forEach(doc => {
    console.log(`  - ${doc.filename} (${(doc.score * 100).toFixed(2)}%)`);
  });
}

console.log('\n🔍 Teste 3: Query específica sobre antibióticos\n');
({ data, error } = await supabase.functions.invoke('ask-document', {
  body: { question: 'what antibiotics to use for UTI in dogs?' }
}));

if (!error && data.all_relevant_sources) {
  console.log('Documentos encontrados:');
  data.all_relevant_sources.forEach(doc => {
    console.log(`  - ${doc.filename} (${(doc.score * 100).toFixed(2)}%)`);
  });
}
