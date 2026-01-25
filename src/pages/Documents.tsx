import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { FileText, Tag, Trash2, Edit, CheckCircle2, XCircle, Check, X, Filter, XCircle as ClearIcon, RefreshCw } from "lucide-react";
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

// Cores predefinidas bem distintas para garantir contraste visual
const DISTINCT_COLORS = [
  { bg: "hsl(0, 75%, 45%)", text: "hsl(0, 0%, 100%)" },      // vermelho
  { bg: "hsl(210, 80%, 45%)", text: "hsl(0, 0%, 100%)" },    // azul
  { bg: "hsl(130, 60%, 38%)", text: "hsl(0, 0%, 100%)" },    // verde
  { bg: "hsl(280, 65%, 50%)", text: "hsl(0, 0%, 100%)" },    // roxo
  { bg: "hsl(35, 85%, 50%)", text: "hsl(0, 0%, 100%)" },     // laranja
  { bg: "hsl(180, 70%, 35%)", text: "hsl(0, 0%, 100%)" },    // teal/ciano
  { bg: "hsl(330, 70%, 50%)", text: "hsl(0, 0%, 100%)" },    // rosa
  { bg: "hsl(55, 80%, 42%)", text: "hsl(0, 0%, 100%)" },     // amarelo escuro
  { bg: "hsl(260, 55%, 55%)", text: "hsl(0, 0%, 100%)" },    // violeta
  { bg: "hsl(15, 80%, 50%)", text: "hsl(0, 0%, 100%)" },     // coral
  { bg: "hsl(195, 75%, 40%)", text: "hsl(0, 0%, 100%)" },    // azul claro
  { bg: "hsl(160, 65%, 38%)", text: "hsl(0, 0%, 100%)" },    // verde água
];

// Hash mais robusto usando caracteres e posição para melhor distribuição
const getTagColor = (tag: string): { bg: string; text: string } => {
  const normalized = tag.toLowerCase().trim();
  let hash = 0;
  for (let i = 0; i < normalized.length; i++) {
    // Multiplicadores primos diferentes para cada posição
    hash = (hash * 31 + normalized.charCodeAt(i) * (i + 1)) >>> 0;
  }
  // Adiciona comprimento como fator extra de diferenciação
  hash = (hash * 17 + normalized.length * 53) >>> 0;
  
  return DISTINCT_COLORS[hash % DISTINCT_COLORS.length];
};

