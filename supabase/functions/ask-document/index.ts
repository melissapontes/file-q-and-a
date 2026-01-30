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
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

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

    // Fetch documents with tags from Supabase
    let documentsWithTags: { openai_file_id: string; tags: string[]; original_name: string }[] = [];
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.58.0');
        const supabase = createClient(supabaseUrl, supabaseServiceKey);
        
        const { data, error } = await supabase
          .from('documents')
          .select('openai_file_id, tags, original_name')
          .eq('processing_status', 'completed')
          .not('openai_file_id', 'is', null);
        
        if (!error && data) {
          documentsWithTags = data.map(doc => ({
            openai_file_id: doc.openai_file_id!,
            tags: doc.tags || [],
            original_name: doc.original_name
          }));
          console.log(`Fetched ${documentsWithTags.length} documents with tags from Supabase`);
        }
      } catch (e) {
        console.error('Error fetching documents from Supabase:', e);
      }
    }

    // Step 0: List all files in the vector store
    console.log('Listing all files in vector store...');
    const filesResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    let filesList = 'Arquivos disponíveis no vector store: (nenhum encontrado)';
    // Files present in the vector store with their human filenames
    const vectorFiles: { id: string; filename: string }[] = [];
    // Files we want to prioritize for the current question (by heuristics)
    let preferredFileIds: string[] = [];

    if (filesResponse.ok) {
      const filesData = await filesResponse.json();
      if (filesData.data && filesData.data.length > 0) {
        const fileIds: string[] = filesData.data.map((f: any) => f.id);

        // Fetch filenames for each file id so we can apply simple heuristics
        for (const id of fileIds) {
          try {
            const fr = await fetch(`https://api.openai.com/v1/files/${id}`, {
              headers: { 'Authorization': `Bearer ${openaiApiKey}` },
            });
            if (fr.ok) {
              const fd = await fr.json();
              vectorFiles.push({ id, filename: fd.filename || id });
            } else {
              vectorFiles.push({ id, filename: id });
            }
          } catch {
            vectorFiles.push({ id, filename: id });
          }
        }

        filesList = `Arquivos disponíveis no vector store (${vectorFiles.length} arquivos): ${vectorFiles.map(f => f.id).join(', ')}`;
        console.log(filesList);

        // Enhanced heuristic using tags and filename matching
        const qLower = question.toLowerCase();
        
        // Extract potential keywords from the question
        const questionWords = qLower.split(/\s+/).filter(w => w.length > 3);
        
        // Score each document based on tag and filename relevance
        const scoredFiles = vectorFiles.map(vf => {
          let score = 0;
          const nameLower = vf.filename.toLowerCase();
          
          // Find matching document in Supabase data
          const docData = documentsWithTags.find(d => d.openai_file_id === vf.id);
          
          // Score based on tags - HEAVILY WEIGHTED
          let tagMatchCount = 0;
          if (docData && docData.tags.length > 0) {
            const tagMatches = docData.tags.filter(tag => 
              questionWords.some(word => tag.toLowerCase().includes(word))
            );
            tagMatchCount = tagMatches.length;
            score += tagMatchCount * 100; // VERY HIGH weight for tag matches
            
            console.log(`Document "${vf.filename}": tags=${docData.tags}, matches=${tagMatchCount}, score_from_tags=${tagMatchCount * 100}`);
          }
          
          // Only use filename if no tag matches
          if (tagMatchCount === 0) {
            const filenameMatches = questionWords.filter(word => nameLower.includes(word));
            score += filenameMatches.length * 10; // Lower weight if no tags match
          }
          
          // Special boost for known important terms only if tags have relevance
          const oxalateTerms = ['oxalato', 'oxalate', 'calcium_oxalate', 'caox', 'oxalate'];
          const canineTerms = ['canine', 'canino', 'cão', 'cao', 'cães', 'caes', 'dog', 'dogs'];
          
          const hasOxalate = oxalateTerms.some(t => qLower.includes(t));
          const isDogContext = canineTerms.some(t => qLower.includes(t));
          
          if (hasOxalate && docData?.tags.length) {
            const tagsHaveOxalate = docData.tags.some(tag => 
              oxalateTerms.some(t => tag.toLowerCase().includes(t))
            );
            if (tagsHaveOxalate) score += 30;
            
            const nameHasCanine = canineTerms.some(t => nameLower.includes(t));
            const tagsHaveCanine = docData.tags.some(tag => 
              canineTerms.some(t => tag.toLowerCase().includes(t))
            );
            if (isDogContext && (nameHasCanine || tagsHaveCanine)) score += 25;
          }
          
          return { id: vf.id, filename: vf.filename, score };
        });
        
        // Sort by score - ONLY include documents with score > 0 (must have tag or filename match)
        scoredFiles.sort((a, b) => b.score - a.score);
        const relevantFiles = scoredFiles.filter(sf => sf.score > 0);
        preferredFileIds = relevantFiles
          .slice(0, 10) // Max 10 attachments allowed by OpenAI API
          .map(sf => sf.id);
        
        if (preferredFileIds.length > 0) {
          console.log(`Using ${preferredFileIds.length} most relevant documents (filtered by tags):`);
          relevantFiles.slice(0, 10).forEach(sf => {
            console.log(`  - ${sf.filename} (score: ${sf.score})`);
          });
        } else {
          console.log(`WARNING: No documents with relevant tags found. Using all documents for vector search.`);
        }
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

INSTRUÇÕES CRÍTICAS SOBRE BUSCA:
1. Você DEVE usar a ferramenta file_search para buscar em TODOS os documentos disponíveis
2. **IMPORTANTE**: Os documentos foram PRÉ-SELECIONADOS baseado em tags relevantes à pergunta do usuário
3. Se um documento foi incluído, é porque suas tags combinam com o tópico - use-o como referência principal
4. Busque extensivamente através dos documentos disponibilizados - eles são relevantes para a pergunta
5. **SE A PERGUNTA FOR SOBRE UM TÓPICO ESPECÍFICO (ex: infecção urinária)**, use APENAS documentos com tags relacionadas
6. NUNCA use documentos que não tenham tags relevantes ao tópico - mesmo que mencionem a palavra de passagem
7. SEMPRE cite o nome completo do arquivo (não use IDs como "file-Aifp6BUxhj2YTcMvftEYPU")
8. NUNCA dê diagnósticos definitivos - apenas forneça informações educacionais baseadas nos documentos
9. **SE A INFORMAÇÃO NÃO FOR ENCONTRADA NOS DOCUMENTOS**: Você DEVE avisar claramente ao usuário com uma mensagem como: "Desculpe, não encontrei informações sobre [assunto] nos documentos disponíveis." NÃO invente ou forneça informações que não estejam nos documentos.

FORMATAÇÃO DA RESPOSTA:
- Organize SEMPRE sua resposta em tópicos numerados (1., 2., 3., etc.)
- Deixe uma linha em branco entre cada tópico numerado
- Coloque o texto logo após o número, na mesma linha (exemplo: "1. Texto do tópico")
- Ao citar a fonte, coloque em negrido logo após a informação no mesmo parágrafo
- Na seção de documentos utilizados, informe o nome completo do arquivo PDF

IMPORTANTE: Seja preciso e retorne apenas informações relevantes para o que foi perguntado.`,
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

    // Attach prioritized vector-store files first (to bias retrieval)
    const allAttachments: any[] = [];
    if (typeof preferredFileIds !== 'undefined' && preferredFileIds.length > 0) {
      allAttachments.push(
        ...preferredFileIds.map(fileId => ({ file_id: fileId, tools: [{ type: 'file_search' }] }))
      );
    }

    // Then attach any ad-hoc files uploaded with the question
    if (uploadedFileIds.length > 0) {
      allAttachments.push(
        ...uploadedFileIds.map(fileId => ({ file_id: fileId, tools: [{ type: 'file_search' }] }))
      );
    }

    if (allAttachments.length > 0) {
      messageBody.attachments = allAttachments;
      console.log(`Attaching ${allAttachments.length} files to message (preferred: ${preferredFileIds?.length || 0}, uploaded: ${uploadedFileIds.length})`);
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
        
        // Replace citation markers with inline references and build reference list
        answer = rawAnswer.replace(/【\d+:\d+†source】/g, (match: string) => {
          const annotationIndex = parseInt(match.match(/【(\d+):/)?.[1] || '0');
          if (annotations[annotationIndex]?.type === 'file_citation') {
            const fileId = annotations[annotationIndex].file_citation?.file_id;
            const filename = citationMap.get(fileId) || fileId;
            return ` **[${filename}]**`;
          }
          return '';
        });

        // Populate references array for frontend rendering
        references = Array.from(citationMap.values());
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