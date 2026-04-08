import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Tags } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Topic {
  tag: string;
  count: number;
}

function getTagStyle(count: number, max: number): { fontSize: string; fontWeight: string } {
  const ratio = max > 1 ? (count - 1) / (max - 1) : 1;
  const sizes = ["1rem", "1.15rem", "1.35rem", "1.6rem", "1.9rem", "2.3rem", "2.8rem"];
  const weights = ["500", "500", "600", "600", "700", "700", "800"];
  const idx = Math.round(ratio * (sizes.length - 1));
  return { fontSize: sizes[idx], fontWeight: weights[idx] };
}

const PALETTE = [
  "#e11d48",
  "#7c3aed",
  "#0284c7",
  "#d97706",
  "#059669",
  "#db2777",
  "#ea580c",
  "#2563eb",
  "#65a30d",
  "#0891b2",
  "#9333ea",
  "#16a34a",
];

// Tags genéricas que não representam doenças e não devem aparecer na nuvem
const GENERIC_TAGS = new Set([
  "protocolo", "protocolos",
  "imagem", "imagens",
  "usg", "ultrassom", "ultrassonografia",
  "iris",
  "estadiamento",
  "tratamento", "tratamentos",
  "terapeutica", "terapêutica",
  "cães gatos", "caes gatos", "gatos", "cães", "caes", "felinos", "caninos",
  "diagnostico", "diagnóstico",
  "exame", "exames",
  "medicamento", "medicamentos",
  "referencia", "referências", "referencia",
]);

function colorFor(tag: string): string {
  let hash = 0;
  for (let i = 0; i < tag.length; i++) hash = tag.charCodeAt(i) + ((hash << 5) - hash);
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

const Topics = () => {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [totalDocs, setTotalDocs] = useState(0);
  const [loading, setLoading] = useState(true);
  const { toast } = useToast();

  useEffect(() => {
    const fetchTopics = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) throw new Error("Não autenticado");

        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-topics`,
          {
            headers: { Authorization: `Bearer ${session.access_token}` },
          }
        );

        if (!response.ok) throw new Error("Erro ao buscar tópicos");

        const data = await response.json();
        const filtered = (data.topics ?? []).filter(
          (t: Topic) => !GENERIC_TAGS.has(t.tag.toLowerCase())
        );
        setTopics(filtered);
        setTotalDocs(data.total_documents ?? 0);
      } catch (err: any) {
        toast({ title: "Erro", description: err.message, variant: "destructive" });
      } finally {
        setLoading(false);
      }
    };

    fetchTopics();
  }, [toast]);

  const max = topics.length > 0 ? topics[0].count : 1;

  return (
    <div className="flex-1 flex flex-col p-4 sm:p-6 md:p-8">
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-8 pt-4 sm:pt-8">
          <h1 className="text-2xl sm:text-4xl font-bold mb-2 bg-gradient-primary bg-clip-text text-transparent">
            Tópicos Disponíveis
          </h1>
          <p className="text-sm sm:text-base text-muted-foreground">
            Assuntos cobertos pelos documentos no RAG — pergunte sobre qualquer um deles
          </p>
        </div>

        <Card className="p-6 sm:p-10 bg-glass border-glass backdrop-blur-xl shadow-soft min-h-[320px] flex flex-col items-center justify-center">
          {loading ? (
            <div className="flex items-center gap-3 text-muted-foreground">
              <Loader2 size={20} className="animate-spin" />
              <span>Carregando tópicos...</span>
            </div>
          ) : topics.length === 0 ? (
            <div className="flex flex-col items-center gap-3 text-muted-foreground">
              <Tags size={40} className="opacity-30" />
              <p>Nenhum tópico encontrado. Faça upload de documentos com tags para que eles apareçam aqui.</p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-3 sm:gap-5 justify-center items-center leading-relaxed">
                {topics.map(({ tag, count }) => {
                  const { fontSize, fontWeight } = getTagStyle(count, max);
                  const color = colorFor(tag);
                  return (
                    <span
                      key={tag}
                      title={count === 1 ? "1 documento" : `${count} documentos`}
                      className="cursor-default select-none transition-transform hover:scale-110 hover:brightness-110"
                      style={{ fontSize, fontWeight, color }}
                    >
                      {tag}
                    </span>
                  );
                })}
              </div>
              <p className="mt-8 text-xs text-muted-foreground">
                {totalDocs} {totalDocs === 1 ? "documento indexado" : "documentos indexados"} · {topics.length} {topics.length === 1 ? "tópico" : "tópicos"}
              </p>
            </>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Topics;
