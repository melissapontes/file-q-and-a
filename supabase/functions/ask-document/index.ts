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

    // Query logging data
    let queryLogData: any = {
      documents_fetched: 0,
      documents_analyzed: [],
      final_selection: 'all_via_semantic_search'
    };

    // Fetch document metadata from Supabase for logging purposes only
    let documentsMetadata: { openai_file_id: string; original_name: string }[] = [];
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.58.0');
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data, error } = await supabase
          .from('documents')
          .select('openai_file_id, original_name')
          .not('openai_file_id', 'is', null);

        if (!error && data) {
          documentsMetadata = data.map(doc => ({
            openai_file_id: doc.openai_file_id!,
            original_name: doc.original_name
          }));
          queryLogData.documents_fetched = documentsMetadata.length;
          console.log(`📚 Total documents available: ${documentsMetadata.length}`);
        }
      } catch (e) {
        console.error('Error fetching documents metadata:', e);
      }
    }

    // ✅ SOLUÇÃO 1: Criar mapa local de file_id → filename para evitar chamadas à API
    const fileIdToNameMap = new Map<string, string>();
    for (const doc of documentsMetadata) {
      fileIdToNameMap.set(doc.openai_file_id, doc.original_name);
    }
    console.log(`🗂️  Created local file ID map with ${fileIdToNameMap.size} entries`);

    console.log(`\n🔍 Search strategy: Using semantic vector search across ALL documents`);
    console.log(`   OpenAI's file_search will automatically find the most relevant documents`);
    console.log(`   No pre-filtering by tags - pure semantic similarity matching\n`);

    // ✅ CROSS-LANGUAGE SEARCH: Translate PT query to EN for better vector matching
    console.log('🌐 Detecting and translating query for better search...');
    let searchQuery = question;
    
    // Simple heuristic: if query contains Portuguese characters/words, translate to English
    const isProbablyPortuguese = /[áàãâéêíóôõúç]/i.test(question) || 
                                 /\b(como|que|qual|para|com|tratamento|doenca|medicamento)\b/i.test(question);
    
    if (isProbablyPortuguese) {
      try {
        const translationResponse = await fetch('https://api.openai.com/v1/chat/completions', {
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
                content: 'Translate the following veterinary medical question from Portuguese to English. Output ONLY the translation, nothing else.'
              },
              {
                role: 'user',
                content: question
              }
            ],
            max_tokens: 200,
            temperature: 0
          }),
        });

        if (translationResponse.ok) {
          const translationData = await translationResponse.json();
          searchQuery = translationData.choices[0]?.message?.content?.trim() || question;
          console.log(`   Original (PT): ${question}`);
          console.log(`   Translated (EN): ${searchQuery}`);
        }
      } catch (e) {
        console.log('   Translation failed, using original query:', e);
      }
    } else {
      console.log('   Query appears to be in English, no translation needed');
    }

    // Step 2: Create an Assistant with file_search using the MAIN vector store
    console.log('Creating Assistant with semantic search...');
    const assistantResponse = await fetch('https://api.openai.com/v1/assistants', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({
        name: 'Nefrologia Veterinária RAG',
        instructions: `REGRA DE FONTE DE INFORMACAO:
Use EXCLUSIVAMENTE os documentos retornados pela ferramenta file_search.
Nao use conhecimento externo ao conjunto de documentos fornecidos.

PROTOCOLO DE RESPOSTA:

1. Execute file_search para buscar documentos relevantes
2. ANALISE os resultados da busca:
   - SE file_search retornar documentos com informacoes sobre o topico:
     * RESPONDA usando as informacoes encontradas
     * CITE usando NUMEROS entre colchetes ao longo do texto: [1], [2], [3]
     * Coloque a citacao [numero] imediatamente apos a informacao relevante
     * Organize em topicos numerados
     * SEJA DETALHADO - extraia informacoes especificas dos documentos
   
   - SE file_search NAO retornar documentos relevantes OU retornar documentos que NAO tratam do topico:
     * Responda: "Nao encontrei informacoes sobre [topico] nos documentos disponiveis."
     * NAO invente informacoes

FORMATO DE CITACAO:
- Use [1], [2], [3] no texto (NAO use o nome completo do arquivo no meio do texto)
- A lista de referencias sera gerada automaticamente ao final
- Cada numero corresponde a um documento especifico
- Exemplo: "Fenilpropanolamina na dose de 2 mg/kg a cada 8-12 horas [1]."

DETALHAMENTO OBRIGATORIO (quando presente nos documentos):

Para perguntas sobre TRATAMENTO, inclua:
- Nomes especificos de medicamentos mencionados
- Dosagens (mg/kg, mg/dia) em **negrito**
- Via de administracao (oral, IV, SC)
- Frequencia (BID, TID, SID)
- Duracao do tratamento
- Racoes terapeuticas especificas (marca e linha)

Para perguntas sobre DIAGNOSTICO, inclua:
- Exames mencionados
- Valores de referencia
- Criterios diagnosticos

IMPORTANTE - Equilibrio:
- Se o documento tem informacoes detalhadas: FORNECA os detalhes
- Se o documento tem apenas informacoes gerais: FORNECA o que ha
- Se nao encontrou documentos relevantes: DIGA que nao encontrou
- NUNCA invente detalhes nao escritos nos documentos
- Cite documentos apenas se relevantes ao topico

IDIOMA:
- SEMPRE responda em PORTUGUES (pt-BR), mesmo que a pergunta seja em ingles
- Os documentos podem estar em ingles, mas sua resposta deve ser em portugues`,
        model: 'gpt-4o',
        tools: [{
          type: 'file_search',
          file_search: { max_num_results: 20 },
        }],
        tool_resources: {
          file_search: {
            vector_store_ids: [vectorStoreId]  // Use MAIN vector store, not temporary
          }
        },
      }),
    });

    if (!assistantResponse.ok) {
      const error = await assistantResponse.text();
      console.error('Error creating assistant:', error);
      throw new Error(`Erro ao criar assistente: ${error}`);
    }

    const assistant = await assistantResponse.json();
    console.log('Assistant created:', assistant.id);

    // Step 3: Create a Thread
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

    // Step 4: Add user message to Thread (with image context if available)
    console.log('Adding message to thread...');

    // Use translated query for better search, combine with image context if available
    let fullQuestion = searchQuery;  // Use translated query for search
    if (imageContext) {
      fullQuestion += imageContext;
      console.log('Added image context to question');
    }

    const messageBody: any = {
      role: 'user',
      content: fullQuestion
    };

    // Attach ad-hoc files uploaded with the question (if any)
    if (uploadedFileIds.length > 0) {
      messageBody.attachments = uploadedFileIds.map(fileId => ({
        file_id: fileId,
        tools: [{ type: 'file_search' }]
      }));
      console.log(`Attaching ${uploadedFileIds.length} additional files to message`);
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

    // Step 5: Run the Assistant
    console.log('Running assistant with semantic search...');
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

    // Step 6: Poll for completion
    let runStatus = run.status;
    let attempts = 0;
    const maxAttempts = 120; // 120 seconds max for thorough semantic search

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

    // ✅ SOLUÇÃO 2: Extrair documentos consultados via Run Steps
    console.log('Extracting consulted documents from Run Steps...');
    let consultedDocuments: any[] = [];
    try {
      const stepsResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}/steps`, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'OpenAI-Beta': 'assistants=v2',
        },
      });

      if (stepsResponse.ok) {
        const stepsData = await stepsResponse.json();
        const fileSearchSteps = stepsData.data.filter((step: any) => 
          step.type === 'tool_calls' && 
          step.step_details?.tool_calls?.some((tc: any) => tc.type === 'file_search')
        );

        for (const step of fileSearchSteps) {
          for (const toolCall of step.step_details.tool_calls) {
            if (toolCall.type === 'file_search' && toolCall.file_search?.results) {
              consultedDocuments.push(...toolCall.file_search.results);
            }
          }
        }
        console.log(`📚 Documents consulted by file_search: ${consultedDocuments.length}`);
      }
    } catch (e) {
      console.log('Could not extract Run Steps:', e);
    }

    // Step 7: Get the assistant's response
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
    const citationMap = new Map<string, string>(); // Declare in outer scope for logging

    if (assistantMessages.length > 0) {
      const lastMessage = assistantMessages[0];
      const textContent = lastMessage.content.find((c: any) => c.type === 'text');
      if (textContent) {
        let rawAnswer = textContent.text.value;

        // Process annotations (citations)
        const annotations = textContent.text.annotations || [];
        console.log(`Found ${annotations.length} annotations in response`);

        // ✅ Build a map of file IDs to filenames using LOCAL metadata (no API calls!)

        for (const annotation of annotations) {
          if (annotation.type === 'file_citation') {
            const fileId = annotation.file_citation?.file_id;
            if (fileId && !citationMap.has(fileId)) {
              // Use local map first, fallback to API only if needed
              const filename = fileIdToNameMap.get(fileId);
              if (filename) {
                citationMap.set(fileId, filename);
                console.log(`✅ Reference found (local): ${filename}`);
              } else {
                // Fallback: file might be from ad-hoc upload
                try {
                  const fileResponse = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
                    headers: {
                      'Authorization': `Bearer ${openaiApiKey}`,
                    },
                  });

                  if (fileResponse.ok) {
                    const fileData = await fileResponse.json();
                    const fetchedFilename = fileData.filename || fileId;
                    citationMap.set(fileId, fetchedFilename);
                    console.log(`⚠️ Reference found (API fallback): ${fetchedFilename}`);
                  } else {
                    citationMap.set(fileId, fileId);
                    console.warn(`❌ Could not resolve filename for: ${fileId}`);
                  }
                } catch (e) {
                  console.error(`Error fetching file details for ${fileId}:`, e);
                  citationMap.set(fileId, fileId);
                }
              }
            }
          }
        }

        // Replace citation markers with inline references and build reference list
        // IMPORTANT: annotation.text is the exact marker string (e.g. 【4:2†source】).
        // We must match by annotation.text, NOT by the number inside the marker,
        // because that number is an OpenAI-internal ID and NOT an array index.
        
        // Create a map of filename to reference number
        const filenameToNumber = new Map<string, number>();
        const orderedReferences: string[] = [];
        let refNumber = 1;

        // First pass: assign numbers to unique filenames in order of appearance
        for (const annotation of annotations) {
          if (annotation.type === 'file_citation') {
            const fileId = annotation.file_citation?.file_id;
            const filename = citationMap.get(fileId) || fileId;
            if (!filenameToNumber.has(filename)) {
              filenameToNumber.set(filename, refNumber);
              orderedReferences.push(filename);
              refNumber++;
            }
          }
        }

        // Second pass: replace annotations with numbered citations [1], [2], etc.
        answer = rawAnswer;
        for (const annotation of annotations) {
          if (annotation.type === 'file_citation' && annotation.text) {
            const fileId = annotation.file_citation?.file_id;
            const filename = citationMap.get(fileId) || fileId;
            const citationNumber = filenameToNumber.get(filename);
            // Replace every occurrence of this exact marker with the numbered citation
            answer = answer.split(annotation.text).join(`[${citationNumber}]`);
          }
        }

        // Populate references array for frontend rendering (in numerical order)
        references = orderedReferences;
        console.log(`Processed answer with ${references.length} unique references`);
      }
    }

    console.log('Response retrieved successfully');

    // Cleanup: Delete the assistant
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

    // ✅ SOLUÇÃO 3: Save enhanced query log to database for analysis
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.58.0');
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const answerPreview = answer.substring(0, 500) + (answer.length > 500 ? '...' : '');

        // Build detailed document analysis
        const consultedFileIds = new Set(consultedDocuments.map((doc: any) => doc.file_id || doc[0]));
        const citedFileIds = new Set(citationMap.keys());
        
        const detailedAnalysis = consultedDocuments.map((doc: any) => {
          const fileId = doc.file_id || doc[0];
          const filename = fileIdToNameMap.get(fileId) || fileId;
          return {
            file_id: fileId,
            filename: filename,
            cited: citedFileIds.has(fileId),
            score: doc.score
          };
        });

        const stats = {
          total_consulted: consultedDocuments.length,
          total_cited: citationMap.size,
          cited_percentage: consultedDocuments.length > 0 
            ? ((citationMap.size / consultedDocuments.length) * 100).toFixed(1)
            : '0'
        };

        console.log(`📊 Query Stats: ${stats.total_consulted} consulted, ${stats.total_cited} cited (${stats.cited_percentage}%)`);

        const { error } = await supabase.from('rag_query_logs').insert({
          question,
          documents_fetched: queryLogData.documents_fetched,
          documents_analyzed: detailedAnalysis,
          final_selection: `semantic_search: ${stats.total_consulted} docs consulted, ${stats.total_cited} cited`,
          answer_preview: answerPreview,
          status: 'success'
        });

        if (error) {
          console.error('Error saving query log:', error);
        } else {
          console.log('✅ Enhanced query log saved successfully');
        }
      } catch (e) {
        console.log('Could not save query log:', e);
      }
    }

    // ✅ STAGE 1: Build comprehensive list of ALL relevant documents consulted
    const allRelevantSources = [];
    const seenFiles = new Set();

    for (const doc of consultedDocuments) {
      const fileId = doc.file_id || doc[0];
      if (!seenFiles.has(fileId)) {
        seenFiles.add(fileId);
        const filename = fileIdToNameMap.get(fileId) || fileId;
        allRelevantSources.push({
          file_id: fileId,
          filename: filename,
          score: doc.score || null,
          cited: citationMap.has(fileId)
        });
      }
    }

    // Sort by score (highest first), then by whether it was cited
    allRelevantSources.sort((a, b) => {
      if (b.score !== null && a.score !== null) {
        return b.score - a.score;
      }
      if (b.cited !== a.cited) return b.cited ? 1 : -1;
      return 0;
    });

    console.log(`📋 All relevant sources: ${allRelevantSources.length} documents consulted, ${citationMap.size} cited`);

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
      JSON.stringify({ 
        answer, 
        references,
        all_relevant_sources: allRelevantSources,
        stats: {
          total_consulted: allRelevantSources.length,
          total_cited: citationMap.size,
          consultation_coverage: `${citationMap.size}/${allRelevantSources.length} documentos citados`
        }
      }),
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
