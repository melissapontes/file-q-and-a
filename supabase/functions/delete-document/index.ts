import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  console.log('Delete document function called');

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const vectorStoreId = Deno.env.get('OPENAI_VECTOR_STORE_ID');

    if (!openaiApiKey || !vectorStoreId) {
      return new Response(
        JSON.stringify({ error: 'OpenAI not configured', success: false }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Get user from auth header
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'No authorization header', success: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token', success: false }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get document ID from request
    const { documentId } = await req.json();
    if (!documentId) {
      return new Response(
        JSON.stringify({ error: 'Document ID required', success: false }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get document record (verify ownership)
    const { data: document, error: fetchError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('user_id', user.id)
      .single();

    if (fetchError || !document) {
      return new Response(
        JSON.stringify({ error: 'Document not found or access denied', success: false }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Deleting document:', document.id, 'OpenAI file:', document.openai_file_id);

    // Delete from OpenAI Vector Store
    if (document.vector_store_file_id) {
      try {
        const vsResponse = await fetch(
          `https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${document.vector_store_file_id}`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${openaiApiKey}` },
          }
        );
        console.log('Vector store delete response:', vsResponse.status);
      } catch (e) {
        console.error('Error deleting from vector store:', e);
      }
    }

    // Delete file from OpenAI
    if (document.openai_file_id) {
      try {
        const fileResponse = await fetch(
          `https://api.openai.com/v1/files/${document.openai_file_id}`,
          {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${openaiApiKey}` },
          }
        );
        console.log('OpenAI file delete response:', fileResponse.status);
      } catch (e) {
        console.error('Error deleting OpenAI file:', e);
      }
    }

    // Delete from database
    const { error: deleteError } = await supabase
      .from('documents')
      .delete()
      .eq('id', documentId)
      .eq('user_id', user.id);

    if (deleteError) {
      console.error('Database delete error:', deleteError);
      return new Response(
        JSON.stringify({ error: `Delete failed: ${deleteError.message}`, success: false }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('Document deleted successfully');

    return new Response(
      JSON.stringify({ success: true, message: 'Document deleted successfully' }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in delete-document function:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false 
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
