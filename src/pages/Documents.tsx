import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { FileText, Tag, Trash2, Edit, CheckCircle2, XCircle, RefreshCw } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getTagColor } from "@/lib/tagColors";
import { DebugVectorStore } from "@/components/DebugVectorStore";

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
  const [editName, setEditName] = useState<string>('');
  const [editTags, setEditTags] = useState<string>('');
  const [reuploadingDoc, setReuploadingDoc] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (!authLoading && !user) {
      navigate("/auth");
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchDocuments();
    }
  }, [user]);

  const fetchDocuments = async () => {
    try {
      const { data, error } = await supabase
        .from('documents')
        .select('id, original_name, tags, created_at, file_size, processing_status, error_message')
        .order('created_at', { ascending: false });

      if (error) throw error;

      setDocuments(data || []);
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

  const handleUpdateDocument = async (docId: string) => {
    try {
      const tags = editTags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      
      const { error } = await supabase
        .from('documents')
        .update({ 
          tags,
          original_name: editName.trim() || undefined
        })
        .eq('id', docId);

      if (error) throw error;

      toast({
        title: "Documento atualizado!",
        description: "O nome e as tags foram atualizados com sucesso.",
      });

      setEditingDoc(null);
      setEditName('');
      setEditTags('');
      fetchDocuments();
    } catch (error) {
      console.error('Error updating document:', error);
      toast({
        title: "Erro",
        description: "Não foi possível atualizar o documento.",
        variant: "destructive",
      });
    }
  };

  const handleReupload = async (docId: string, file: File) => {
    try {
      setReuploadingDoc(docId);
      
      // Get the current document to preserve metadata
      const currentDoc = documents.find(d => d.id === docId);
      if (!currentDoc) throw new Error('Documento não encontrado');

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Não autenticado');

      // Create form data with the new file
      const formData = new FormData();
      formData.append('file', file);
      formData.append('tags', currentDoc.tags?.join(',') || '');
      formData.append('replaceDocId', docId);

      const response = await supabase.functions.invoke('upload-document', {
        body: formData,
      });

      if (response.error) throw response.error;

      toast({
        title: "Re-upload iniciado!",
        description: "O documento está sendo processado novamente.",
      });

      fetchDocuments();
    } catch (error) {
      console.error('Error re-uploading document:', error);
      toast({
        title: "Erro",
        description: "Não foi possível fazer o re-upload do documento.",
        variant: "destructive",
      });
    } finally {
      setReuploadingDoc(null);
    }
  };

  const handleReuploadClick = (docId: string) => {
    setReuploadingDoc(docId);
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && reuploadingDoc) {
      handleReupload(reuploadingDoc, file);
    }
    e.target.value = '';
  };

  const handleDelete = async (docId: string) => {
    if (!confirm('Tem certeza que deseja excluir este documento?')) {
      return;
    }

    try {
      const { error } = await supabase
        .from('documents')
        .delete()
        .eq('id', docId);

      if (error) throw error;

      toast({
        title: "Documento excluído!",
        description: "O documento foi removido com sucesso.",
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

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-gradient-secondary flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Carregando...</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return null;
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

        {/* Hidden file input for re-upload */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileChange}
          accept=".pdf,.txt,.md,.docx,.xlsx,.xls"
          className="hidden"
        />

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
                        <div className="space-y-3">
                          <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Nome do documento</label>
                            <Input
                              type="text"
                              value={editName}
                              onChange={(e) => setEditName(e.target.value)}
                              placeholder="Nome do documento"
                              className="text-sm"
                              autoFocus
                            />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground mb-1 block">Tags (separadas por vírgula)</label>
                            <Input
                              type="text"
                              value={editTags}
                              onChange={(e) => setEditTags(e.target.value)}
                              placeholder="Tag1, Tag2, Tag3"
                              className="text-sm"
                            />
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              onClick={() => handleUpdateDocument(doc.id)}
                            >
                              Salvar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditingDoc(null);
                                setEditName('');
                                setEditTags('');
                              }}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {doc.tags && doc.tags.length > 0 ? (
                            doc.tags.map((tag, index) => {
                              const colors = getTagColor(tag);
                              return (
                                <Badge 
                                  key={index} 
                                  variant="secondary" 
                                  className="gap-1 border-0"
                                  style={{ backgroundColor: colors.bg, color: colors.fg }}
                                >
                                  <Tag size={12} />
                                  {tag}
                                </Badge>
                              );
                            })
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
                        onClick={() => handleReuploadClick(doc.id)}
                        disabled={editingDoc !== null || reuploadingDoc !== null}
                        className="p-2"
                        title="Re-upload do documento"
                      >
                        <RefreshCw size={20} className={reuploadingDoc === doc.id ? 'animate-spin' : ''} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          setEditingDoc(doc.id);
                          setEditName(doc.original_name);
                          setEditTags(doc.tags?.join(', ') || '');
                        }}
                        disabled={editingDoc !== null}
                        className="p-2"
                        title="Editar nome e tags"
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

        {/* Debug Vector Store */}
        <div className="mt-8">
          <DebugVectorStore />
        </div>
      </div>
    </div>
  );
};

export default Documents;
