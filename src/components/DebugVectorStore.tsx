import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

export const DebugVectorStore = () => {
  const [vectorStoreFiles, setVectorStoreFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const checkVectorStore = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('list-vector-store-files');
      
      if (error) throw error;
      
      console.log('Vector Store Files:', data);
      setVectorStoreFiles(data.files || []);
      
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
      
      {vectorStoreFiles.length > 0 && (
        <div className="mt-4 space-y-2 max-h-96 overflow-auto">
          {vectorStoreFiles.map((file: any) => (
            <div key={file.id} className="p-2 bg-secondary rounded text-sm">
              <p className="font-mono text-xs">{file.filename}</p>
              <p className="text-xs text-muted-foreground">ID: {file.id}</p>
              <p className="text-xs text-muted-foreground">Status: {file.status}</p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
};
