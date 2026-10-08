// Indexa (ou reindexa) documentos no pgvector usando embeddings do Gemini.
//   POST {"documentId": "<uuid>"}   -> indexa um documento
//   POST {"all": true}              -> indexa o que ainda não está completo (repita até remaining = 0)
//   Opção {"force": true} reindexa do zero. É retomável: se o Gemini limitar, repita a chamada.
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.58.0';
import { ingestDocument } from "../_shared/rag.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-gemini-key',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const TIME_BUDGET_MS = 90_000;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) return json({ error: 'Unauthorized' }, 401);

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { data: { user }, error: authError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
  if (authError || !user) return json({ error: 'Unauthorized' }, 401);

  // O secret GEMINI_API_KEY é o normal. O cabeçalho x-gemini-key é um alternativo temporário,
  // usado só enquanto o secret não está gravado no projeto.
  const geminiKey = Deno.env.get('GEMINI_API_KEY') || req.headers.get('x-gemini-key');
  if (!geminiKey) return json({ error: 'GEMINI_API_KEY não configurada' }, 500);

  const body = await req.json().catch(() => ({}));
  const started = Date.now();
  const done: unknown[] = [];
  const failed: { id: string; error: string }[] = [];

  let ids: string[] = [];
  if (body.documentId) {
    ids = [body.documentId];
  } else if (body.all) {
    const { data } = await supabase.from('documents').select('id').neq('processing_status', 'completed').not('storage_path', 'is', null).order('created_at');
    ids = (data || []).map((d: any) => d.id);
  } else {
    return json({ error: 'Informe documentId ou all' }, 400);
  }

  const deadline = started + TIME_BUDGET_MS;
  let remaining = ids.length;
  for (const id of ids) {
    if (Date.now() > deadline) break;
    try {
      const r = await ingestDocument(supabase, id, geminiKey, { deadline, force: body.force === true });
      done.push(r);
      if (r.status === 'partial') break; // limite do Gemini: o resto continua na próxima chamada
      remaining--;
    } catch (e) {
      failed.push({ id, error: e instanceof Error ? e.message : String(e) });
      remaining--;
    }
  }
  return json({ done, failed, remaining });
});
