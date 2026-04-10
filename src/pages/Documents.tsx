import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { FileText, Tag, Trash2, Edit, CheckCircle2, XCircle, RefreshCw, Filter } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getTagColor } from "@/lib/tagColors";

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
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();

  // Collect all unique tags from documents
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    documents.forEach(doc => {
      (doc.tags || []).forEach(tag => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [documents]);

  // Filter documents based on selected tags
  const filteredDocuments = useMemo(() => {
    if (selectedTags.length === 0) return documents;
    return documents.filter(doc =>
      selectedTags.every(selectedTag => doc.tags?.includes(selectedTag))
    );
  }, [documents, selectedTags]);

  const toggleTag = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]
    );
  };

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
    <div className="min-h-screen bg-gradient-secondary p-2 sm:p-4 md:p-6">
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-4 sm:mb-8 pt-2 sm:pt-4">
          <h1 className="text-2xl sm:text-4xl font-bold mb-1 sm:mb-4 bg-gradient-primary bg-clip-text text-transparent">
            Gerenciar Documentos
          </h1>
          <p className="text-muted-foreground text-xs sm:text-lg">
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

        {/* Tag Filter Bar */}
        {allTags.length > 0 && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-2">
              <Filter size={14} className="text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">Filtrar por tag</span>
              {selectedTags.length > 0 && (
                <button
                  onClick={() => setSelectedTags([])}
                  className="text-xs text-primary hover:underline ml-1"
                >
                  Limpar filtros
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {allTags.map(tag => {
                const colors = getTagColor(tag);
                const isSelected = selectedTags.includes(tag);
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium transition-all duration-150"
                    style={{
                      backgroundColor: isSelected ? colors.bg : `${colors.bg}33`,
                      color: isSelected ? colors.fg : colors.bg,
                      border: `1.5px solid ${colors.bg}`,
                      opacity: isSelected ? 1 : 0.75,
                      boxShadow: isSelected ? `0 0 0 2px ${colors.bg}44` : 'none',
                    }}
                    aria-pressed={isSelected}
                  >
                    <Tag size={9} />
                    {tag}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <Card className="p-2 sm:p-4 md:p-6 bg-glass border-glass backdrop-blur-xl shadow-soft">
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
          ) : filteredDocuments.length === 0 ? (
            <div className="text-center py-10">
              <Tag className="mx-auto mb-3 w-12 h-12 text-muted-foreground opacity-40" />
              <p className="text-muted-foreground text-sm">Nenhum documento com as tags selecionadas</p>
              <button
                onClick={() => setSelectedTags([])}
                className="mt-3 text-xs text-primary hover:underline"
              >
                Limpar filtros
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="p-3 sm:p-4 bg-card rounded-lg border border-border shadow-sm"
                >
                  <div className="flex flex-col gap-2">
                    <div className="flex items-start gap-2">
                      <FileText size={20} className="text-primary flex-shrink-0 mt-0.5" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start gap-2">
                          <h3 className="font-semibold text-foreground text-sm sm:text-base flex-1 break-words leading-snug">{doc.original_name}</h3>
                          {doc.processing_status === 'completed' ? (
                            <CheckCircle2 size={18} className="text-tag flex-shrink-0 mt-0.5" />
                          ) : doc.processing_status === 'error' ? (
                            <XCircle size={18} className="text-destructive flex-shrink-0 mt-0.5" />
                          ) : (
                            <Badge variant="secondary" className="flex-shrink-0 text-xs">{doc.processing_status}</Badge>
                          )}
                        </div>
                      
                        <div className="text-xs sm:text-sm text-foreground/70 mt-1 font-medium">
                          {(doc.file_size / 1024 / 1024).toFixed(2)} MB • {new Date(doc.created_at).toLocaleDateString('pt-BR')}
                          {doc.processing_status === 'error' && doc.error_message && (
                            <span className="text-destructive ml-2">
                              • Falha no processamento
                            </span>
                          )}
                        </div>
                      </div>
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
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex flex-wrap gap-1.5 flex-1 min-w-0">
                          {doc.tags && doc.tags.length > 0 ? (
                            doc.tags.map((tag, index) => {
                              const colors = getTagColor(tag);
                              return (
                                <Badge 
                                  key={index} 
                                  variant="secondary" 
                                  className="gap-1 border-0 text-xs"
                                  style={{ backgroundColor: colors.bg, color: colors.fg }}
                                >
                                  <Tag size={10} />
                                  {tag}
                                </Badge>
                              );
                            })
                          ) : (
                            <span className="text-xs text-foreground/60 font-medium bg-muted px-2 py-0.5 rounded">Sem tags</span>
                          )}
                        </div>

                        <div className="flex gap-1 flex-shrink-0">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleReuploadClick(doc.id)}
                            disabled={editingDoc !== null || reuploadingDoc !== null}
                            className="p-1.5 h-8 w-8"
                            title="Re-upload do documento"
                          >
                            <RefreshCw size={16} className={reuploadingDoc === doc.id ? 'animate-spin' : ''} />
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
                            className="p-1.5 h-8 w-8"
                            title="Editar nome e tags"
                          >
                            <Edit size={16} />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleDelete(doc.id)}
                            disabled={editingDoc !== null}
                            className="p-1.5 h-8 w-8"
                          >
                            <Trash2 size={16} className="text-destructive" />
                          </Button>
                        </div>
                      </div>
                    )}
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
