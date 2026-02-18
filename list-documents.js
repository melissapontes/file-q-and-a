/**
 * Script para listar os documentos reais no sistema RAG
 * 
 * Uso: node list-documents.js
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
}

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Erro: VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY devem estar definidos no .env');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function listDocuments() {
  console.log('📚 Buscando documentos no sistema RAG...\n');

  try {
    // Buscar todos os documentos
    const { data: documents, error } = await supabase
      .from('documents')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Erro ao buscar documentos:', error);
      return;
    }

    if (!documents || documents.length === 0) {
      console.log('⚠️  Nenhum documento encontrado no sistema.');
      console.log('\nPara adicionar documentos:');
      console.log('1. Acesse http://localhost:8081/upload');
      console.log('2. Faça upload de arquivos PDF, TXT, MD ou DOCX');
      return;
    }

    console.log(`✅ Total de documentos: ${documents.length}\n`);
    console.log('━'.repeat(80));

    // Agrupar por status
    const byStatus = documents.reduce((acc, doc) => {
      acc[doc.processing_status] = (acc[doc.processing_status] || 0) + 1;
      return acc;
    }, {});

    console.log('\n📊 STATUS DOS DOCUMENTOS:');
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`   ${status}: ${count}`);
    });
    console.log('━'.repeat(80));

    // Listar documentos prontos para busca
    const readyDocs = documents.filter(
      doc => doc.processing_status === 'completed' && doc.openai_file_id
    );

    if (readyDocs.length > 0) {
      console.log('\n✅ DOCUMENTOS PRONTOS PARA BUSCA NO RAG:');
      console.log('━'.repeat(80));
      
      readyDocs.forEach((doc, index) => {
        console.log(`\n${index + 1}. ${doc.original_name}`);
        console.log(`   OpenAI File ID: ${doc.openai_file_id}`);
        if (doc.tags && doc.tags.length > 0) {
          console.log(`   Tags: ${doc.tags.join(', ')}`);
        }
        console.log(`   Tamanho: ${(doc.file_size / 1024).toFixed(2)} KB`);
        console.log(`   Criado: ${new Date(doc.created_at).toLocaleString('pt-BR')}`);
      });
    }

    // Listar documentos com erro
    const errorDocs = documents.filter(doc => doc.processing_status === 'error');
    if (errorDocs.length > 0) {
      console.log('\n\n❌ DOCUMENTOS COM ERRO:');
      console.log('━'.repeat(80));
      
      errorDocs.forEach((doc, index) => {
        console.log(`\n${index + 1}. ${doc.original_name}`);
        console.log(`   Erro: ${doc.error_message || 'Erro desconhecido'}`);
      });
    }

    // Listar documentos em processamento
    const processingDocs = documents.filter(
      doc => doc.processing_status === 'processing' || doc.processing_status === 'pending'
    );
    if (processingDocs.length > 0) {
      console.log('\n\n⏳ DOCUMENTOS EM PROCESSAMENTO:');
      console.log('━'.repeat(80));
      
      processingDocs.forEach((doc, index) => {
        console.log(`\n${index + 1}. ${doc.original_name}`);
        console.log(`   Status: ${doc.processing_status}`);
      });
    }

    console.log('\n' + '━'.repeat(80));
    console.log('\n💡 PARA TESTAR AS MELHORIAS DO RAG:');
    console.log('   Use os nomes dos arquivos listados acima nas suas perguntas.');
    console.log('   Exemplo: "Qual a dosagem mencionada em [nome_do_arquivo]?"');
    console.log('\n');

  } catch (error) {
    console.error('❌ Erro:', error);
  }
}

listDocuments();