const Documents = () => {
  const [documents, setDocuments] = useState<Document[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingDoc, setEditingDoc] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState<string>('');
  const [editTags, setEditTags] = useState<string>('');
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [reuploadingDocId, setReuploadingDocId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const navigate = useNavigate();

  // Extrai todas as tags únicas dos documentos
  const allTags = Array.from(
    new Set(documents.flatMap(doc => doc.tags || []))
  ).sort();

  // Filtra documentos com base nas tags selecionadas
  const filteredDocuments = selectedTags.length === 0
    ? documents
    : documents.filter(doc => 
        selectedTags.some(tag => doc.tags?.includes(tag))
      );

  const toggleTagFilter = (tag: string) => {
    setSelectedTags(prev =>
      prev.includes(tag)
        ? prev.filter(t => t !== tag)
        : [...prev, tag]
    );
  };

  const clearFilters = () => setSelectedTags([]);

  useEffect(() => {
    fetchDocuments();
  }, []);

  const fetchDocuments = async () => {
    try {
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

  const handleSaveEdit = async (docId: string) => {
    if (!editTitle.trim()) {
      toast({
        title: "Erro",
        description: "O título não pode estar vazio.",
        variant: "destructive",
      });
      return;
    }

    try {
      const tags = editTags.split(',').map(tag => tag.trim()).filter(tag => tag.length > 0);
      
      const response = await supabase.functions.invoke('update-document', {
        body: { documentId: docId, original_name: editTitle.trim(), tags },
      });

      if (response.error) throw response.error;
      if (!response.data?.success) throw new Error(response.data?.error || 'Unknown error');

      toast({
        title: "Documento atualizado!",
        description: "O título e tags foram atualizados com sucesso.",
      });

      cancelEdit();
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

  const startEdit = (doc: Document) => {
    setEditingDoc(doc.id);
    setEditTitle(doc.original_name);
    setEditTags(doc.tags?.join(', ') || '');
  };

  const cancelEdit = () => {
    setEditingDoc(null);
    setEditTitle('');
    setEditTags('');
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

  const handleReupload = (docId: string) => {
    setReuploadingDocId(docId);
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !reuploadingDocId) {
      setReuploadingDocId(null);
      return;
    }

    // Validate file type
    const validTypes = ['.pdf', '.txt', '.md', '.docx'];
    const extension = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!validTypes.includes(extension)) {
      toast({
        title: "Arquivo inválido",
        description: "Apenas arquivos .pdf, .txt, .md e .docx são permitidos.",
        variant: "destructive",
      });
      setReuploadingDocId(null);
      e.target.value = '';
      return;
    }

    const docToReplace = documents.find(d => d.id === reuploadingDocId);
    const existingTags = docToReplace?.tags?.join(', ') || '';

    try {
      // First delete the old document
      await supabase.functions.invoke('delete-document', {
        body: { documentId: reuploadingDocId },
      });

      // Then upload the new file
      const formData = new FormData();
      formData.append('file', file);
      if (existingTags) {
        formData.append('tags', existingTags);
      }

      const response = await supabase.functions.invoke('upload-document', {
        body: formData,
      });

      if (response.error) {
        throw new Error(response.error.message || 'Erro no upload');
      }

      toast({
        title: "Re-upload concluído!",
        description: "O arquivo foi substituído com sucesso.",
      });

      fetchDocuments();
    } catch (error) {
      console.error('Reupload error:', error);
      toast({
        title: "Erro no re-upload",
        description: error instanceof Error ? error.message : "Ocorreu um erro durante o re-upload.",
        variant: "destructive",
      });
    } finally {
      setReuploadingDocId(null);
      e.target.value = '';
    }
  };

  const isEditing = editingDoc !== null;

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
    <div className="min-h-screen bg-gradient-secondary px-3 sm:px-6 py-3 sm:py-6">
      {/* Hidden file input for re-upload */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileChange}
        accept=".pdf,.txt,.md,.docx"
        className="hidden"
      />
      <div className="container mx-auto max-w-4xl">
        <div className="text-center mb-4 sm:mb-8">
          <h1 className="text-2xl sm:text-4xl font-bold mb-1 sm:mb-4 bg-gradient-primary bg-clip-text text-transparent">
            Gerenciar Documentos
          </h1>
          <p className="text-muted-foreground text-sm sm:text-lg hidden sm:block">
            Visualize e organize seus documentos com tags
          </p>
        </div>

        {/* Filtro por Tags */}
        {allTags.length > 0 && (
          <Card className="p-3 sm:p-4 mb-3 sm:mb-4 bg-glass border-glass backdrop-blur-xl shadow-soft">
            <div className="flex items-center gap-2 mb-2 sm:mb-3">
              <Filter size={16} className="sm:w-[18px] sm:h-[18px] text-primary" />
              <span className="font-medium text-foreground text-sm sm:text-base">Filtrar por tags:</span>
              {selectedTags.length > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFilters}
                  className="ml-auto text-xs h-7 px-2"
                >
                  <ClearIcon size={14} className="mr-1" />
                  Limpar filtros
                </Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => {
                const color = getTagColor(tag);
                const isSelected = selectedTags.includes(tag);
                return (
                  <Badge
                    key={tag}
                    onClick={() => toggleTagFilter(tag)}
                    className={`cursor-pointer gap-1 border-0 transition-all ${
                      isSelected 
                        ? 'ring-2 ring-primary ring-offset-2 ring-offset-background scale-105' 
                        : 'opacity-60 hover:opacity-100'
                    }`}
                    style={{
                      backgroundColor: color.bg,
                      color: color.text,
                    }}
                  >
                    <Tag size={12} />
                    {tag}
                  </Badge>
                );
              })}
            </div>
          </Card>
        )}

        <Card className="p-3 sm:p-6 bg-glass border-glass backdrop-blur-xl shadow-soft">
          {filteredDocuments.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="mx-auto mb-4 w-16 h-16 text-muted-foreground opacity-50" />
              <p className="text-muted-foreground">
                {documents.length === 0 
                  ? "Nenhum documento encontrado" 
                  : "Nenhum documento corresponde aos filtros selecionados"}
              </p>
              {documents.length === 0 ? (
                <Button 
                  onClick={() => navigate('/upload')} 
                  className="mt-4"
                  variant="outline"
                >
                  Fazer Upload
                </Button>
              ) : (
                <Button 
                  onClick={clearFilters} 
                  className="mt-4"
                  variant="outline"
                >
                  Limpar Filtros
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              {filteredDocuments.map((doc) => (
                <div
                  key={doc.id}
                  className="p-4 bg-card rounded-lg border border-border shadow-sm"
                >
                  <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                      {editingDoc === doc.id ? (
                        // Modo de edição combinado (título + tags)
                        <div className="space-y-3">
                          <div className="flex items-start gap-3">
                            <FileText size={24} className="text-primary flex-shrink-0 mt-1" />
                            <div className="flex-1 space-y-3">
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Título</label>
                                <input
                                  type="text"
                                  value={editTitle}
                                  onChange={(e) => setEditTitle(e.target.value)}
                                  className="w-full px-3 py-1.5 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground font-semibold"
                                  autoFocus
                                />
                              </div>
                              <div>
                                <label className="text-xs text-muted-foreground mb-1 block">Tags (separadas por vírgula)</label>
                                <input
                                  type="text"
                                  value={editTags}
                                  onChange={(e) => setEditTags(e.target.value)}
                                  placeholder="tag1, tag2, tag3"
                                  className="w-full px-3 py-1.5 text-sm rounded bg-background border border-border focus:outline-none focus:ring-2 focus:ring-primary text-foreground"
                                />
                              </div>
                              <div className="flex gap-2">
                                <Button
                                  size="sm"
                                  onClick={() => handleSaveEdit(doc.id)}
                                >
                                  <Check size={14} className="mr-1" />
                                  Salvar
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={cancelEdit}
                                >
                                  <X size={14} className="mr-1" />
                                  Cancelar
                                </Button>
                              </div>
                            </div>
                          </div>
                        </div>
                      ) : (
                        // Modo de visualização
                        <>
                          <div className="flex items-start gap-3 mb-2">
                            <FileText size={24} className="text-primary flex-shrink-0 mt-0.5" />
                            <h3 className="font-semibold text-foreground text-base break-words flex-1">{doc.original_name}</h3>
                            {doc.processing_status === 'completed' ? (
                              <CheckCircle2 size={24} className="text-tag flex-shrink-0" />
                            ) : doc.processing_status === 'error' ? (
                              <XCircle size={24} className="text-destructive flex-shrink-0" />
                            ) : (
                              <Badge variant="secondary" className="flex-shrink-0">{doc.processing_status}</Badge>
                            )}
                          </div>
                          
                          <div className="text-sm text-foreground/70 mb-3 font-medium ml-9">
                            {(doc.file_size / 1024 / 1024).toFixed(2)} MB • {new Date(doc.created_at).toLocaleDateString('pt-BR')}
                            {doc.processing_status === 'error' && doc.error_message && (
                              <span className="text-destructive ml-2">
                                • Falha no processamento
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap gap-2 ml-9">
                            {doc.tags && doc.tags.length > 0 ? (
                              doc.tags.map((tag, index) => {
                                const color = getTagColor(tag);
                                return (
                                  <Badge 
                                    key={index} 
                                    className="gap-1 border-0"
                                    style={{ 
                                      backgroundColor: color.bg, 
                                      color: color.text 
                                    }}
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
                        </>
                      )}
                    </div>

                    <div className="flex gap-2 ml-4 flex-shrink-0">
                      {doc.processing_status === 'error' && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleReupload(doc.id)}
                          disabled={isEditing || reuploadingDocId === doc.id}
                          className="p-2"
                          title="Tentar novamente com outro arquivo"
                        >
                          {reuploadingDocId === doc.id ? (
                            <RefreshCw size={20} className="text-primary animate-spin" />
                          ) : (
                            <RefreshCw size={20} className="text-primary" />
                          )}
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => startEdit(doc)}
                        disabled={isEditing}
                        className="p-2"
                      >
                        <Edit size={20} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleDelete(doc.id)}
                        disabled={isEditing}
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
