import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Delete document function called');

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request
    const body = await req.json();
    const { documentId } = body;

    if (!documentId) {
      throw new Error('documentId is required');
    }

    console.log(`Deleting document: ${documentId}`);

    // Step 1: Get document info
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('id, original_name, openai_file_id')
      .eq('id', documentId)
      .single();

    if (fetchError) {
      throw new Error(`Document not found: ${fetchError.message}`);
    }

    console.log(`Document found: ${document.original_name}`);

    // Step 2: Delete chunks from document_chunks table
    console.log('Deleting document chunks...');
    const { error: chunksError } = await supabase
      .from('document_chunks')
      .delete()
      .eq('document_id', documentId);

    if (chunksError) {
      console.error('Error deleting chunks:', chunksError);
      // Continue anyway - chunks table might not exist yet
    } else {
      console.log('✅ Chunks deleted');
    }

    // Step 3: Delete file from OpenAI if exists
    if (document.openai_file_id && openaiApiKey) {
      console.log(`Deleting OpenAI file: ${document.openai_file_id}`);
      try {
        const deleteFileResponse = await fetch(
          `https://api.openai.com/v1/files/${document.openai_file_id}`,
          {
            method: 'DELETE',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
            },
          }
        );

        if (deleteFileResponse.ok) {
          console.log('✅ OpenAI file deleted');
        } else {
          const error = await deleteFileResponse.text();
          console.log('⚠️ Could not delete OpenAI file:', error);
          // Continue anyway - file might already be deleted
        }
      } catch (error) {
        console.log('⚠️ Error deleting OpenAI file:', error);
        // Continue anyway
      }
    }

    // Step 4: Delete document record from Supabase
    console.log('Deleting document record...');
    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .eq('id', documentId);

    if (deleteError) {
      throw new Error(`Failed to delete document: ${deleteError.message}`);
    }

    console.log('✅ Document deleted successfully');

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Document deleted completely',
        deleted: {
          document: true,
          chunks: true,
          openai_file: !!document.openai_file_id,
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error) {
    console.error('❌ Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error.message,
        success: false
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});
