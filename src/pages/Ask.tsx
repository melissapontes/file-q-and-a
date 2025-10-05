import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Send, MessageCircle, Bot, User, Loader2, Paperclip, X, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  references?: string[];
}

const Ask = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content: 'Olá! Eu sou seu RAG Nefro & Uro Vet. Faça perguntas sobre os documentos que você me forneceu e eu tentarei responder com base no conteúdo deles',
      sender: 'ai',
      timestamp: new Date(),
    }
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const { toast } = useToast();

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const validFiles = acceptedFiles.filter(file => {
      const validTypes = ['.pdf', '.txt', '.md', '.docx', '.jpg', '.jpeg', '.png'];
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      return validTypes.includes(extension);
    });

    if (validFiles.length !== acceptedFiles.length) {
      toast({
        title: "Arquivos inválidos",
        description: "Apenas arquivos .pdf, .txt, .md, .docx, .jpg, .jpeg e .png são permitidos.",
        variant: "destructive",
      });
    }

    setAttachedFiles(prev => [...prev, ...validFiles]);
  }, [toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'text/plain': ['.txt'],
      'text/markdown': ['.md'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'image/jpeg': ['.jpg', '.jpeg'],
      'image/png': ['.png'],
    },
    noClick: true,
    noKeyboard: true,
  });

  const removeFile = (index: number) => {
    setAttachedFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleSendMessage = async () => {
    if (!inputMessage.trim()) return;

    const filesInfo = attachedFiles.length > 0 
      ? `\n📎 Arquivos anexados: ${attachedFiles.map(f => f.name).join(', ')}`
      : '';

    const userMessage: Message = {
      id: Date.now().toString(),
      content: inputMessage + filesInfo,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const currentQuestion = inputMessage;
    const currentFiles = [...attachedFiles];
    setInputMessage("");
    setAttachedFiles([]);
    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append('question', currentQuestion);
      
      currentFiles.forEach((file) => {
        formData.append('files', file);
      });

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-document`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get answer');
      }

      const data = await response.json();

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: data.answer || 'Desculpe, não consegui processar sua pergunta.',
        sender: 'ai',
        timestamp: new Date(),
        references: data.references || [],
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error: any) {
      console.error('Error asking document:', error);
      
      // Extract detailed error message
      let errorDetails = 'Erro desconhecido ao processar sua pergunta.';
      
      if (error?.message) {
        errorDetails = error.message;
      } else if (typeof error === 'string') {
        errorDetails = error;
      }
      
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: `❌ **Erro ao processar pergunta:**\n\n${errorDetails}\n\nPor favor, tente novamente ou entre em contato com o suporte se o problema persistir.`,
        sender: 'ai',
        timestamp: new Date(),
      };

      setMessages(prev => [...prev, errorMessage]);
      
      toast({
        title: "Erro ao processar pergunta",
        description: errorDetails,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="min-h-screen bg-gradient-secondary p-2 sm:p-4 md:p-6">
      <div className="container mx-auto max-w-4xl h-[calc(100vh-5rem)] sm:h-[calc(100vh-8rem)]">
        <div className="text-center mb-3 sm:mb-6">
          <h1 className="text-2xl sm:text-4xl font-bold mb-1 sm:mb-2 bg-gradient-primary bg-clip-text text-transparent">
            Pergunte ao RAG
          </h1>
          <p className="text-xs sm:text-base text-muted-foreground">
            Faça perguntas sobre seus documentos e obtenha respostas inteligentes
          </p>
        </div>

        <div className="flex flex-col h-full">
          <Card className="flex-1 p-2 sm:p-4 md:p-6 bg-glass border-glass backdrop-blur-xl shadow-soft mb-2 sm:mb-4">
            <ScrollArea className="h-full pr-2 sm:pr-4">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${message.sender === 'user' ? 'justify-end' : 'justify-start'} w-full`}
                  >
                    {message.sender === 'ai' && (
                      <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center flex-shrink-0 font-bold text-foreground">
                        R
                      </div>
                    )}
                    
                    <div
                      className={`p-5 rounded-2xl ${
                        message.sender === 'user'
                          ? 'bg-white/10 backdrop-blur-sm border border-white/20 max-w-[80%]'
                          : 'bg-secondary/50 flex-1'
                      }`}
                      style={message.sender === 'user' ? { color: '#555555' } : {}}
                    >
                      <div className="text-base leading-relaxed prose prose-base max-w-none dark:prose-invert">
                        {message.sender === 'ai' ? (
                          <ReactMarkdown
                            components={{
                              p: ({ children }) => <p className="mb-4 last:mb-0">{children}</p>,
                              strong: ({ children }) => <strong className="font-bold text-foreground">{children}</strong>,
                              em: ({ children }) => <em className="italic">{children}</em>,
                              ul: ({ children }) => <ul className="list-disc list-inside mb-4 space-y-1">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-4 space-y-2">{children}</ol>,
                              li: ({ children }) => <li className="mb-1">{children}</li>,
                              code: ({ children }) => <code className="bg-muted px-1.5 py-0.5 rounded text-sm">{children}</code>,
                              pre: ({ children }) => <pre className="bg-muted p-3 rounded my-3 overflow-x-auto">{children}</pre>,
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        ) : (
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        )}
                      </div>
                      
                      {message.references && message.references.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-border/50">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText size={14} className="text-muted-foreground" />
                            <span className="text-xs font-semibold text-muted-foreground">Referências:</span>
                          </div>
                          <div className="space-y-1">
                            {message.references.map((ref, idx) => (
                              <p key={idx} className="text-xs text-muted-foreground pl-4">
                                {idx + 1}. {ref}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {message.sender === 'user' && (
                      <div className="w-10 h-10 bg-gradient-primary rounded-full flex items-center justify-center flex-shrink-0 font-bold text-white">
                        V
                      </div>
                    )}
                  </div>
                ))}

                {isLoading && (
                  <div className="flex gap-3 justify-start w-full">
                    <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center flex-shrink-0 font-bold text-foreground">
                      R
                    </div>
                    <div className="bg-secondary/50 p-5 rounded-2xl flex-1">
                      <div className="flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-base text-muted-foreground">
                          Pesquisando nos documentos...
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>

          <Card className="p-2 sm:p-4 bg-glass border-glass backdrop-blur-xl" {...getRootProps()}>
            {attachedFiles.length > 0 && (
              <div className="mb-2 sm:mb-3 flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-2 sm:px-3 py-1 sm:py-1.5 bg-secondary rounded-full text-xs sm:text-sm"
                  >
                    <Paperclip size={12} className="sm:w-[14px] sm:h-[14px]" />
                    <span className="max-w-[120px] sm:max-w-[200px] truncate">{file.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(index);
                      }}
                      className="hover:text-destructive"
                      disabled={isLoading}
                    >
                      <X size={12} className="sm:w-[14px] sm:h-[14px]" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {isDragActive && (
              <div className="absolute inset-0 bg-gradient-accent border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-10">
                <p className="text-base sm:text-lg text-primary font-semibold">Solte os arquivos aqui...</p>
              </div>
            )}

            <div className="flex gap-2 sm:gap-3 items-end">
              <div className="flex-1">
                <Textarea
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Digite sua pergunta..."
                  className="min-h-[48px] sm:min-h-[60px] resize-none border-border text-sm sm:text-base"
                  style={{ color: '#3598c9', backgroundColor: '#d9d9d9' }}
                  disabled={isLoading}
                />
              </div>
              <div className="flex gap-1 sm:gap-2">
                <Button
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.multiple = true;
                    input.accept = '.pdf,.txt,.md,.docx,.jpg,.jpeg,.png';
                    input.onchange = (e) => {
                      const files = Array.from((e.target as HTMLInputElement).files || []);
                      onDrop(files);
                    };
                    input.click();
                  }}
                  disabled={isLoading}
                  variant="outline"
                  size="lg"
                  className="h-[48px] sm:h-[60px] w-[48px] sm:w-auto px-2 sm:px-4"
                >
                  <Paperclip size={18} className="sm:w-[20px] sm:h-[20px]" />
                </Button>
                <Button
                  onClick={handleSendMessage}
                  disabled={!inputMessage.trim() || isLoading}
                  className="bg-gradient-primary hover:opacity-90 shadow-glow h-[48px] sm:h-[60px] w-[48px] sm:w-auto px-2 sm:px-4"
                  size="lg"
                >
                  {isLoading ? (
                    <Loader2 size={18} className="animate-spin sm:w-[20px] sm:h-[20px]" />
                  ) : (
                    <Send size={18} className="sm:w-[20px] sm:h-[20px]" />
                  )}
                </Button>
              </div>
            </div>
            
            <div className="hidden sm:flex items-center gap-2 mt-3 text-xs text-muted-foreground">
              <MessageCircle size={12} />
              <span>Pressione Enter para enviar, Shift+Enter para quebrar linha • Arraste arquivos ou clique no 📎</span>
            </div>
          </Card>
        </div>

      </div>
    </div>
  );
};

export default Ask;