import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Helper function to format reference titles - keeps full article name with year
function formatReferenceTitle(filename: string): string {
  // Remove file extension
  let name = filename.replace(/\.(pdf|txt|md|docx)$/i, "");

  // Try to extract year from various patterns
  const yearPatterns = [
    /(\d{4})/, // Simple 4 digit year
    /[-_\s](\d{4})[-_\s]/, // Year surrounded by separators
    /\((\d{4})\)/, // Year in parentheses
  ];

  let year = "";
  for (const pattern of yearPatterns) {
    const match = name.match(pattern);
    if (match && parseInt(match[1]) >= 1990 && parseInt(match[1]) <= 2030) {
      year = match[1];
      break;
    }
  }

  // Clean up the title - keep the full name but make it readable
  name = name
    .replace(/[-_]/g, " ") // Replace dashes and underscores with spaces
    .replace(/\s*\(\d+\)\s*$/g, "") // Remove ONLY trailing version numbers like (1), (2) at end
    .replace(/\s+/g, " ") // Normalize multiple spaces
    .trim();

  // If the name is too short (like "JVIM 38 878"), it's likely a journal reference - keep as is with more context
  // Don't remove the numbers if they seem to be part of the citation reference

  // Format as "Full Article Title (Year)" if year found, otherwise just the cleaned name
  if (year && !name.includes(year)) {
    return `${name} (${year})`;
  }

  return name;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log("Ask document function called");

    // Get environment variables
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const vectorStoreId = Deno.env.get("OPENAI_VECTOR_STORE_ID");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!openaiApiKey || !vectorStoreId) {
      throw new Error("Missing required environment variables: OPENAI_API_KEY or OPENAI_VECTOR_STORE_ID");
    }

    // Parse request - can be JSON or FormData
    const contentType = req.headers.get("content-type") || "";
    let question = "";
    let uploadedFileIds: string[] = [];
    let imageContext = "";

    if (contentType.includes("multipart/form-data")) {
      // Handle file uploads
      const formData = await req.formData();
      question = formData.get("question") as string;
      const files = formData.getAll("files") as File[];

      console.log(`Processing question with ${files.length} attached files`);

      // Process files based on type
      for (const file of files) {
        try {
          const fileName = file.name.toLowerCase();
          const isImage = fileName.endsWith(".jpg") || fileName.endsWith(".jpeg") || fileName.endsWith(".png");

          if (isImage) {
            // Process image with Vision API
            console.log(`Processing image file with Vision API: ${file.name}`);
            const fileBuffer = await file.arrayBuffer();
            const base64Image = btoa(String.fromCharCode(...new Uint8Array(fileBuffer)));
            const mimeType = file.type || "image/jpeg";

            // Use Vision API to extract text from image
            const visionResponse = await fetch("https://api.openai.com/v1/chat/completions", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${openaiApiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                model: "gpt-4o-mini",
                messages: [
                  {
                    role: "user",
                    content: [
                      {
                        type: "text",
                        text: "Por favor, extraia TODAS as informações deste documento médico/laudo. Liste todos os valores, resultados, diagnósticos e observações presentes. Seja detalhado e preciso.",
                      },
                      {
                        type: "image_url",
                        image_url: {
                          url: `data:${mimeType};base64,${base64Image}`,
                        },
                      },
                    ],
                  },
                ],
                max_tokens: 2000,
              }),
            });

            if (visionResponse.ok) {
              const visionData = await visionResponse.json();
              const extractedText = visionData.choices[0]?.message?.content || "";
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
            uploadFormData.append("file", blob, file.name);
            uploadFormData.append("purpose", "assistants");

            const uploadResponse = await fetch("https://api.openai.com/v1/files", {
              method: "POST",
              headers: {
                Authorization: `Bearer ${openaiApiKey}`,
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
      throw new Error("Question is required");
    }

    console.log("Processing question:", question);
    console.log(`Using vector store: ${vectorStoreId}`);

    // Fetch documents with tags from Supabase
    let documentsWithTags: { openai_file_id: string; tags: string[]; original_name: string }[] = [];
    if (supabaseUrl && supabaseServiceKey) {
      try {
        const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.58.0");
        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        const { data, error } = await supabase
          .from("documents")
          .select("openai_file_id, tags, original_name")
          .eq("processing_status", "completed")
          .not("openai_file_id", "is", null);

        if (!error && data) {
          documentsWithTags = data.map((doc) => ({
            openai_file_id: doc.openai_file_id!,
            tags: doc.tags || [],
            original_name: doc.original_name,
          }));
          console.log(`Fetched ${documentsWithTags.length} documents with tags from Supabase`);
        }
      } catch (e) {
        console.error("Error fetching documents from Supabase:", e);
      }
    }

    // Step 0: List all files in the vector store
    console.log("Listing all files in vector store...");
    const filesResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
    });

    let filesList = "Arquivos disponíveis no vector store: (nenhum encontrado)";
    let filesListWithNames = ""; // Lista legível com nomes dos arquivos
    // Files present in the vector store with their human filenames
    const vectorFiles: { id: string; filename: string }[] = [];
    // Files we want to prioritize for the current question (by heuristics)
    let preferredFileIds: string[] = [];
    // Track if user requested a specific document by name
    let specificDocumentRequested: { id: string; filename: string; originalName: string } | null = null;

    if (filesResponse.ok) {
      const filesData = await filesResponse.json();
      if (filesData.data && filesData.data.length > 0) {
        const fileIds: string[] = filesData.data.map((f: any) => f.id);

        // Fetch filenames for each file id so we can apply simple heuristics
        for (const id of fileIds) {
          try {
            const fr = await fetch(`https://api.openai.com/v1/files/${id}`, {
              headers: { Authorization: `Bearer ${openaiApiKey}` },
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

        // Criar lista legível com nomes de arquivos
        const fileNames = vectorFiles.map((f) => f.filename).filter((name) => !name.startsWith("file-"));
        filesListWithNames =
          fileNames.length > 0
            ? `DOCUMENTOS DISPONÍVEIS NA BASE:\n${fileNames.map((name, i) => `${i + 1}. ${name}`).join("\n")}`
            : "";

        filesList = `Arquivos disponíveis no vector store (${vectorFiles.length} arquivos): ${vectorFiles.map((f) => f.id).join(", ")}`;
        console.log(filesList);
        console.log("Nomes dos arquivos:", fileNames);

        // Enhanced heuristic using tags and filename matching with bilingual support
        const qLower = question.toLowerCase();

        // ========== SPECIFIC DOCUMENT DETECTION ==========
        // Check if user is asking about a SPECIFIC document by name
        
        // Patterns that indicate user is asking about a specific document
        const specificDocPatterns = [
          /(?:no documento|do documento|no artigo|do artigo|no arquivo|do arquivo)\s+["""]?([^"""\?]+)["""]?/i,
          /documento\s+["""]?([^"""\?]+)["""]?\s+(?:é|fala|menciona|trata|aborda|diz)/i,
          /(?:seções|seção|partes|parte)\s+(?:do|no)\s+(?:documento|artigo)\s+["""]?([^"""\?]+)["""]?/i,
        ];
        
        for (const pattern of specificDocPatterns) {
          const match = question.match(pattern);
          if (match && match[1]) {
            const requestedDocName = match[1].trim().toLowerCase();
            console.log(`Detected specific document request: "${requestedDocName}"`);
            
            // Find matching document in vector store
            for (const vf of vectorFiles) {
              const docData = documentsWithTags.find((d) => d.openai_file_id === vf.id);
              const originalNameLower = (docData?.original_name || vf.filename).toLowerCase();
              const filenameLower = vf.filename.toLowerCase();
              
              // Check if the requested name matches this document
              // Use fuzzy matching - check if most words match
              const requestedWords = requestedDocName.split(/\s+/).filter(w => w.length > 2);
              const matchingWords = requestedWords.filter(word => 
                originalNameLower.includes(word) || filenameLower.includes(word)
              );
              
              // If at least 70% of words match, consider it a match
              if (matchingWords.length >= requestedWords.length * 0.7) {
                specificDocumentRequested = {
                  id: vf.id,
                  filename: vf.filename,
                  originalName: docData?.original_name || vf.filename
                };
                console.log(`MATCHED to specific document: ${specificDocumentRequested.originalName}`);
                break;
              }
            }
            
            if (specificDocumentRequested) break;
          }
        }

        // Extract potential keywords from the question
        const questionWords = qLower.split(/\s+/).filter((w) => w.length > 3);

        // Bilingual term mappings (Portuguese <-> English)
        const termTranslations: Record<string, string[]> = {
          oxalato: ["oxalate", "oxalato", "caox"],
          oxalate: ["oxalato", "oxalate", "caox"],
          calcio: ["calcium", "calcio", "cálcio"],
          calcium: ["calcio", "calcium", "cálcio"],
          cálcio: ["calcium", "calcio", "cálcio"],
          urolitíase: ["urolithiasis", "urolitiase", "uroliths", "urolith"],
          urolithiasis: ["urolitíase", "urolitiase", "uroliths"],
          cálculo: ["stone", "stones", "calculi", "calculus", "calculo"],
          calculo: ["stone", "stones", "calculi", "calculus", "cálculo"],
          pedra: ["stone", "stones", "calculi"],
          estruvita: ["struvite", "estruvita"],
          struvite: ["estruvita", "struvite"],
          renal: ["kidney", "renal", "rim", "rins"],
          rim: ["kidney", "renal", "rim", "rins"],
          bexiga: ["bladder", "vesical", "bexiga"],
          bladder: ["bexiga", "vesical", "bladder"],
        };

        // Expand question words with translations
        const expandedTerms = new Set<string>();
        questionWords.forEach((word) => {
          expandedTerms.add(word);
          // Check if word matches any key or value in translations
          Object.entries(termTranslations).forEach(([key, values]) => {
            if (word.includes(key) || key.includes(word)) {
              values.forEach((v) => expandedTerms.add(v));
              expandedTerms.add(key);
            }
          });
        });

        // Add specific topic detection
        const isOxalateQuestion = qLower.includes("oxalato") || qLower.includes("oxalate");
        const isUrolithQuestion =
          qLower.includes("urolití") ||
          qLower.includes("urólito") ||
          qLower.includes("urolith") ||
          qLower.includes("cálculo") ||
          qLower.includes("calculo") ||
          qLower.includes("pedra");
        const isStruviteQuestion = qLower.includes("estruvita") || qLower.includes("struvite");

        if (isOxalateQuestion) {
          ["oxalate", "oxalato", "calcium", "calcio", "caox", "urolithiasis", "urolitíase"].forEach((t) =>
            expandedTerms.add(t),
          );
        }
        if (isUrolithQuestion) {
          ["urolithiasis", "urolitíase", "urolith", "urólito", "stone", "stones", "calculi"].forEach((t) =>
            expandedTerms.add(t),
          );
        }
        if (isStruviteQuestion) {
          ["struvite", "estruvita", "map", "magnesium", "ammonium", "phosphate"].forEach((t) => expandedTerms.add(t));
        }

        console.log("Expanded search terms:", Array.from(expandedTerms).join(", "));

        // ========== DOCUMENT SELECTION LOGIC ==========
        // If a specific document was requested, ONLY use that document
        if (specificDocumentRequested) {
          preferredFileIds = [specificDocumentRequested.id];
          console.log(`RESTRICTED to single document: ${specificDocumentRequested.originalName}`);
        } else {
          // Score each document based on tag and filename relevance
          const scoredFiles = vectorFiles.map((vf) => {
            let score = 0;
            const nameLower = vf.filename.toLowerCase();

            // Find matching document in Supabase data
            const docData = documentsWithTags.find((d) => d.openai_file_id === vf.id);
            const originalNameLower = docData?.original_name?.toLowerCase() || "";

            // Score based on expanded terms matching filename or original name
            const expandedArray = Array.from(expandedTerms);

            expandedArray.forEach((term) => {
              if (nameLower.includes(term)) score += 15;
              if (originalNameLower.includes(term)) score += 15;
            });

            // Score based on tags
            if (docData && docData.tags && docData.tags.length > 0) {
              docData.tags.forEach((tag) => {
                const tagLower = tag.toLowerCase();
                // Direct tag match with question
                if (expandedArray.some((term) => tagLower.includes(term) || term.includes(tagLower))) {
                  score += 20;
                }
                // Special boost for Urolitíase tag when asking about stones/calculi
                if (
                  (isOxalateQuestion || isUrolithQuestion || isStruviteQuestion) &&
                  (tagLower.includes("urolitíase") || tagLower.includes("urolithiasis") || tagLower.includes("urolith"))
                ) {
                  score += 25;
                }
              });
            }

            // Specific content boosts
            if (isOxalateQuestion) {
              if (nameLower.includes("oxalate") || originalNameLower.includes("oxalate")) score += 30;
              if (nameLower.includes("calcium") || originalNameLower.includes("calcium")) score += 20;
              // ACVIM consensus covers all uroliths including oxalate
              if (
                nameLower.includes("acvim") ||
                nameLower.includes("consensus") ||
                originalNameLower.includes("acvim") ||
                originalNameLower.includes("consensus")
              )
                score += 25;
              // Mineral composition studies
              if (
                nameLower.includes("mineral") ||
                nameLower.includes("composition") ||
                originalNameLower.includes("mineral") ||
                originalNameLower.includes("composition")
              )
                score += 20;
            }

            if (isStruviteQuestion) {
              if (nameLower.includes("struvite") || originalNameLower.includes("struvite")) score += 30;
            }

            return { id: vf.id, filename: vf.filename, originalName: docData?.original_name || vf.filename, score };
          });

          // Sort by score and take ALL candidates with score > 0 (not just top 5)
          scoredFiles.sort((a, b) => b.score - a.score);
          preferredFileIds = scoredFiles.filter((sf) => sf.score > 0).map((sf) => sf.id);

          if (preferredFileIds.length > 0) {
            console.log(`Prioritizing ${preferredFileIds.length} files based on tags and relevance:`);
            scoredFiles
              .filter((sf) => sf.score > 0)
              .forEach((sf) => {
                console.log(`  - ${sf.originalName} (score: ${sf.score})`);
              });
          }
        }
      }
    } else {
      console.error("Could not list files:", await filesResponse.text());
    }

    // Step 1: Create an Assistant with file_search
    console.log("Creating Assistant...");
    
    // Build dynamic instructions based on whether a specific document was requested
    let assistantInstructions = `Você é um assistente especializado em nefrologia veterinária.

REGRAS OBRIGATÓRIAS:

1. USE A FERRAMENTA file_search para buscar informações nos documentos ANTES de responder. Faça buscas com termos em INGLÊS E PORTUGUÊS para encontrar todos os documentos relevantes.

2. CITE TODAS AS FONTES: Cada afirmação deve ter uma citação inline do documento de origem.

3. Se não encontrar informações nos documentos, responda: "❌ Assunto não encontrado na base de conhecimento"

4. Responda em português brasileiro.`;

    // If a specific document was requested, add strict restriction
    if (specificDocumentRequested) {
      assistantInstructions = `Você é um assistente especializado em nefrologia veterinária.

⚠️ RESTRIÇÃO CRÍTICA: O usuário pediu informações de UM DOCUMENTO ESPECÍFICO:
"${specificDocumentRequested.originalName}"

REGRAS OBRIGATÓRIAS:

1. USE A FERRAMENTA file_search para buscar informações SOMENTE no documento especificado acima.

2. NÃO USE informações de outros documentos. Se encontrar informações em outros artigos, IGNORE-AS.

3. Se a informação NÃO estiver presente no documento específico solicitado, responda: "❌ Esta informação não foi encontrada no documento '${specificDocumentRequested.originalName}'"

4. CITE APENAS o documento solicitado. Cada afirmação deve ter uma citação inline desse documento.

5. Se você citar QUALQUER outro documento que não seja "${specificDocumentRequested.originalName}", isso será considerado um ERRO GRAVE.

6. Responda em português brasileiro.`;
      
      console.log(`Using RESTRICTED instructions for single document: ${specificDocumentRequested.originalName}`);
    } else {
      assistantInstructions += `

4. USE TODOS OS DOCUMENTOS: Busque em todos os documentos que tenham o assunto pesquisado e referencie todos no texto retornado para o usuário.`;
    }

    const assistantResponse = await fetch("https://api.openai.com/v1/assistants", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        name: "Nefrologia Veterinária RAG",
        instructions: assistantInstructions,
        model: "gpt-4o-mini",
        tools: [
          {
            type: "file_search",
          },
        ],
        tool_resources: {
          file_search: {
            vector_store_ids: [vectorStoreId],
          },
        },
      }),
    });

    if (!assistantResponse.ok) {
      const error = await assistantResponse.text();
      console.error("Error creating assistant:", error);
      throw new Error(`Erro ao criar assistente: ${error}`);
    }

    const assistant = await assistantResponse.json();
    console.log("Assistant created:", assistant.id);

    // Step 2: Create a Thread
    console.log("Creating Thread...");
    const threadResponse = await fetch("https://api.openai.com/v1/threads", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({}),
    });

    if (!threadResponse.ok) {
      const error = await threadResponse.text();
      console.error("Error creating thread:", error);
      throw new Error(`Erro ao criar thread: ${error}`);
    }

    const thread = await threadResponse.json();
    console.log("Thread created:", thread.id);

    // Step 3: Add user message to Thread (with attached files and image context)
    console.log("Adding message to thread...");

    // Build list of relevant document names to include in the question
    let relevantDocsContext = "";
    
    // Different context for specific document vs multiple documents
    if (specificDocumentRequested) {
      // STRICT: Only reference the specific document
      relevantDocsContext = `\n\n---\n⚠️ **DOCUMENTO ÚNICO SOLICITADO (USE APENAS ESTE):**\n${specificDocumentRequested.originalName}\n\n**RESTRIÇÃO ABSOLUTA:** Responda APENAS com informações deste documento. NÃO cite outros documentos. Se a informação não estiver NESTE documento específico, diga que não foi encontrada.`;
      console.log(`Injected SINGLE document restriction: ${specificDocumentRequested.originalName}`);
    } else if (preferredFileIds && preferredFileIds.length > 0) {
      const relevantDocNames = preferredFileIds
        .map((fid) => {
          const doc = documentsWithTags.find((d) => d.openai_file_id === fid);
          return doc?.original_name || vectorFiles.find((v) => v.id === fid)?.filename || fid;
        })
        .filter((name) => !name.startsWith("file-"));

      if (relevantDocNames.length > 0) {
        relevantDocsContext = `\n\n---\n**DOCUMENTOS RELEVANTES QUE VOCÊ DEVE CONSULTAR E CITAR (TODOS ELES):**\n${relevantDocNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}\n\nVocê DEVE buscar informações em CADA um desses documentos e citá-los na sua resposta. NÃO ignore nenhum documento da lista acima.`;
        console.log(`Injected ${relevantDocNames.length} relevant document names into user message`);
      }
    }

    // Combine question with image context and relevant docs context
    let fullQuestion = question + relevantDocsContext;
    if (imageContext) {
      fullQuestion += imageContext;
      console.log("Added image context to question");
    }

    const messageBody: any = {
      role: "user",
      content: fullQuestion,
    };

    // Attach prioritized vector-store files first (to bias retrieval)
    const allAttachments: any[] = [];
    if (typeof preferredFileIds !== "undefined" && preferredFileIds.length > 0) {
      allAttachments.push(...preferredFileIds.map((fileId) => ({ file_id: fileId, tools: [{ type: "file_search" }] })));
    }

    // Then attach any ad-hoc files uploaded with the question
    if (uploadedFileIds.length > 0) {
      allAttachments.push(...uploadedFileIds.map((fileId) => ({ file_id: fileId, tools: [{ type: "file_search" }] })));
    }

    if (allAttachments.length > 0) {
      messageBody.attachments = allAttachments;
      console.log(
        `Attaching ${allAttachments.length} files to message (preferred: ${preferredFileIds?.length || 0}, uploaded: ${uploadedFileIds.length})`,
      );
    }

    const messageResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify(messageBody),
    });

    if (!messageResponse.ok) {
      const error = await messageResponse.text();
      console.error("Error adding message:", error);
      throw new Error(`Erro ao adicionar mensagem: ${error}`);
    }

    console.log("Message added to thread");

    // Step 4: Run the Assistant
    console.log("Running assistant...");
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "assistants=v2",
      },
      body: JSON.stringify({
        assistant_id: assistant.id,
      }),
    });

    if (!runResponse.ok) {
      const error = await runResponse.text();
      console.error("Error running assistant:", error);
      throw new Error(`Erro ao executar assistente: ${error}`);
    }

    const run = await runResponse.json();
    console.log("Run started:", run.id);

    // Step 5: Poll for completion with extended timeout
    let runStatus = run.status;
    let attempts = 0;
    const maxAttempts = 60; // 120 seconds max (60 * 2s)
    const pollInterval = 2000; // Poll every 2 seconds

    while (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled" && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, pollInterval));

      const statusResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "OpenAI-Beta": "assistants=v2",
        },
      });

      if (!statusResponse.ok) {
        const error = await statusResponse.text();
        console.error("Error checking run status:", error);
        throw new Error(`Erro ao verificar status: ${error}`);
      }

      const statusData = await statusResponse.json();
      runStatus = statusData.status;
      attempts++;

      // Log less frequently to reduce noise
      if (attempts % 5 === 0 || runStatus === "completed" || runStatus === "failed") {
        console.log(`Run status: ${runStatus} (attempt ${attempts}/${maxAttempts})`);
      }
    }

    if (runStatus === "failed") {
      throw new Error("O assistente falhou ao processar a pergunta");
    }

    if (runStatus !== "completed") {
      throw new Error("Timeout: O assistente demorou muito para responder");
    }

    // Step 6: Get the assistant's response
    console.log("Retrieving assistant response...");
    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      headers: {
        Authorization: `Bearer ${openaiApiKey}`,
        "OpenAI-Beta": "assistants=v2",
      },
    });

    if (!messagesResponse.ok) {
      const error = await messagesResponse.text();
      console.error("Error retrieving messages:", error);
      throw new Error(`Erro ao recuperar mensagens: ${error}`);
    }

    const messagesData = await messagesResponse.json();
    const assistantMessages = messagesData.data.filter((msg: any) => msg.role === "assistant");

    let answer = "Desculpe, não consegui gerar uma resposta.";
    let references: string[] = [];

    if (assistantMessages.length > 0) {
      const lastMessage = assistantMessages[0];
      const textContent = lastMessage.content.find((c: any) => c.type === "text");
      if (textContent) {
        let rawAnswer = textContent.text.value;

        // Process annotations (citations)
        const annotations = textContent.text.annotations || [];
        console.log(`Found ${annotations.length} annotations in response`);

        // Build a map of file IDs to filenames (prefer original_name from Supabase)
        const citationMap = new Map<string, string>();

        for (const annotation of annotations) {
          if (annotation.type === "file_citation") {
            const fileId = annotation.file_citation?.file_id;
            if (fileId && !citationMap.has(fileId)) {
              // First, try to find the original_name from Supabase documents
              const docFromSupabase = documentsWithTags.find((d) => d.openai_file_id === fileId);

              if (docFromSupabase && docFromSupabase.original_name) {
                // Use the original name from Supabase (full article title)
                citationMap.set(fileId, docFromSupabase.original_name);
                console.log(`Reference found from Supabase: ${docFromSupabase.original_name}`);
              } else {
                // Fallback to fetching from OpenAI
                try {
                  const fileResponse = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
                    headers: {
                      Authorization: `Bearer ${openaiApiKey}`,
                    },
                  });

                  if (fileResponse.ok) {
                    const fileData = await fileResponse.json();
                    const filename = fileData.filename || fileId;
                    citationMap.set(fileId, filename);
                    console.log(`Reference found from OpenAI: ${filename}`);
                  }
                } catch (e) {
                  console.error(`Error fetching file details for ${fileId}:`, e);
                  citationMap.set(fileId, fileId);
                }
              }
            }
          }
        }

        // Log annotation structure for debugging
        if (annotations.length > 0) {
          console.log(`First annotation structure: ${JSON.stringify(annotations[0])}`);
        }

        // ========== CITATION VALIDATION ==========
        // Filter out citations from documents that are NOT in the preferred list
        // This ensures we only cite documents that are actually relevant to the query
        
        let validAnnotations = annotations;
        let invalidCitationsRemoved = 0;
        
        if (preferredFileIds && preferredFileIds.length > 0 && !specificDocumentRequested) {
          // For general queries: only accept citations from prioritized documents
          validAnnotations = annotations.filter((a: any) => {
            if (a.type !== "file_citation") return true;
            const fileId = a.file_citation?.file_id;
            if (!fileId) return false;
            const isValid = preferredFileIds.includes(fileId);
            if (!isValid) {
              const docName = citationMap.get(fileId) || fileId;
              console.log(`REMOVED invalid citation from non-prioritized document: ${docName}`);
              invalidCitationsRemoved++;
            }
            return isValid;
          });
        } else if (specificDocumentRequested) {
          // For specific document queries: ONLY accept citations from that document
          validAnnotations = annotations.filter((a: any) => {
            if (a.type !== "file_citation") return true;
            const fileId = a.file_citation?.file_id;
            if (!fileId) return false;
            const isValid = fileId === specificDocumentRequested.id;
            if (!isValid) {
              const docName = citationMap.get(fileId) || fileId;
              console.log(`REMOVED invalid citation from wrong document: ${docName} (expected: ${specificDocumentRequested.originalName})`);
              invalidCitationsRemoved++;
            }
            return isValid;
          });
        }
        
        if (invalidCitationsRemoved > 0) {
          console.log(`Filtered out ${invalidCitationsRemoved} citations from non-relevant documents`);
        }

        // Helper to normalize document names for deduplication
        const normalizeDocName = (name: string): string => {
          return name
            .replace(/\.(pdf|txt|md|docx)$/i, "") // Remove extension
            .replace(/\s*\(\d+\)\s*$/g, "") // Remove trailing (1), (2), etc.
            .replace(/[-_]/g, " ") // Normalize separators
            .replace(/\s+/g, " ") // Normalize spaces
            .trim()
            .toLowerCase();
        };

        // Build a map from fileId to normalized document name (only for valid citations)
        const fileIdToNormalizedName = new Map<string, string>();
        const normalizedNameToCanonicalFileId = new Map<string, string>();

        for (const annotation of validAnnotations) {
          if (annotation.type === "file_citation") {
            const fileId = annotation.file_citation?.file_id;
            if (fileId && citationMap.has(fileId)) {
              const filename = citationMap.get(fileId)!;
              const normalized = normalizeDocName(filename);
              fileIdToNormalizedName.set(fileId, normalized);

              // Keep the first fileId encountered for each normalized name
              if (!normalizedNameToCanonicalFileId.has(normalized)) {
                normalizedNameToCanonicalFileId.set(normalized, fileId);
              }
            }
          }
        }

        // First pass: find unique documents (by normalized name) in order of appearance
        const uniqueNormalizedNames: string[] = [];

        // Process annotations in the order they appear in the text (by start_index) - only valid ones
        const sortedAnnotations = [...validAnnotations]
          .filter((a) => a.type === "file_citation" && a.file_citation?.file_id)
          .sort((a, b) => (a.start_index || 0) - (b.start_index || 0));

        for (const annotation of sortedAnnotations) {
          const fileId = annotation.file_citation?.file_id;
          if (fileId) {
            const normalized = fileIdToNormalizedName.get(fileId) || fileId;
            if (!uniqueNormalizedNames.includes(normalized)) {
              uniqueNormalizedNames.push(normalized);
            }
          }
        }

        // Create numbered reference list based on normalized names
        const normalizedNameToNumber = new Map<string, number>();
        uniqueNormalizedNames.forEach((normalized, index) => {
          normalizedNameToNumber.set(normalized, index + 1);
        });

        // Map each fileId to its reference number (through normalized name)
        const fileIdToNumber = new Map<string, number>();
        for (const [fileId, normalized] of fileIdToNormalizedName.entries()) {
          const num = normalizedNameToNumber.get(normalized);
          if (num) {
            fileIdToNumber.set(fileId, num);
          }
        }

        console.log(`References in order of appearance: ${uniqueNormalizedNames.length}`);
        console.log(`Unique documents (deduplicated): ${uniqueNormalizedNames.join(", ")}`);

        // Replace annotations using start_index and end_index (reverse order to preserve indices)
        // IMPORTANT: Replace ALL annotations, but use empty string for invalid ones
        const annotationsToReplace = [...annotations]
          .filter(
            (a) =>
              a.type === "file_citation" &&
              a.file_citation?.file_id &&
              typeof a.start_index === "number" &&
              typeof a.end_index === "number",
          )
          .sort((a, b) => b.start_index - a.start_index);

        answer = rawAnswer;
        for (const annotation of annotationsToReplace) {
          const fileId = annotation.file_citation.file_id;
          const num = fileIdToNumber.get(fileId);
          
          if (typeof annotation.start_index === "number" && typeof annotation.end_index === "number") {
            if (num) {
              // Valid citation - replace with numbered reference
              answer = answer.slice(0, annotation.start_index) + ` **[${num}]**` + answer.slice(annotation.end_index);
            } else {
              // Invalid citation - remove it completely
              answer = answer.slice(0, annotation.start_index) + answer.slice(annotation.end_index);
            }
          }
        }

        // Remove "Documentos utilizados" section and similar patterns
        answer = answer
          .replace(/\n*(\*\*)?Documentos? utilizados?(\*\*)?:?\n[\s\S]*?(?=\n\n|$)/gi, "")
          .replace(/\n*(\*\*)?Fontes? consultadas?(\*\*)?:?\n[\s\S]*?(?=\n\n|$)/gi, "")
          .replace(/\n*(\*\*)?Referências?(\*\*)?:?\n[\s\S]*?(?=\n\n|$)/gi, "")
          .replace(/\n*-\s*"[^"]+\.(pdf|txt|docx|md)"\s*$/gim, "")
          .trim();

        // Format references - use canonical fileId for each normalized name
        references = uniqueNormalizedNames.map((normalized, index) => {
          const canonicalFileId = normalizedNameToCanonicalFileId.get(normalized);
          const filename = canonicalFileId ? citationMap.get(canonicalFileId) || canonicalFileId : normalized;
          const cleanName = formatReferenceTitle(filename);
          return `[${index + 1}] ${cleanName}`;
        });
        
        console.log(`Processed answer with ${references.length} unique references (after validation)`);
        
        // If all citations were removed, add a warning
        if (annotations.length > 0 && references.length === 0) {
          console.log("WARNING: All citations were from non-relevant documents and were removed");
          answer += "\n\n⚠️ **Nota:** A resposta foi gerada mas as citações automáticas não correspondiam aos documentos relevantes para sua pergunta. Por favor, refine sua pergunta ou verifique os documentos disponíveis.";
        }
      }
    }

    console.log("Response retrieved successfully");

    // Cleanup: Delete the assistant (optional, to avoid accumulating assistants)
    try {
      await fetch(`https://api.openai.com/v1/assistants/${assistant.id}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${openaiApiKey}`,
          "OpenAI-Beta": "assistants=v2",
        },
      });
      console.log("Assistant deleted");
    } catch (e) {
      console.log("Could not delete assistant:", e);
    }

    console.log("Generated answer successfully");

    // Cleanup uploaded files
    if (uploadedFileIds.length > 0) {
      console.log("Cleaning up temporary files...");
      for (const fileId of uploadedFileIds) {
        try {
          await fetch(`https://api.openai.com/v1/files/${fileId}`, {
            method: "DELETE",
            headers: {
              Authorization: `Bearer ${openaiApiKey}`,
            },
          });
        } catch (e) {
          console.log(`Could not delete file ${fileId}:`, e);
        }
      }
    }

    return new Response(JSON.stringify({ answer, references }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in ask-document function:", error);

    // Extract specific error message
    let errorMessage = "Erro interno do servidor";
    let errorDetails = "";

    if (error instanceof Error) {
      errorMessage = error.message;
      errorDetails = error.stack || "";
    }

    return new Response(
      JSON.stringify({
        error: errorMessage,
        details: errorDetails,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      },
    );
  }
});
