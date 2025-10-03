import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Send, MessageCircle, Bot, User, Loader2, Paperclip, X } from "lucide-react";

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
}

const Ask = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content: 'Olá! Eu sou seu assistente RAG. Faça perguntas sobre os documentos no Vector Store e eu tentarei responder com base no conteúdo deles.\n\nVocê pode anexar arquivos (laudos médicos, exames, etc.) para contextualizar suas perguntas!',
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
    <div className="min-h-screen bg-gradient-secondary p-6">
      <div className="container mx-auto max-w-4xl h-[calc(100vh-8rem)]">
        <div className="text-center mb-6">
          <h1 className="text-4xl font-bold mb-2 bg-gradient-primary bg-clip-text text-transparent">
            Pergunte ao RAG
          </h1>
          <p className="text-muted-foreground">
            Faça perguntas sobre seus documentos e obtenha respostas inteligentes
          </p>
        </div>

        <div className="flex flex-col h-full">
          <Card className="flex-1 p-6 bg-glass border-glass backdrop-blur-xl shadow-soft mb-4">
            <ScrollArea className="h-full pr-4">
              <div className="space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-3 ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    {message.sender === 'ai' && (
                      <div className="w-8 h-8 bg-gradient-primary rounded-full flex items-center justify-center flex-shrink-0">
                        <Bot size={16} className="text-white" />
                      </div>
                    )}
                    
                    <div
                      className={`max-w-[80%] p-4 rounded-2xl ${
                        message.sender === 'user'
                          ? 'bg-primary text-primary-foreground ml-12'
                          : 'bg-secondary'
                      }`}
                    >
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {message.content}
                      </p>
                      <p className="text-xs opacity-70 mt-2">
                        {message.timestamp.toLocaleTimeString()}
                      </p>
                    </div>

                    {message.sender === 'user' && (
                      <div className="w-8 h-8 bg-secondary rounded-full flex items-center justify-center flex-shrink-0">
                        <User size={16} />
                      </div>
                    )}
                  </div>
                ))}

                {isLoading && (
                  <div className="flex gap-3 justify-start">
                    <div className="w-8 h-8 bg-gradient-primary rounded-full flex items-center justify-center flex-shrink-0">
                      <Bot size={16} className="text-white" />
                    </div>
                    <div className="bg-secondary p-4 rounded-2xl">
                      <div className="flex items-center gap-2">
                        <Loader2 size={16} className="animate-spin" />
                        <span className="text-sm text-muted-foreground">
                          Pesquisando nos documentos...
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </Card>

          <Card className="p-4 bg-glass border-glass backdrop-blur-xl" {...getRootProps()}>
            {attachedFiles.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {attachedFiles.map((file, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 px-3 py-1.5 bg-secondary rounded-full text-sm"
                  >
                    <Paperclip size={14} />
                    <span className="max-w-[200px] truncate">{file.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        removeFile(index);
                      }}
                      className="hover:text-destructive"
                      disabled={isLoading}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {isDragActive && (
              <div className="absolute inset-0 bg-gradient-accent border-2 border-dashed border-primary rounded-lg flex items-center justify-center z-10">
                <p className="text-lg text-primary font-semibold">Solte os arquivos aqui...</p>
              </div>
            )}

            <div className="flex gap-3 items-end">
              <div className="flex-1">
                <Textarea
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="Digite sua pergunta sobre os documentos..."
                  className="min-h-[60px] resize-none bg-background border-border"
                  disabled={isLoading}
                />
              </div>
              <div className="flex gap-2">
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
                  className="h-[60px]"
                >
                  <Paperclip size={20} />
                </Button>
                <Button
                  onClick={handleSendMessage}
                  disabled={!inputMessage.trim() || isLoading}
                  className="bg-gradient-primary hover:opacity-90 shadow-glow h-[60px]"
                  size="lg"
                >
                  {isLoading ? (
                    <Loader2 size={20} className="animate-spin" />
                  ) : (
                    <Send size={20} />
                  )}
                </Button>
              </div>
            </div>
            
            <div className="flex items-center gap-2 mt-3 text-xs text-muted-foreground">
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