import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileText, Tag, Trash2, Edit, CheckCircle2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface Document {
  id: string;
  original_name: string;
  tags: string[];
  created_at: string;
  file_size: number;
  processing_status: string;
  error_message: string | null;
}

const Documents = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDoc, setEditingDoc] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string>('');
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
      // Use edge function to fetch documents (bypasses RLS)
      const response = await supabase.functions.invoke('list-documents');
      
      if (response.error) throw response.error;

      setDocuments(response.data?.documents || []);
    } catch (error) {
      console.error('Error fetching documents:', error);
      toast({
        title: "Erro",
        description: "Não foi possível carregar os documentos.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleUpdateTags = async (docId: string) => {
    try {
      const tags = editTags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      
      const { error } = await supabase
        .from('documents')
        .update({ tags })
        .eq('id', docId);

      if (error) throw error;

      toast({
        title: "Tags atualizadas!",
        description: "As tags foram atualizadas com sucesso.",
      });

      setEditingDoc(null);
      setEditTags('');
      fetchDocuments();
    } catch (error) {
      console.error('Error updating tags:', error);
      toast({
        title: "Erro",
        description: "Não foi possível atualizar as tags.",
        variant: "destructive",
      });
    }
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Tem certeza que deseja excluir este documento? Isso também removerá do OpenAI.')) {
      return;
    }

    try {
      const response = await supabase.functions.invoke('delete-document', {
        body: { documentId: docId },
      });

      if (response.error) throw response.error;

      toast({
        title: "Documento excluído!",
        description: "O documento foi removido do sistema e do OpenAI.",
      });

      fetchDocuments();
    } catch (error) {
      console.error('Error deleting document:', error);
      toast({
        title: "Erro",
        description: "Não foi possível excluir o documento.",
        variant: "destructive",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-secondary flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-secondary p-6">
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
            Gerenciar Documentos
          </h1>
          <p className="text-muted-foreground text-lg">
            Visualize e organize seus documentos com tags
          </p>
        </div>

        <Card className="p-6 bg-glass border-glass backdrop-blur-xl shadow-soft">
          {documents.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="mx-auto mb-4 w-16 h-16 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">Nenhum documento encontrado</p>
              <Button 
                onClick={() => navigate('/upload')} 
                className="mt-4"
                variant="outline"
              >
                Fazer Upload
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {documents.map((doc) => (
                <div
                  key={doc.id}
                  className="p-4 bg-card rounded-lg border border-border shadow-sm"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start gap-3 mb-2">
                        <FileText size={24} className="text-primary flex-shrink-0 mt-0.5" />
                        <h3 className="font-semibold text-foreground text-base flex-1 break-words">{doc.original_name}</h3>
                        {doc.processing_status === 'completed' ? (
                          <CheckCircle2 size={24} className="text-tag flex-shrink-0" />
                        ) : doc.processing_status === 'error' ? (
                          <XCircle size={24} className="text-destructive flex-shrink-0" />
                        ) : (
                          <Badge variant="secondary" className="flex-shrink-0">{doc.processing_status}</Badge>
                        )}
                      </div>
                      
                      <div className="text-sm text-foreground/70 mb-3 font-medium">
                        {(doc.file_size / 1024 / 1024).toFixed(2)} MB • {new Date(doc.created_at).toLocaleDateString('pt-BR')}
                        {doc.processing_status === 'error' && doc.error_message && (
                          <span className="text-destructive ml-2">
                            • Falha no processamento
                          </span>
                        )}
                      </div>

                      {editingDoc === doc.id ? (
                        <div className="flex gap-2 items-center">
                          <input
                            type="text"
                            value={editTags}
                            onChange={(e) => setEditTags(e.target.value)}
                            placeholder="Tags separadas por vírgula"
                            className="flex-1 px-3 py-1.5 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
                            autoFocus
                          />
                          <Button
                            size="sm"
                            onClick={() => handleUpdateTags(doc.id)}
                          >
                            Salvar
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditingDoc(null);
                              setEditTags('');
                            }}
                          >
                            Cancelar
                          </Button>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {doc.tags && doc.tags.length > 0 ? (
                            doc.tags.map((tag, index) => (
                              <Badge key={index} variant="secondary" className="gap-1 bg-tag text-tag-foreground border-tag/20">
                                <Tag size={12} />
                                {tag}
                              </Badge>
                            ))
                          ) : (
                            <span className="text-sm text-foreground/60 font-medium bg-muted px-2 py-1 rounded">Sem tags</span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex gap-2 ml-4 flex-shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingDoc(doc.id);
                          setEditTags(doc.tags?.join(', ') || '');
                        }}
                        disabled={editingDoc !== null}
                        className="p-2"
                      >
                        <Edit size={20} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(doc.id)}
                        disabled={editingDoc !== null}
                        className="p-2"
                      >
                        <Trash2 size={20} className="text-destructive" />
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default Documents;
