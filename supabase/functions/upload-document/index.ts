import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log('Upload document function called');

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
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
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Try to get user from auth header (optional - allows anonymous uploads)
    // Fixed UUID for anonymous users
    const ANONYMOUS_USER_ID = '00000000-0000-0000-0000-000000000000';
    let userId = ANONYMOUS_USER_ID;
    const authHeader = req.headers.get('Authorization');
    
    if (authHeader && authHeader !== `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`) {
      try {
        const jwt = authHeader.replace('Bearer ', '');
        const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
        
        if (!authError && user) {
          userId = user.id;
          console.log('Authenticated user:', userId);
        }
      } catch (e) {
        console.log('Auth check failed, proceeding as anonymous');
      }
    }
    
    console.log('Processing upload for user:', userId);

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get('file') as File;
    const tagsString = formData.get('tags') as string | null;

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse tags
    let tags: string[] = [];
    if (tagsString && tagsString.trim()) {
      tags = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      console.log('Tags received:', tags);
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf', 
      'text/plain', 
      'text/markdown', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
      'application/vnd.ms-excel' // .xls
    ];
    if (!allowedTypes.includes(file.type)) {
      return new Response(
        JSON.stringify({ 
          error: 'Invalid file type. Only PDF, TXT, MD, DOCX, XLSX, and XLS files are allowed.',
          success: false 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Processing file:', file.name, 'Size:', file.size, 'Type:', file.type);

    // Upload file to OpenAI
    const fileBuffer = await file.arrayBuffer();
    const fileBlob = new Blob([fileBuffer], { type: file.type });

    const formDataOpenAI = new FormData();
    formDataOpenAI.append('file', fileBlob, file.name);
    formDataOpenAI.append('purpose', 'assistants');

    console.log('Uploading to OpenAI...');
    const openaiFileResponse = await fetch('https://api.openai.com/v1/files', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiApiKey}` },
      body: formDataOpenAI,
    });

    if (!openaiFileResponse.ok) {
      const errorText = await openaiFileResponse.text();
      console.error('OpenAI file upload error:', errorText);
      return new Response(
        JSON.stringify({ error: `OpenAI upload failed: ${errorText}`, success: false }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const openaiFileData = await openaiFileResponse.json();
    console.log('File uploaded to OpenAI:', openaiFileData.id);

    // Add file to vector store
    console.log('Adding to vector store...');
    const vectorStoreResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ file_id: openaiFileData.id }),
    });

    if (!vectorStoreResponse.ok) {
      const errorText = await vectorStoreResponse.text();
      console.error('Vector store upload error:', errorText);
      // Cleanup OpenAI file on failure
      await fetch(`https://api.openai.com/v1/files/${openaiFileData.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${openaiApiKey}` },
      });
      return new Response(
        JSON.stringify({ error: `Vector store upload failed: ${errorText}`, success: false }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const vectorStoreData = await vectorStoreResponse.json();
    console.log('File added to vector store:', vectorStoreData.id);

    // Create document record in database (no more storage_path)
    const { data: documentRecord, error: dbError } = await supabase
      .from('documents')
      .insert({
        user_id: userId,
        filename: file.name,
        original_name: file.name,
        file_size: file.size,
        mime_type: file.type,
        storage_path: null, // No longer storing files in Supabase
        processing_status: 'completed',
        openai_file_id: openaiFileData.id,
        vector_store_file_id: vectorStoreData.id,
        tags: tags.length > 0 ? tags : []
      })
      .select()
      .single();

    if (dbError) {
      console.error('Database error:', dbError);
      // Cleanup OpenAI resources on failure
      await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${vectorStoreData.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${openaiApiKey}` },
      });
      await fetch(`https://api.openai.com/v1/files/${openaiFileData.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${openaiApiKey}` },
      });
      return new Response(
        JSON.stringify({ error: `Database error: ${dbError.message}`, success: false }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Document created successfully:', documentRecord.id);

    return new Response(
      JSON.stringify({
        success: true,
        documentId: documentRecord.id,
        message: 'Documento enviado e processado com sucesso!',
        processing: false
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in upload-document function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
