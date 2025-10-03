import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Ask document function called');

    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const vectorStoreId = Deno.env.get('OPENAI_VECTOR_STORE_ID');

    if (!supabaseUrl || !supabaseServiceRoleKey || !openaiApiKey || !vectorStoreId) {
      throw new Error('Missing required environment variables');
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);

    if (userError || !user) {
      throw new Error('Invalid user token');
    }

    console.log('User authenticated:', user.id);

    // Parse request body
    const { question } = await req.json();
    if (!question) {
      throw new Error('Question is required');
    }

    console.log('Processing question:', question);

    // Get user's documents
    const { data: documents, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', user.id)
      .eq('processing_status', 'completed');

    if (docError) {
      throw new Error(`Error fetching documents: ${docError.message}`);
    }

    if (!documents || documents.length === 0) {
      return new Response(
        JSON.stringify({
          answer: 'Você ainda não fez upload de nenhum documento processado. Faça upload de documentos primeiro para poder fazer perguntas sobre eles.'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Found ${documents.length} documents for user`);

    // Get file IDs from processed documents
    const fileIds = documents
      .filter(doc => doc.openai_file_id)
      .map(doc => doc.openai_file_id);

    if (fileIds.length === 0) {
      return new Response(
        JSON.stringify({
          answer: 'Nenhum documento foi processado com sucesso ainda. Aguarde o processamento dos documentos ou faça upload de novos arquivos.'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
    }

    console.log(`Using vector store for RAG`);

    // Call OpenAI Chat Completions API with file_search
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { 
            role: 'system', 
            content: 'Você é um assistente de nefrologia veterinária. Use os documentos fornecidos para responder às perguntas. Sempre cite as fontes quando possível e nunca dê diagnósticos definitivos - apenas forneça informações baseadas nos documentos.' 
          },
          { 
            role: 'user', 
            content: question 
          }
        ],
        tools: [{
          type: 'function',
          function: {
            name: 'search_documents',
            description: 'Busca informações nos documentos veterinários sobre nefrologia',
            parameters: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'A consulta para buscar nos documentos'
                }
              },
              required: ['query']
            }
          }
        }],
        tool_choice: 'auto'
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorDetails = errorText;
      
      try {
        const errorJson = JSON.parse(errorText);
        errorDetails = errorJson.error?.message || errorText;
      } catch (e) {
        // Keep original error text if not JSON
      }
      
      console.error('OpenAI API error:', errorDetails);
      throw new Error(`Erro da API OpenAI: ${errorDetails}`);
    }

    const data = await response.json();
    console.log('OpenAI response received');

    // Extract answer from response
    const answer = data.choices?.[0]?.message?.content || 'Desculpe, não consegui gerar uma resposta com base nos documentos.';

    console.log('Generated answer successfully');

    return new Response(
      JSON.stringify({ answer }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in ask-document function:', error);
    
    // Extract specific error message
    let errorMessage = 'Erro interno do servidor';
    let errorDetails = '';
    
    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = error.stack || '';
    }
    
    return new Response(
      JSON.stringify({ 
        error: errorMessage,
        details: errorDetails
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});