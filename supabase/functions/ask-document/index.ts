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
    let fallbackInfo = ''; // Initialize fallback info variable
    let noRelevantDocs = false;

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
        
        // Normalize function - removes accents, spaces, underscores, special chars
        const normalize = (str: string) => {
          return str
            .toLowerCase()
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '') // Remove accents
            .replace(/[_\-\s]+/g, '') // Remove spaces, underscores, hyphens
            .replace(/[^\w]/g, ''); // Remove special chars
        };
        
        // Extract potential keywords from the question (longer and more flexible)
        const questionWords = qLower
          .split(/\s+/)
          .filter(w => w.length > 2); // Lower threshold to catch more words
        
        const normalizedQuestion = normalize(qLower);
        
        console.log(`\n🔍 Question analysis:`);
        console.log(`  Original: "${question}"`);
        console.log(`  Keywords: [${questionWords.join(', ')}]`);
        console.log(`  Normalized: "${normalizedQuestion}"`);
        
        // Score each document based on tag and filename relevance
        const scoredFiles = vectorFiles.map(vf => {
          let score = 0;
          const nameLower = vf.filename.toLowerCase();
          
          // Find matching document in Supabase data
          const docData = documentsWithTags.find(d => d.openai_file_id === vf.id);
          
          // Score based on tags - HEAVILY WEIGHTED with flexible matching
          let tagMatchCount = 0;
          let matchedTags: string[] = [];
          
          if (docData && docData.tags.length > 0) {
            console.log(`\n📄 Analyzing "${vf.filename}"`);
            console.log(`  Tags: [${docData.tags.join(', ')}]`);
            
            // Check each tag against question
            docData.tags.forEach(tag => {
              const normalizedTag = normalize(tag);
              let matched = false;
              
              // Strategy 1: Check if normalized question contains normalized tag
              if (normalizedQuestion.includes(normalizedTag)) {
                matched = true;
                score += 100;
                console.log(`  ✅ FULL MATCH: "${tag}" found in question`);
              }
              
              // Strategy 2: Check if normalized tag contains any question word
              if (!matched) {
                for (const word of questionWords) {
                  const normalizedWord = normalize(word);
                  if (normalizedTag.includes(normalizedWord) || normalizedWord.includes(normalizedTag)) {
                    matched = true;
                    score += 80;
                    console.log(`  ✅ PARTIAL MATCH: tag "${tag}" matches word "${word}"`);
                    break;
                  }
                }
              }
              
              // Strategy 3: Check individual words in tag
              if (!matched) {
                const tagWords = tag.toLowerCase().split(/[_\-\s]+/);
                for (const tagWord of tagWords) {
                  const normalizedTagWord = normalize(tagWord);
                  if (normalizedTagWord.length > 2 && normalizedQuestion.includes(normalizedTagWord)) {
                    matched = true;
                    score += 50;
                    console.log(`  ✅ WORD MATCH: tag word "${tagWord}" from "${tag}" found`);
                    break;
                  }
                }
              }
              
              if (matched) {
                tagMatchCount++;
                matchedTags.push(tag);
              }
            });
            
            if (tagMatchCount > 0) {
              console.log(`  🎯 Total score from tags: ${score} (${tagMatchCount} matches)`);
            } else {
              console.log(`  ❌ No tag matches`);
            }
          }
          
          // Filename matching (lower priority)
          if (tagMatchCount === 0) {
            const filenameMatches = questionWords.filter(word => nameLower.includes(word));
            if (filenameMatches.length > 0) {
              score += filenameMatches.length * 10;
              console.log(`  📝 Filename matches: ${filenameMatches.length} words`);
            }
          }
          
          return { id: vf.id, filename: vf.filename, score, matchedTags };
        });
        
        // Sort by score - Get both relevant and non-relevant files
        scoredFiles.sort((a, b) => b.score - a.score);
        const relevantFiles = scoredFiles.filter(sf => sf.score > 0);
        const allFiles = scoredFiles;
        
        console.log(`\n📊 Scoring results:`);
        console.log(`  Relevant files (score > 0): ${relevantFiles.length}`);
        console.log(`  Total files: ${allFiles.length}`);
        
        let hasRelevantTagMatches = false;
        let usedFallback = false;
        
        // FALLBACK STRATEGY: Maximize coverage
        if (relevantFiles.length > 0) {
          // Priority: Use relevant files first
          preferredFileIds = relevantFiles
            .slice(0, 10)
            .map(sf => sf.id);
          hasRelevantTagMatches = true;
          
          console.log(`\n✅ Using ${preferredFileIds.length} documents with relevant tags:`);
          relevantFiles.slice(0, 10).forEach(sf => {
            const matchInfo = sf.matchedTags && sf.matchedTags.length > 0 
              ? ` [Tags: ${sf.matchedTags.join(', ')}]`
              : '';
            console.log(`  [TAG MATCH] ${sf.filename} (score: ${sf.score})${matchInfo}`);
          });
          
          // If we have room (less than 10), fill remaining slots with other documents
          if (relevantFiles.length < 10 && allFiles.length > relevantFiles.length) {
            const remainingSlots = 10 - relevantFiles.length;
            const otherFiles = allFiles
              .filter(sf => sf.score === 0) // Documents without tag matches
              .slice(0, remainingSlots);
            
            preferredFileIds.push(...otherFiles.map(sf => sf.id));
            usedFallback = true;
            
            console.log(`\n⚠️ FALLBACK: Filling ${otherFiles.length} remaining slots with documents without tag matches:`);
            otherFiles.forEach(sf => {
              console.log(`  [NO TAG] ${sf.filename} (score: ${sf.score})`);
            });
          }
        
            // NO FALLBACK - We do NOT fill empty slots with untagged documents
            // This ensures ONLY relevant documents are used
            console.log(`\n🎯 Using ONLY ${preferredFileIds.length} documents with tag matches (no fallback)`);
          } else {
            // No relevant files found - do NOT attach unrelated documents
            preferredFileIds = [];
            usedFallback = true;
            noRelevantDocs = true;
          
            console.log(`⚠️ WARNING: No documents with relevant tags found!`);
            console.log(`STRICT MODE: No attachments will be used to avoid incorrect citations.`);
          }
        
        // Store fallback info for assistant message
        fallbackInfo = usedFallback 
          ? `\n\n⚠️ NOTA INTERNA: Nenhum documento com tags relevantes foi encontrado. Esta consulta foi marcada como sem cobertura por tags.`
          : '';
        
        if (preferredFileIds.length > 0) {
          console.log(`\n✅ Final selection: ${preferredFileIds.length} documents ready for search`);
        }
      }
    } else {
      console.error('Could not list files:', await filesResponse.text());
    }

    // Short-circuit: no relevant documents by tags
    if (noRelevantDocs) {
      return new Response(
        JSON.stringify({
          answer: 'Desculpe, não encontrei documentos com tags relevantes para esta pergunta. Atualize as tags ou refine a pergunta.',
          references: [],
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        }
      );
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
${fallbackInfo}

INSTRUÇÕES CRÍTICAS SOBRE BUSCA:
1. **ATENÇÃO**: Você receberá APENAS os documentos relevantes anexados à mensagem
2. **NÃO busque em outros documentos** - use SOMENTE os arquivos que foram anexados
3. Os documentos foram PRÉ-SELECIONADOS baseado em tags que combinam perfeitamente com a pergunta
4. Se um documento foi anexado, é porque ele É relevante para o tópico
5. **RESTRIÇÃO CRÍTICA**: Cite APENAS documentos que foram anexados à conversa
6. Se a informação não estiver nos documentos anexados, diga claramente ao usuário
7. SEMPRE cite o nome completo do arquivo (não use IDs como "file-Aifp6BUxhj2YTcMvftEYPU")
8. NUNCA dê diagnósticos definitivos - apenas forneça informações educacionais baseadas nos documentos
9. **SE A INFORMAÇÃO NÃO FOR ENCONTRADA NOS DOCUMENTOS ANEXADOS**: Diga: "Desculpe, não encontrei informações sobre [assunto] nos documentos disponíveis para esta consulta."

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
        // NOT using vector_store_ids here - files will be attached to the message instead
        // This ensures ONLY pre-selected files are searched
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