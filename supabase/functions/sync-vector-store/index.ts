import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const vectorStoreId = Deno.env.get('OPENAI_VECTOR_STORE_ID');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!openaiApiKey || !vectorStoreId || !supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing required environment variables');
    }

    let dryRun = true;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        dryRun = body?.dryRun !== false ? true : false;
      } catch {
        dryRun = true;
      }
    }

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.58.0');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { data: documents, error } = await supabase
      .from('documents')
      .select('openai_file_id')
      .not('openai_file_id', 'is', null);

    if (error) {
      throw new Error(`Failed to fetch documents: ${error.message}`);
    }

    const allowedFileIds = new Set((documents || []).map((d) => d.openai_file_id));

    const listResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    if (!listResponse.ok) {
      const errorText = await listResponse.text();
      throw new Error(`OpenAI API error: ${errorText}`);
    }

    const listData = await listResponse.json();
    const vectorFiles = Array.isArray(listData.data) ? listData.data : [];

    const orphaned = vectorFiles.filter((file: { id: string; file_id?: string }) => {
      const fileId = file.file_id || file.id;
      return !allowedFileIds.has(fileId);
    });

    const deleted: { id: string; file_id?: string }[] = [];
    const failed: { id: string; error: string }[] = [];

    if (!dryRun) {
      for (const file of orphaned) {
        const deleteResponse = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files/${file.id}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${openaiApiKey}`,
            'OpenAI-Beta': 'assistants=v2',
          },
        });

        if (deleteResponse.ok) {
          deleted.push({ id: file.id, file_id: file.file_id });
        } else {
          const errText = await deleteResponse.text();
          failed.push({ id: file.id, error: errText });
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        vectorStoreId,
        dryRun,
        totalDocuments: allowedFileIds.size,
        totalVectorFiles: vectorFiles.length,
        orphanedCount: orphaned.length,
        orphaned,
        deletedCount: deleted.length,
        deleted,
        failedCount: failed.length,
        failed,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
