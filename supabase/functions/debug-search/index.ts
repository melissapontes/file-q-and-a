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

  try {
    const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
    const vectorStoreId = Deno.env.get('OPENAI_VECTOR_STORE_ID');

    if (!openaiApiKey || !vectorStoreId) {
      throw new Error('Missing env vars');
    }

    const { query } = await req.json();
    const testQuery = query || "incontinência urinária cães tratamento";

    console.log(`🔍 Testing search with: "${testQuery}"`);

    // Create temporary assistant
    const assistantResponse = await fetch('https://api.openai.com/v1/assistants', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({
        name: 'Debug Search Test',
        instructions: 'List ALL documents found and show their content snippets.',
        model: 'gpt-4o-mini',
        tools: [{ type: 'file_search' }],
        tool_resources: {
          file_search: { vector_store_ids: [vectorStoreId] }
        },
      }),
    });

    const assistant = await assistantResponse.json();
    console.log('Assistant created:', assistant.id);

    // Create thread
    const threadResponse = await fetch('https://api.openai.com/v1/threads', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    const thread = await threadResponse.json();

    // Add message
    await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({
        role: 'user',
        content: `Search for: ${testQuery}. List EVERY document found, show file names and content snippets.`
      }),
    });

    // Run
    const runResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
        'OpenAI-Beta': 'assistants=v2',
      },
      body: JSON.stringify({ assistant_id: assistant.id }),
    });

    const run = await runResponse.json();

    // Wait for completion
    let runStatus = run.status;
    let attempts = 0;
    while (runStatus !== 'completed' && runStatus !== 'failed' && attempts < 60) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const statusResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}`, {
        headers: {
          'Authorization': `Bearer ${openaiApiKey}`,
          'OpenAI-Beta': 'assistants=v2',
        },
      });
      const statusData = await statusResponse.json();
      runStatus = statusData.status;
      attempts++;
    }

    // Get Run Steps to see what was searched
    const stepsResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/runs/${run.id}/steps`, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    const steps = await stepsResponse.json();

    // Get response
    const messagesResponse = await fetch(`https://api.openai.com/v1/threads/${thread.id}/messages`, {
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    const messages = await messagesResponse.json();
    const assistantMessage = messages.data.find((m: any) => m.role === 'assistant');

    // Cleanup
    await fetch(`https://api.openai.com/v1/assistants/${assistant.id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'OpenAI-Beta': 'assistants=v2',
      },
    });

    return new Response(
      JSON.stringify({
        query: testQuery,
        steps: steps.data,
        response: assistantMessage?.content[0]?.text?.value || 'No response',
        annotations: assistantMessage?.content[0]?.text?.annotations || []
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
