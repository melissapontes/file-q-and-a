/**
 * Testa a busca no Vector Store para debug
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';

// Ler variáveis do .env
let supabaseUrl, supabaseKey;
try {
  const envContent = readFileSync('.env', 'utf-8');
  const lines = envContent.split('\n');
  for (const line of lines) {
    if (line.startsWith('VITE_SUPABASE_URL=')) {
      supabaseUrl = line.split('=')[1].trim().replace(/"/g, '');
    }
    if (line.startsWith('VITE_SUPABASE_PUBLISHABLE_KEY=') || line.startsWith('VITE_SUPABASE_ANON_KEY=')) {
      supabaseKey = line.split('=')[1].trim().replace(/"/g, '');
    }
  }
} catch (e) {
  console.error('❌ Erro ao ler .env:', e.message);
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testSearch() {
  console.log('🔍 Testando busca no Vector Store...\n');

  try {
    const { data, error } = await supabase.functions.invoke('debug-search', {
      body: { query: 'incontinência urinária cães tratamento ACVIM' }
    });
    
    if (error) {
      console.error('❌ Erro:', error);
      return;
    }

    console.log('📊 RESULTADO DO TESTE:\n');
    console.log('━'.repeat(80));
    console.log('\n📝 Query testada:', data.query);
    console.log('\n🔍 Documentos encontrados pelo file_search:');
    
    if (data.steps && data.steps.length > 0) {
      for (const step of data.steps) {
        if (step.type === 'tool_calls') {
          for (const toolCall of step.step_details.tool_calls) {
            if (toolCall.type === 'file_search' && toolCall.file_search?.results) {
              console.log(`\n   Total: ${toolCall.file_search.results.length} documentos`);
              toolCall.file_search.results.forEach((result, idx) => {
                console.log(`\n   ${idx + 1}. File ID: ${result.file_id || result[0]}`);
                console.log(`      Score: ${result.score || 'N/A'}`);
              });
            }
          }
        }
      }
    }

    console.log('\n\n💬 Resposta da IA:');
    console.log('━'.repeat(80));
    console.log(data.response);
    
    console.log('\n\n📎 Annotations (citações):');
    console.log('━'.repeat(80));
    if (data.annotations && data.annotations.length > 0) {
      data.annotations.forEach((ann, idx) => {
        console.log(`\n${idx + 1}. Tipo: ${ann.type}`);
        if (ann.file_citation) {
          console.log(`   File ID: ${ann.file_citation.file_id}`);
          console.log(`   Quote: ${ann.file_citation.quote?.substring(0, 100)}...`);
        }
      });
    } else {
      console.log('⚠️  Nenhuma citação encontrada!');
    }

    console.log('\n' + '━'.repeat(80));

    console.log('\n\n🔍 DIAGNÓSTICO:');
    if (data.steps && data.steps.some(s => s.step_details?.tool_calls?.some(tc => tc.file_search?.results?.length > 0))) {
      console.log('✅ A busca ENCONTROU documentos no Vector Store');
      if (data.annotations && data.annotations.length > 0) {
        console.log('✅ A IA CITOU os documentos na resposta');
        console.log('\n💡 O sistema está funcionando corretamente!');
      } else {
        console.log('❌ A IA NÃO CITOU os documentos, mesmo tendo encontrado');
        console.log('\n🔧 Problema: As instruções impedem a IA de usar os documentos');
        console.log('   Solução: Simplificar ainda mais as instruções do assistente');
      }
    } else {
      console.log('❌ A busca NÃO encontrou documentos relevantes');
      console.log('\n🔧 Possíveis causas:');
      console.log('   1. Documento não tem texto extraível (PDF de imagens)');
      console.log('   2. Indexação do Vector Store falhou');
      console.log('   3. Conteúdo do documento não corresponde à busca');
      console.log('\n📝 Próximos passos:');
      console.log('   1. node list-vector-docs.js - confirmar que arquivo existe');
      console.log('   2. Verificar se PDF tem texto selecionável (não é scan)');
      console.log('   3. Re-upload do documento se necessário');
    }

    console.log('\n');

  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

testSearch();
