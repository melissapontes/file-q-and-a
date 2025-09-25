import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { Upload as UploadIcon, FileText, AlertCircle, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

const Upload = () => {
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const { toast } = useToast();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const validFiles = acceptedFiles.filter(file => {
      const validTypes = ['.pdf', '.txt', '.md', '.docx'];
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      return validTypes.includes(extension);
    });

    if (validFiles.length !== acceptedFiles.length) {
      toast({
        title: "Arquivos inválidos",
        description: "Apenas arquivos .pdf, .txt, .md e .docx são permitidos.",
        variant: "destructive",
      });
    }

    setFiles(prev => [...prev, ...validFiles]);
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
    },
  });

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      toast({
        title: "Nenhum arquivo",
        description: "Selecione pelo menos um arquivo para fazer upload.",
        variant: "destructive",
      });
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      let completedFiles = 0;
      const totalFiles = files.length;

      for (const file of files) {
        const formData = new FormData();
        formData.append('file', file);

        const { data: { session } } = await supabase.auth.getSession();
        
        if (!session) {
          toast({
            title: "Erro de autenticação",
            description: "Você precisa estar logado para fazer upload.",
            variant: "destructive",
          });
          return;
        }

        const response = await supabase.functions.invoke('upload-document', {
          body: formData,
          headers: {
            Authorization: `Bearer ${session.access_token}`,
          },
        });

        if (response.error) {
          throw new Error(response.error.message || 'Erro no upload');
        }

        completedFiles++;
        setUploadProgress((completedFiles / totalFiles) * 100);
      }

      toast({
        title: "Upload concluído!",
        description: `${files.length} arquivo(s) enviado(s) com sucesso. O processamento pode levar alguns segundos.`,
      });

      setFiles([]);
    } catch (error) {
      console.error('Upload error:', error);
      toast({
        title: "Erro no upload",
        description: error instanceof Error ? error.message : "Ocorreu um erro durante o upload. Tente novamente.",
        variant: "destructive",
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-secondary p-6">
      <div className="container mx-auto max-w-2xl">
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold mb-4 bg-gradient-primary bg-clip-text text-transparent">
            Upload de Documentos
          </h1>
          <p className="text-muted-foreground text-lg">
            Faça upload de arquivos PDF, TXT, MD ou DOCX para alimentar o sistema RAG
          </p>
        </div>

        <Card className="p-8 bg-glass border-glass backdrop-blur-xl shadow-soft">
          <div
            {...getRootProps()}
            className={`border-2 border-dashed border-glass rounded-lg p-12 text-center cursor-pointer transition-all duration-300 ${
              isDragActive 
                ? "border-primary bg-gradient-accent scale-105" 
                : "hover:border-primary hover:bg-gradient-accent"
            }`}
          >
            <input {...getInputProps()} />
            <UploadIcon className="mx-auto mb-4 w-16 h-16 text-primary" />
            {isDragActive ? (
              <p className="text-lg text-primary font-semibold">Solte os arquivos aqui...</p>
            ) : (
              <div>
                <p className="text-lg mb-2">Arraste e solte arquivos aqui</p>
                <p className="text-muted-foreground mb-4">ou clique para selecionar</p>
                <Button variant="outline" size="sm" className="pointer-events-none">
                  Selecionar Arquivos
                </Button>
              </div>
            )}
          </div>

          {files.length > 0 && (
            <div className="mt-6">
              <h3 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <FileText size={20} />
                Arquivos Selecionados ({files.length})
              </h3>
              <div className="space-y-2">
                {files.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 bg-secondary rounded-lg"
                  >
                    <div className="flex items-center gap-3">
                      <FileText size={16} className="text-primary" />
                      <div>
                        <p className="font-medium">{file.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {(file.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeFile(index)}
                      disabled={uploading}
                    >
                      Remover
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {uploading && (
            <div className="mt-6">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                <span className="text-sm text-muted-foreground">
                  Processando arquivos... {uploadProgress}%
                </span>
              </div>
              <Progress value={uploadProgress} className="w-full" />
              <p className="text-xs text-muted-foreground mt-2 flex items-center gap-1">
                <AlertCircle size={12} />
                O processamento pode levar alguns segundos
              </p>
            </div>
          )}

          <Button
            onClick={handleUpload}
            disabled={files.length === 0 || uploading}
            className="w-full mt-6 bg-gradient-primary hover:opacity-90 shadow-glow"
            size="lg"
          >
            {uploading ? (
              <div className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                Processando...
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <UploadIcon size={20} />
                Enviar Arquivos
              </div>
            )}
          </Button>
        </Card>

        <div className="mt-6 text-center">
          <p className="text-sm text-muted-foreground">
            <strong>Nota:</strong> Sistema conectado ao Supabase Storage + OpenAI Vector Store. 
            Configure sua OPENAI_API_KEY e OPENAI_VECTOR_STORE_ID para funcionalidade completa.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Upload;