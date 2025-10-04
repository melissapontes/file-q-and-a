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

    // Parse request - can be JSON or FormData
    const contentType = req.headers.get('content-type') || '';
    let question = '';
    let uploadedFileIds: string[] = [];
    let imageContext = '';

    if (contentType.includes('multipart/form-data')) {
      // Handle file uploads
      const formData = await req.formData();
      question = formData.get('question') as string;
      const files = formData.getAll('files') as File[];

      console.log(`Processing question with ${files.length} attached files`);

      // Process files based on type
      for (const file of files) {
        try {
          const fileName = file.name.toLowerCase();
          const isImage = fileName.endsWith('.jpg') || fileName.endsWith('.jpeg') || fileName.endsWith('.png');

          if (isImage) {
            // Process image with Vision API
            console.log(`Processing image file with Vision API: ${file.name}`);
            const fileBuffer = await file.arrayBuffer();
            const base64Image = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
            const mimeType = file.type || 'image/jpeg';

            // Use Vision API to extract text from image
            const visionResponse = await fetch('https://api.openai.com/v1/chat/completions', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'gpt-4o-mini',
                messages: [
                  {
                    role: 'user',
                    content: [
                      {
                        type: 'text',
                        text: 'Por favor, extraia TODAS as informações deste documento médico/laudo. Liste todos os valores, resultados, diagnósticos e observações presentes. Seja detalhado e preciso.'
                      },
                      {
                        type: 'image_url',
                        image_url: {
                          url: `data:${mimeType};base64,${base64Image}`
                        }
                      }
                    ]
                  }
                ],
                max_tokens: 2000
              }),
            });

            if (visionResponse.ok) {
              const visionData = await visionResponse.json();
              const extractedText = visionData.choices[0]?.message?.content || '';
              imageContext += `\n\n**Conteúdo extraído de ${file.name}:**\n${extractedText}\n`;
              console.log(`Extracted text from image: ${file.name}`);
            } else {
              console.error(`Failed to process image ${file.name}:`, await visionResponse.text());
              imageContext += `\n\n[Erro ao processar imagem: ${file.name}]\n`;
            }
          } else {
            // Upload text documents to OpenAI for file_search
            const fileBuffer = await file.arrayBuffer();
            const blob = new Blob([fileBuffer], { type: file.type });
            
            const uploadFormData = new FormData();
            uploadFormData.append('file', blob, file.name);
            uploadFormData.append('purpose', 'assistants');

            const uploadResponse = await fetch('https://api.openai.com/v1/files', {
              method: 'POST',
              headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
              },
              body: uploadFormData,
            });

            if (uploadResponse.ok) {
              const uploadData = await uploadResponse.json();
              uploadedFileIds.push(uploadData.id);
              console.log(`Uploaded document: ${file.name} (ID: ${uploadData.id})`);
            } else {
              console.error(`Failed to upload file ${file.name}:`, await uploadResponse.text());
            }
          }
        } catch (error) {
          console.error(`Error processing file ${file.name}:`, error);
        }
      }
    } else {
      // JSON request (no files)
      const body = await req.json();
      question = body.question;
    }

    if (!question) {
      throw new Error('Question is required');
    }

    console.log('Processing question:', question);
    console.log(`Using vector store: ${vectorStoreId}`);

    // Detect if user is asking to list all documents
    const isListingRequest = /\b(listar|lista|nomes|todos os|all|list)\b.*\b(artigos?|documentos?|arquivos?|papers?|files?)\b/i.test(question) ||
                             /\b(artigos?|documentos?|arquivos?|papers?|files?)\b.*\b(listar|lista|nomes|todos os|all|list)\b/i.test(question);

    if (isListingRequest) {
      console.log('Detected listing request - returning all files from vector store');
      
      // Direct listing mode: return ALL files without using Assistant
      const filesResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'OpenAI-Beta': 'assistants=v2',
        },
      });

      if (!filesResponse.ok) {
        const error = await filesResponse.text();
        console.error('Error listing files:', error);
        throw new Error(`Erro ao listar arquivos: ${error}`);
      }

      const filesData = await filesResponse.json();
      
      if (!filesData.data || filesData.data.length === 0) {
        return new Response(
          JSON.stringify({ answer: 'Nenhum documento encontrado no vector store.' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get file details (filename) for each file ID
      const fileDetails = await Promise.all(
        filesData.data.map(async (file: any) => {
          try {
            const detailResponse = await fetch(`https://api.openai.com/v1/files/${file.id}`, {
              headers: {
                'Authorization': `Bearer ${openaiApiKey}`,
              },
            });
            if (detailResponse.ok) {
              const detail = await detailResponse.json();
              return `• ${detail.filename || file.id} (ID: ${file.id})`;
            }
            return `• ${file.id}`;
          } catch (e) {
            return `• ${file.id}`;
          }
        })
      );

      const answer = `📚 **Documentos disponíveis no vector store (${filesData.data.length} artigos):**\n\n${fileDetails.join('\n')}`;
      console.log('Listed all files successfully');

      return new Response(
        JSON.stringify({ answer }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Normal RAG flow continues below (unchanged)
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
2. Realize uma busca ampla, cobrindo múltiplos documentos e trechos relevantes dos arquivos
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

    // Step 3: Add user message to Thread (with attached files and image context)
    console.log('Adding message to thread...');
    
    // Combine question with image context if available
    let fullQuestion = question;
    if (imageContext) {
      fullQuestion += imageContext;
      console.log('Added image context to question');
    }

    const messageBody: any = {
      role: 'user',
      content: fullQuestion
    };

    if (uploadedFileIds.length > 0) {
      messageBody.attachments = uploadedFileIds.map(fileId => ({
        file_id: fileId,
        tools: [{ type: 'file_search' }]
      }));
      console.log(`Attaching ${uploadedFileIds.length} document files to message`);
    }

    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify(messageBody),
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
    let references: string[] = [];
    
    if (assistantMessages.length > 0) {
      const lastMessage = assistantMessages[0];
      const textContent = lastMessage.content.find((c: any) => c.type === 'text');
      if (textContent) {
        let rawAnswer = textContent.text.value;
        
        // Process annotations (citations)
        const annotations = textContent.text.annotations || [];
        console.log(`Found ${annotations.length} annotations in response`);
        
        // Build a map of file IDs to filenames
        const citationMap = new Map<string, string>();
        
        for (const annotation of annotations) {
          if (annotation.type === 'file_citation') {
            const fileId = annotation.file_citation?.file_id;
            if (fileId && !citationMap.has(fileId)) {
              try {
                const fileResponse = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
                  headers: {
                    'Authorization': `Bearer ${openaiApiKey}`,
                  },
                });
                
                if (fileResponse.ok) {
                  const fileData = await fileResponse.json();
                  const filename = fileData.filename || fileId;
                  citationMap.set(fileId, filename);
                  console.log(`Reference found: ${filename}`);
                }
              } catch (e) {
                console.error(`Error fetching file details for ${fileId}:`, e);
                citationMap.set(fileId, fileId);
              }
            }
          }
        }
        
        // Replace citation markers with inline references
        answer = rawAnswer.replace(/【\d+:\d+†source】/g, (match: string) => {
          // Extract the annotation index from the match
          const annotationIndex = parseInt(match.match(/【(\d+):/)?.[1] || '0');
          if (annotations[annotationIndex]?.type === 'file_citation') {
            const fileId = annotations[annotationIndex].file_citation?.file_id;
            const filename = citationMap.get(fileId) || fileId;
            return ` **[${filename}]**`;
          }
          return '';
        });
        
        console.log(`Processed answer with ${citationMap.size} unique references`);
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

    // Cleanup uploaded files
    if (uploadedFileIds.length > 0) {
      console.log('Cleaning up temporary files...');
      for (const fileId of uploadedFileIds) {
        try {
          await fetch(`https://api.openai.com/v1/files/${fileId}`, {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
            },
          });
        } catch (e) {
          console.log(`Could not delete file ${fileId}:`, e);
        }
      }
    }

    return new Response(
      JSON.stringify({ answer, references }),
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