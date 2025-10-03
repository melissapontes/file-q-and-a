import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const vectorStoreId = Deno.env.get('OPENAI_VECTOR_STORE_ID');

    if (!openaiApiKey || !vectorStoreId) {
      throw new Error('Missing required environment variables: OPENAI_API_KEY or OPENAI_VECTOR_STORE_ID');
    }

    // Parse request body
    const { question } = await req.json();
    if (!question) {
      throw new Error('Question is required');
    }

    console.log('Processing question:', question);
    console.log(`Using vector store: ${vectorStoreId}`);

    // Step 0: List all files in the vector store
    console.log('Listing all files in vector store...');
    const filesResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    let filesList = 'Arquivos disponíveis no vector store: (nenhum encontrado)';
    if (filesResponse.ok) {
      const filesData = await filesResponse.json();
      if (filesData.data && filesData.data.length > 0) {
        const fileNames = filesData.data.map((f: any) => f.id).join(', ');
        filesList = `Arquivos disponíveis no vector store (${filesData.data.length} arquivos): ${fileNames}`;
        console.log(filesList);
      }
    } else {
      console.error('Could not list files:', await filesResponse.text());
    }

    // Step 1: Create an Assistant with file_search
    console.log('Creating Assistant...');
    const assistantResponse = await fetch('https://api.openai.com/v1/assistants', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({
        name: 'Nefrologia Veterinária RAG',
        instructions: `Você é um assistente especializado em nefrologia veterinária. 

${filesList}

INSTRUÇÕES CRÍTICAS:
1. Você DEVE usar a ferramenta file_search para buscar em TODOS os documentos listados acima
2. Configure a busca com max_num_results=20 para garantir que mais documentos sejam consultados
3. Para perguntas sobre listar documentos, procure por termos genéricos que estejam em todos os documentos (como "abstract", "introduction", "methods")
4. SEMPRE cite o nome/ID exato do arquivo fonte na sua resposta
5. Se a pergunta pedir para listar documentos, retorne TODOS os IDs de arquivo que você encontrou
6. NUNCA dê diagnósticos definitivos - apenas forneça informações educacionais baseadas nos documentos

Sua tarefa é consultar TODOS os arquivos disponíveis no vector store e sintetizar as informações encontradas.`,
        model: 'gpt-4o-mini',
        tools: [{ 
          type: 'file_search',
        }],
        tool_resources: {
          file_search: {
            vector_store_ids: [vectorStoreId],
            max_num_results: 20  // Force more comprehensive search
          }
        }
      }),
    });

    if (!assistantResponse.ok) {
      const error = await assistantResponse.text();
      console.error('Error creating assistant:', error);
      throw new Error(`Erro ao criar assistente: ${error}`);
    }

    const assistant = await assistantResponse.json();
    console.log('Assistant created:', assistant.id);

    // Step 2: Create a Thread
    console.log('Creating Thread...');
    const threadResponse = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({}),
    });

    if (!threadResponse.ok) {
      const error = await threadResponse.text();
      console.error('Error creating thread:', error);
      throw new Error(`Erro ao criar thread: ${error}`);
    }

    const thread = await threadResponse.json();
    console.log('Thread created:', thread.id);

    // Step 3: Add user message to Thread
    console.log('Adding message to thread...');
    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({
        role: 'user',
        content: question
      }),
    });

    if (!messageResponse.ok) {
      const error = await messageResponse.text();
      console.error('Error adding message:', error);
      throw new Error(`Erro ao adicionar mensagem: ${error}`);
    }

    console.log('Message added to thread');

    // Step 4: Run the Assistant
    console.log('Running assistant...');
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({
        assistant_id: assistant.id
      }),
    });

    if (!runResponse.ok) {
      const error = await runResponse.text();
      console.error('Error running assistant:', error);
      throw new Error(`Erro ao executar assistente: ${error}`);
    }

    const run = await runResponse.json();
    console.log('Run started:', run.id);

    // Step 5: Poll for completion
    let runStatus = run.status;
    let attempts = 0;
    const maxAttempts = 30; // 30 seconds max

    while (runStatus !== 'completed' && runStatus !== 'failed' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      
      const statusResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'OpenAI-Beta': 'assistants=v2',
        },
      });

      if (!statusResponse.ok) {
        const error = await statusResponse.text();
        console.error('Error checking run status:', error);
        throw new Error(`Erro ao verificar status: ${error}`);
      }

      const statusData = await statusResponse.json();
      runStatus = statusData.status;
      attempts++;
      console.log(`Run status: ${runStatus} (attempt ${attempts}/${maxAttempts})`);
    }

    if (runStatus === 'failed') {
      throw new Error('O assistente falhou ao processar a pergunta');
    }

    if (runStatus !== 'completed') {
      throw new Error('Timeout: O assistente demorou muito para responder');
    }

    // Step 6: Get the assistant's response
    console.log('Retrieving assistant response...');
    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    if (!messagesResponse.ok) {
      const error = await messagesResponse.text();
      console.error('Error retrieving messages:', error);
      throw new Error(`Erro ao recuperar mensagens: ${error}`);
    }

    const messagesData = await messagesResponse.json();
    const assistantMessages = messagesData.data.filter((msg: any) => msg.role === 'assistant');
    
    let answer = 'Desculpe, não consegui gerar uma resposta.';
    
    if (assistantMessages.length > 0) {
      const lastMessage = assistantMessages[0];
      const textContent = lastMessage.content.find((c: any) => c.type === 'text');
      if (textContent) {
        answer = textContent.text.value;
      }
    }

    console.log('Response retrieved successfully');

    // Cleanup: Delete the assistant (optional, to avoid accumulating assistants)
    try {
      await fetch(`https://api.openai.com/v1/assistants/${assistant.id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'OpenAI-Beta': 'assistants=v2',
        },
      });
      console.log('Assistant deleted');
    } catch (e) {
      console.log('Could not delete assistant:', e);
    }

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