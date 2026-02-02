import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import pdfParse from 'npm:pdf-parse@1.1.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Chunk text into smaller pieces for embedding - optimized for medical content
function chunkText(text: string, chunkSize: number = 1200, overlap: number = 300): string[] {
  const chunks: string[] = [];
  
  // Pre-process: normalize line breaks
  const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  
  // Split by paragraphs first to preserve context
  const paragraphs = normalizedText.split(/\n\n+/);
  
  let currentChunk = '';
  
  for (const paragraph of paragraphs) {
    const trimmedParagraph = paragraph.trim();
    if (!trimmedParagraph) continue;
    
    // If adding this paragraph exceeds chunk size, save current chunk
    if (currentChunk.length + trimmedParagraph.length > chunkSize && currentChunk.length > 0) {
      chunks.push(currentChunk.trim());
      
      // Start new chunk with overlap (last part of previous chunk)
      const words = currentChunk.split(/\s+/);
      const overlapWords = words.slice(-Math.floor(overlap / 5)); // Roughly overlap chars / avg word length
      currentChunk = overlapWords.join(' ') + '\n\n' + trimmedParagraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + trimmedParagraph;
    }
  }
  
  // Add final chunk
  if (currentChunk.trim().length > 0) {
    chunks.push(currentChunk.trim());
  }
  
  // Filter very small chunks but keep medical info (dosages, etc)
  return chunks.filter(chunk => {
    const length = chunk.trim().length;
    // Keep chunks with dosage info even if short
    const hasMedicalInfo = /\d+\s*(mg|ml|kg|mEq|mmol|%|UI|doses)/i.test(chunk);
    return length > 100 || hasMedicalInfo;
  });
}

// Generate embedding using OpenAI
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
    throw new Error(`Embedding failed: ${error}`);
  }

  const data = await response.json();
  return data.data[0].embedding;
}

// Extract text from PDF
async function extractTextFromPDF(pdfBuffer: ArrayBuffer): Promise<string> {
  try {
    console.log('Parsing PDF with pdf-parse...');
    const data = await pdfParse(Buffer.from(pdfBuffer));
    console.log(`✅ Extracted ${data.text.length} characters from ${data.numpages} pages`);
    return data.text;
  } catch (error) {
    console.error('❌ PDF parsing error:', error);
    throw new Error(`Failed to parse PDF: ${error.message}`);
  }
}

