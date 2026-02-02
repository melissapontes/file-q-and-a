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

    if (!openaiApiKey || !vectorStoreId) {
      throw new Error('Missing OpenAI API key or Vector Store ID');
    }

    // Get vector store files from OpenAI
    const response = await fetch(`https://api.openai.com/v1/vector_stores/${vectorStoreId}/files`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI API error: ${error}`);
    }

    const data = await response.json();

    const files = Array.isArray(data.data) ? data.data : [];

    const filesWithNames = await Promise.all(
      files.map(async (file: { id: string; file_id?: string }) => {
        const fileId = file.file_id || file.id;
        let filename = null;

        try {
          const fileResponse = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${openaiApiKey}`,
            },
          });

          if (fileResponse.ok) {
            const fileData = await fileResponse.json();
            filename = fileData.filename || null;
          }
        } catch (error) {
          console.error('Error fetching file metadata:', error);
        }

        return {
          ...file,
          file_id: fileId,
          filename,
        };
      })
    );

    return new Response(
      JSON.stringify({
        success: true,
        vectorStoreId,
        files: filesWithNames,
        totalFiles: filesWithNames.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error'
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
