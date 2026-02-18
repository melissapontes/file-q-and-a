/**
 * Lista documentos do Vector Store da OpenAI (fonte real do RAG)
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

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Erro: credenciais não encontradas no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function listVectorStoreFiles() {
  console.log('📚 Buscando documentos no Vector Store da OpenAI...\n');

  try {
    const { data, error } = await supabase.functions.invoke('list-vector-store-files');
    
    if (error) {
      console.error('❌ Erro ao buscar documentos:', error);
      return;
    }

    if (!data || !data.files || data.files.length === 0) {
      console.log('⚠️  Nenhum documento encontrado no Vector Store.');
      console.log('\nPara adicionar documentos:');
      console.log('1. Acesse http://localhost:8081/upload');
      console.log('2. Faça upload de arquivos PDF, TXT, MD ou DOCX');
      return;
    }

    const files = data.files;
    console.log(`✅ Total de documentos no Vector Store: ${files.length}`);
    console.log(`🆔 Vector Store ID: ${data.vectorStoreId}`);
    console.log('\n' + '━'.repeat(80));
    console.log('\n📄 DOCUMENTOS DISPONÍVEIS PARA CONSULTA NO RAG:\n');
    console.log('━'.repeat(80));

    files.forEach((file, index) => {
      console.log(`\n${index + 1}. ${file.filename || 'sem nome'}`);
      console.log(`   File ID: ${file.file_id || file.id}`);
      console.log(`   Status: ${file.status || 'N/A'}`);
    });

    console.log('\n' + '━'.repeat(80));
    console.log('\n💡 CENÁRIOS DE TESTE SUGERIDOS:\n');
    
    if (files.length > 0) {
      const firstDoc = files[0].filename || files[0].file_id;
      const secondDoc = files.length > 1 ? (files[1].filename || files[1].file_id) : null;
      
      console.log('1. Pergunta específica sobre um documento:');
      console.log(`   "O que diz ${firstDoc} sobre tratamento?"\n`);
      
      if (secondDoc) {
        console.log('2. Pergunta que pode citar múltiplos documentos:');
        console.log(`   "Quais dosagens são mencionadas nos documentos?"\n`);
      }
      
      console.log('3. Pergunta para testar cross-species (se tiver docs de cães e gatos):');
      console.log('   "Qual o tratamento para hipertensão em GATOS?"\n');
      
      console.log('4. Após fazer uma pergunta, verifique:');
      console.log('   - As referências mostram nomes de arquivos (não IDs)');
      console.log('   - Os logs da edge function mostram documentos consultados vs citados');
    }

    console.log('\n' + '━'.repeat(80));
    console.log('\n🔍 Para ver logs detalhados após uma pergunta:');
    console.log('   1. Faça deploy: supabase functions deploy ask-document');
    console.log('   2. Faça uma pergunta no RAG');
    console.log('   3. Veja os logs: supabase functions logs ask-document\n');

  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

listVectorStoreFiles();