// Extract text from scanned/image-based PDF using OCR
async function extractTextWithOCR(pdfBuffer: ArrayBuffer, apiKey: string): Promise<string> {
  console.log('⚠️ PDF appears to be image-based. Using OCR with OpenAI Vision...');
  
  try {
    // Convert PDF to base64
    const base64Pdf = btoa(String.fromCharCode(...new Uint8Array(pdfBuffer)));
    
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Extraia TODO o texto deste documento médico veterinário. Mantenha a formatação, valores numéricos, dosagens e referências bibliográficas exatamente como aparecem. Seja extremamente detalhado e preciso.'
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:application/pdf;base64,${base64Pdf}`
                }
              }
            ]
          }
        ],
        max_tokens: 4000
      }),
    });

    if (!response.ok) {
      throw new Error(`OCR failed: ${await response.text()}`);
    }

    const data = await response.json();
    const extractedText = data.choices[0]?.message?.content || '';
    console.log(`✅ OCR extracted ${extractedText.length} characters`);
    return extractedText;
  } catch (error) {
    console.error('❌ OCR error:', error);
    throw new Error(`OCR extraction failed: ${error.message}`);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Process document function called');

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!openaiApiKey || !supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request
    const contentType = req.headers.get('content-type') || '';
    let documentId: string;
    let documentText: string;
    let documentName: string;

    if (contentType.includes('application/json')) {
      // Reprocess existing document
      const body = await req.json();
      documentId = body.documentId;

      // Get document details from database
      const { data: document, error: docError } = await supabase
        .from('documents')
        .select('*')
        .eq('id', documentId)
        .single();

      if (docError || !document) {
        throw new Error('Document not found');
      }

      documentName = document.original_name;
      console.log(`Processing existing document: ${documentName}`);

      // Download PDF from OpenAI if available
      if (document.openai_file_id && openaiApiKey) {
        console.log('Downloading PDF from OpenAI...');
        try {
          const fileResponse = await fetch(`https://api.openai.com/v1/files/${document.openai_file_id}/content`, {
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
            },
          });

          if (fileResponse.ok) {
            const pdfBuffer = await fileResponse.arrayBuffer();
            try {
              documentText = await extractTextFromPDF(pdfBuffer);
              
              // If text is too short, PDF might be image-based
              if (documentText.length < 100) {
                console.log('Text too short, attempting OCR...');
                documentText = await extractTextWithOCR(pdfBuffer, openaiApiKey);
              }
            } catch (parseError) {
              console.log('Standard parsing failed, trying OCR...');
              documentText = await extractTextWithOCR(pdfBuffer, openaiApiKey);
            }
          } else {
            throw new Error('Could not download file from OpenAI');
          }
        } catch (error) {
          console.error('Error downloading from OpenAI:', error);
          throw new Error(`Failed to retrieve PDF content: ${error.message}`);
        }
      } else {
        throw new Error('No OpenAI file ID found for this document');
      }
      
    } else if (contentType.includes('multipart/form-data')) {
      // Process new upload
      const formData = await req.formData();
      documentId = formData.get('documentId') as string;
      const file = formData.get('file') as File;

      if (!file || !documentId) {
        throw new Error('File and documentId required');
      }

      documentName = file.name;
      console.log(`Processing new upload: ${documentName}`);

      // Extract text from PDF
      const pdfBuffer = await file.arrayBuffer();
      try {
        documentText = await extractTextFromPDF(pdfBuffer);
        
        // If text is too short, PDF might be image-based
        if (documentText.length < 100 && openaiApiKey) {
          console.log('Text too short, attempting OCR...');
          documentText = await extractTextWithOCR(pdfBuffer, openaiApiKey);
        }
      } catch (parseError) {
        if (openaiApiKey) {
          console.log('Standard parsing failed, trying OCR...');
          documentText = await extractTextWithOCR(pdfBuffer, openaiApiKey);
        } else {
          throw parseError;
        }
      }
      
    } else {
      throw new Error('Invalid request format. Use JSON with documentId or multipart/form-data with file');
    }

    console.log(`Processing document ${documentId}: ${documentName}`);
    console.log(`✅ Extracted ${documentText.length} characters from PDF`);

    // Validate extracted text
    if (documentText.length < 50) {
      throw new Error('PDF processing resulted in very little text. The PDF might be empty, corrupted, or incompatible.');
    }

    console.log(`✅ Final text: ${documentText.length} characters ready for chunking`);

    // Chunk the text
    const chunks = chunkText(documentText);
    console.log(`Created ${chunks.length} chunks`);

    // Delete existing chunks for this document
    const { error: deleteError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId);

    if (deleteError) {
      console.error('Error deleting old chunks:', deleteError);
    }

    // Generate embeddings and store chunks
    const chunkRecords = [];
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      console.log(`Processing chunk ${i + 1}/${chunks.length}`);

      try {
        const embedding = await generateEmbedding(chunk, openaiApiKey);
        
        // Extract useful metadata from chunk
        const hasDosageInfo = /\d+\s*(mg|ml|kg|mEq|mmol|%|UI)/i.test(chunk);
        const hasTreatmentInfo = /(tratamento|terapia|medicação|droga|fármaco)/i.test(chunk);
        const hasDiagnosticInfo = /(diagnóstico|exame|teste|análise)/i.test(chunk);
        
        chunkRecords.push({
          document_id: documentId,
          chunk_text: chunk,
          chunk_index: i,
          embedding: embedding,
          metadata: {
            chunk_length: chunk.length,
            has_dosage: hasDosageInfo,
            has_treatment: hasTreatmentInfo,
            has_diagnostic: hasDiagnosticInfo,
            document_name: documentName,
          },
        });
      } catch (error) {
        console.error(`Error processing chunk ${i}:`, error);
      }
    }

    // Insert all chunks
    const { error: insertError } = await supabase
      .from('document_chunks')
      .insert(chunkRecords);

    if (insertError) {
      throw new Error(`Failed to insert chunks: ${insertError.message}`);
    }

    console.log(`Successfully processed ${chunkRecords.length} chunks`);

    return new Response(
      JSON.stringify({
        success: true,
        chunks_created: chunkRecords.length,
        document_id: documentId,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
