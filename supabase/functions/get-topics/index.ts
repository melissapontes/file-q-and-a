import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(
      JSON.stringify({ error: 'Unauthorized' }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.58.0');
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Validate JWT
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(jwt);
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Unauthorized' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all tags from all completed documents
    const { data, error } = await supabase
      .from('documents')
      .select('tags, original_name')
      .eq('processing_status', 'completed')
      .not('openai_file_id', 'is', null);

    if (error) throw error;

    // Count tag frequency
    const tagCount: Record<string, number> = {};
    for (const doc of data ?? []) {
      for (const tag of doc.tags ?? []) {
        const normalized = tag.trim().toLowerCase();
        if (normalized) {
          tagCount[normalized] = (tagCount[normalized] ?? 0) + 1;
        }
      }
    }

    const topics = Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);

    return new Response(
      JSON.stringify({ topics, total_documents: data?.length ?? 0 }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error in get-topics:', error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
