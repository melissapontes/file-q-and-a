import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log('Upload document function called');

  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Get environment variables
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const vectorStoreId = Deno.env.get('OPENAI_VECTOR_STORE_ID');

    if (!openaiApiKey || !vectorStoreId) {
      console.error('Missing OpenAI API key or Vector Store ID');
      return new Response(
        JSON.stringify({ 
          error: 'OpenAI API key or Vector Store ID not configured',
          success: false 
        }),
        { 
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    // Create Supabase client
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header', success: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Verify JWT and get user
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(
        JSON.stringify({ error: 'Invalid token', success: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Validate file type
    const allowedTypes = ['application/pdf', 'text/plain', 'text/markdown', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    if (!allowedTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({ 
          error: 'Invalid file type. Only PDF, TXT, MD, and DOCX files are allowed.',
          success: false 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Generate file path
    const fileExtension = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExtension}`;
    const filePath = `${user.id}/${fileName}`;

    console.log('Uploading file to Supabase Storage:', filePath);

    // Upload to Supabase Storage
    const { data: storageData, error: storageError } = await supabase.storage
      .from('documents')
      .upload(filePath, file, {
        contentType: file.type,
      });

    if (storageError) {
      console.error('Storage error:', storageError);
      return new Response(
        JSON.stringify({ 
          error: `Storage upload failed: ${storageError.message}`,
          success: false 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Create document record in database
    const { data: documentRecord, error: dbError } = await supabase
      .from('documents')
      .insert({
        user_id: user.id,
        filename: fileName,
        original_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        storage_path: filePath,
        processing_status: 'processing'
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      // Clean up storage file if DB insert fails
      await supabase.storage.from('documents').remove([filePath]);
      return new Response(
        JSON.stringify({ 
          error: `Database error: ${dbError.message}`,
          success: false 
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Background task to process with OpenAI
    const backgroundTask = async () => {
      try {
        console.log('Starting OpenAI processing for document:', documentRecord.id);

        // Convert file to buffer for OpenAI
        const fileBuffer = await file.arrayBuffer();
        const fileBlob = new Blob([fileBuffer], { type: file.type });

        // Upload file to OpenAI
        const formDataOpenAI = new FormData();
        formDataOpenAI.append('file', fileBlob, file.name);
        formDataOpenAI.append('purpose', 'assistants');

        const openaiFileResponse = await fetch('https://api.openai.com/v1/files', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
          },
          body: formDataOpenAI,
        });

        if (!openaiFileResponse.ok) {
          const errorText = await openaiFileResponse.text();
          console.error('OpenAI file upload error:', errorText);
          throw new Error(`OpenAI file upload failed: ${errorText}`);
        }

        const openaiFileData = await openaiFileResponse.json();
        console.log('File uploaded to OpenAI:', openaiFileData.id);

        // Add file to vector store
        const vectorStoreResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            file_id: openaiFileData.id,
          }),
        });

        if (!vectorStoreResponse.ok) {
          const errorText = await vectorStoreResponse.text();
          console.error('Vector store upload error:', errorText);
          throw new Error(`Vector store upload failed: ${errorText}`);
        }

        const vectorStoreData = await vectorStoreResponse.json();
        console.log('File added to vector store:', vectorStoreData.id);

        // Update document record with success
        await supabase
          .from('documents')
          .update({
            openai_file_id: openaiFileData.id,
            vector_store_file_id: vectorStoreData.id,
            processing_status: 'completed'
          })
          .eq('id', documentRecord.id);

        console.log('Document processing completed successfully');

      } catch (error) {
        console.error('Background processing error:', error);
        
        // Update document record with error
        await supabase
          .from('documents')
          .update({
            processing_status: 'error',
            error_message: error instanceof Error ? error.message : 'Unknown error occurred'
          })
          .eq('id', documentRecord.id);
      }
    };

    // Start background processing (fire and forget)
    backgroundTask().catch(console.error);

    console.log('Document upload initiated successfully');

    return new Response(
      JSON.stringify({
        success: true,
        documentId: documentRecord.id,
        message: 'Upload iniciado com sucesso. O processamento pode levar alguns segundos.',
        processing: true
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error in upload-document function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        success: false 
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});