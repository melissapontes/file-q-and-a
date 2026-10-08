import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import { ingestDocument } from '../_shared/rag.ts';

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
    const geminiKey = Deno.env.get('GEMINI_API_KEY');

    if (!geminiKey) {
      console.error('Missing GEMINI_API_KEY');
      return new Response(
        JSON.stringify({ error: 'GEMINI_API_KEY not configured', success: false }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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
    const tagsString = formData.get('tags') as string | null;
    const replaceDocId = formData.get('replaceDocId') as string | null;

    if (!file) {
      return new Response(
        JSON.stringify({ error: 'No file provided', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Parse tags from comma-separated string
    let tags: string[] = [];
    if (tagsString && tagsString.trim()) {
      tags = tagsString.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      console.log('Tags received:', tags);
    }

    // If replacing an existing document, delete it first
    if (replaceDocId) {
      console.log('Replacing existing document:', replaceDocId);
      
      // Get old document info (storage path) — os trechos indexados saem junto (ON DELETE CASCADE)
      const { data: oldDoc, error: oldDocError } = await supabase
        .from('documents')
        .select('storage_path')
        .eq('id', replaceDocId)
        .eq('user_id', user.id)
        .single();

      if (oldDocError) {
        console.error('Error fetching old document:', oldDocError);
      } else if (oldDoc?.storage_path) {
        await supabase.storage.from('documents').remove([oldDoc.storage_path]);
        console.log('Deleted old file from storage');
      }

      // Delete old document record
      await supabase.from('documents').delete().eq('id', replaceDocId);
      console.log('Deleted old document record');
    }

    // Validate file type
    const allowedTypes = [
      'application/pdf', 
      'text/plain', 
      'text/markdown', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
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
        processing_status: 'processing',
        tags: tags.length > 0 ? tags : []
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

    // Indexação em segundo plano: extrai o texto, divide em trechos e gera embeddings (Gemini)
    const backgroundTask = ingestDocument(supabase, documentRecord.id, geminiKey, { deadline: Date.now() + 240_000 })
      .then((r) => console.log('✅ Document indexed:', JSON.stringify(r)))
      .catch((e) => console.error('Background indexing error:', e));
    // @ts-ignore EdgeRuntime existe no runtime do Supabase
    if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(backgroundTask);

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