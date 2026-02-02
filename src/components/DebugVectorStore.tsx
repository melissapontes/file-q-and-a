import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export const DebugVectorStore = () => {
  const [vectorStoreFiles, setVectorStoreFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [vectorStoreId, setVectorStoreId] = useState<string>('');
  const { toast } = useToast();

  const checkVectorStore = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('list-vector-store-files');
      
      if (error) throw error;
      
      console.log('Vector Store Files:', data);
      setVectorStoreFiles(data.files || []);
      setVectorStoreId(data.vectorStoreId || '');
      
      toast({
        title: "Sucesso",
        description: `${data.totalFiles} arquivos encontrados no Vector Store`,
      });
    } catch (error) {
      console.error('Error:', error);
      toast({
        title: "Erro",
        description: error instanceof Error ? error.message : "Erro ao conectar",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-4">Debug: Vector Store Files</h3>
      <Button onClick={checkVectorStore} disabled={loading}>
        {loading ? "Checando..." : "Ver Arquivos do Vector Store"}
      </Button>
      
      {vectorStoreId && (
        <div className="mt-4 text-sm">
          <span className="text-muted-foreground">Vector Store ID:</span>{" "}
          <span className="font-mono text-xs break-all">{vectorStoreId}</span>
        </div>
      )}

      {vectorStoreFiles.length > 0 && (
        <div className="mt-4 space-y-2 max-h-96 overflow-auto">
          {vectorStoreFiles.map((file: any) => (
            <div key={file.id} className="p-3 bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-700 rounded text-sm">
              <p className="font-mono text-xs text-gray-900 dark:text-gray-100 font-semibold">
                {file.filename || "Sem nome do arquivo"}
              </p>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1">ID: {file.id}</p>
              <p className="text-xs text-gray-600 dark:text-gray-400">Status: {file.status}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
