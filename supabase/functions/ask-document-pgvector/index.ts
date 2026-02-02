import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate embedding for query
async function generateEmbedding(text: string, apiKey: string): Promise<number[]> {
  const response = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'text-embedding-ada-002',
      input: text,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Embedding generation failed: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Ask document function called - pgvector RAG version');

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!openaiApiKey || !supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request
    const body = await req.json();
    const question = body.question;

    if (!question) {
      throw new Error('Question is required');
    }

    console.log('\n📝 Question:', question);

    // Step 1: Generate embedding for the question
    console.log('🔄 Generating query embedding...');
    const queryEmbedding = await generateEmbedding(question, openaiApiKey);
    console.log('✅ Query embedding generated');

    // Step 2: Search for relevant chunks using pgvector
    console.log('🔍 Searching for relevant document chunks...');
    
    const { data: chunks, error: searchError } = await supabase
      .rpc('search_document_chunks', {
        query_embedding: queryEmbedding,
        match_threshold: 0.7,
        match_count: 5,
      });

    if (searchError) {
      console.error('Search error:', searchError);
      throw new Error(`Search failed: ${searchError.message}`);
    }

    console.log(`✅ Found ${chunks?.length || 0} relevant chunks`);

    // Log retrieved chunks for transparency
    if (chunks && chunks.length > 0) {
      console.log('\n📚 Retrieved chunks:');
      chunks.forEach((chunk: any, index: number) => {
        console.log(`\n  ${index + 1}. Document: ${chunk.document_name}`);
        console.log(`     Tags: ${chunk.document_tags?.join(', ') || 'none'}`);
        console.log(`     Similarity: ${(chunk.similarity * 100).toFixed(2)}%`);
        console.log(`     Text preview: ${chunk.chunk_text.substring(0, 150)}...`);
      });
    } else {
      console.log('⚠️ No relevant chunks found');
      
      return new Response(
        JSON.stringify({
          answer: 'Desculpe, não encontrei informações relevantes sobre sua pergunta nos documentos disponíveis. Tente reformular a pergunta ou adicionar mais documentos sobre este tema.',
          sources: [],
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      );
    }

    // Step 3: Build context from chunks
    const context = chunks
      .map((chunk: any, index: number) => 
        `[Documento ${index + 1}: ${chunk.document_name}]\n${chunk.chunk_text}`
      )
      .join('\n\n---\n\n');

    const sources = [...new Set(chunks.map((chunk: any) => chunk.document_name))];
    console.log('\n📄 Using sources:', sources.join(', '));

    // Step 4: Generate answer using GPT-4o
    console.log('🤖 Generating answer with GPT-4o...');
    
    const systemPrompt = `Você é um assistente especializado em nefrologia e urologia veterinária.

🎯 SUA TAREFA:
Responda a pergunta do usuário baseando-se EXCLUSIVAMENTE nos documentos fornecidos abaixo.

⚠️ REGRAS CRÍTICAS (MÉDICA VETERINÁRIA DEPENDE DE VOCÊ):
1. Use APENAS informações dos documentos fornecidos
2. NÃO invente, suponha ou extrapole informações
3. Se a informação não estiver nos documentos, diga claramente
4. Cite SEMPRE a fonte: [nome_do_arquivo.pdf] logo após cada informação
5. NÃO use negrito nas citações, apenas: [arquivo.pdf]

📝 FORMATAÇÃO DA RESPOSTA:
- Organize em tópicos numerados (1., 2., 3.)
- Seja específica: doses exatas, frequências, durações
- Cite a fonte imediatamente após cada informação
- Linha em branco entre tópicos
- Use **negrito** para valores numéricos importantes

EXEMPLO DE RESPOSTA BOA:
"1. Tratamento com citrato de potássio: **2-3 mEq/kg/dia**, via oral, dividido em 2-3 doses [Urolitíase_Canina.pdf]

2. Dieta alcalinizante: Recomenda-se alimentação úmida para aumentar volume urinário [Urolitíase_Canina.pdf]"

🚫 NUNCA:
- Inventar dosagens
- Misturar informações de documentos diferentes sem citar
- Dar certezas sobre diagnósticos
- Usar informações que não estão nos documentos

---

DOCUMENTOS DISPONÍVEIS:

${context}`;

    const chatResponse = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: question }
        ],
        temperature: 0,
        max_tokens: 2000,
      }),
    });

    if (!chatResponse.ok) {
      const error = await chatResponse.text();
      throw new Error(`Chat completion failed: ${error}`);
    }

    const chatData = await chatResponse.json();
    const answer = chatData.choices[0]?.message?.content || 'Não foi possível gerar uma resposta.';

    console.log('✅ Answer generated successfully');
    console.log(`📊 Tokens used: ${chatData.usage?.total_tokens || 'unknown'}`);

    // Save query log
    try {
      await supabase.from('rag_logs').insert({
        question,
        answer: answer.substring(0, 500),
        sources_used: sources,
        chunks_count: chunks.length,
        model: 'gpt-4o',
        search_method: 'pgvector',
      });
    } catch (logError) {
      console.error('Failed to log query:', logError);
    }

    return new Response(
      JSON.stringify({
        answer,
        sources,
        chunks_used: chunks.length,
        search_method: 'pgvector'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('❌ Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        details: 'Erro ao processar pergunta. Verifique os logs para mais detalhes.'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
