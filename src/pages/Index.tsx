import { useState, useCallback } from "react";
import logoImg from "@/assets/logo.png";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Send, MessageCircle, Loader2, Paperclip, X, FileText, Search, CheckCircle2, Circle, PawPrint } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";

interface RelevantSource {
  file_id: string;
  filename: string;
  score: number | null;
  cited: boolean;
}

interface Message {
  id: string;
  content: string;
  sender: 'user' | 'ai';
  timestamp: Date;
  references?: string[];
  allRelevantSources?: RelevantSource[];
  stats?: {
    total_consulted: number;
    total_cited: number;
    consultation_coverage: string;
  };
}

const Index = () => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      content: 'Sou seu assistente em Nefro e Uro Vet. Faça uma pergunta — eu cruzo evidências e te entrego uma resposta objetiva e referenciada.',
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

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Não autenticado');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-document`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
        },
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
        allRelevantSources: data.all_relevant_sources || [],
        stats: data.stats,
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error: any) {
      console.error('Error asking document:', error);

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

  const hasOnlyWelcomeMessage = messages.length === 1;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="w-full max-w-3xl mx-auto flex flex-col flex-1 overflow-hidden px-2 sm:px-4 py-2 sm:py-4">

        {/* Área de mensagens */}
        <div className={`flex flex-col flex-1 overflow-hidden ${hasOnlyWelcomeMessage ? 'gap-3' : 'gap-2'}`}>
          <div className={`bg-glass border border-glass backdrop-blur-xl rounded-xl flex flex-col ${hasOnlyWelcomeMessage ? 'p-3 sm:p-5' : 'flex-1 overflow-hidden p-2 sm:p-4'}`}>
            <ScrollArea className={hasOnlyWelcomeMessage ? 'h-auto' : 'flex-1'}>
              <div className="space-y-3 sm:space-y-4">
                {messages.map((message) => (
                  <div
                    key={message.id}
                    className={`flex gap-2 ${message.sender === 'user' ? 'justify-end' : 'justify-start'} w-full`}
                  >
                    {/* Avatar AI — oculto em mobile */}
                    {message.sender === 'ai' && (
                      <div className="hidden sm:flex w-8 h-8 rounded-full items-center justify-center flex-shrink-0 overflow-hidden mt-1">
                        <img src={logoImg} alt="RAG" className="w-full h-full object-contain" />
                      </div>
                    )}

                    <div
                      className={`px-3 py-2.5 sm:px-4 sm:py-3 rounded-2xl break-words overflow-hidden ${
                        message.sender === 'user'
                          ? 'bg-transparent border-2 border-primary/60 max-w-[88%] sm:max-w-[78%] text-foreground'
                          : 'bg-transparent border border-primary/30 flex-1 min-w-0 text-foreground'
                      }`}
                    >
                      <div className="text-base leading-relaxed prose prose-base max-w-full dark:prose-invert break-words [&>*]:max-w-full [&_*]:break-words">
                        {message.sender === 'ai' ? (
                          <ReactMarkdown
                            components={{
                              p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                              strong: ({ children }) => <strong className="font-bold text-foreground">{children}</strong>,
                              em: ({ children }) => <em className="italic">{children}</em>,
                              ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>,
                              ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-3 space-y-1">{children}</ol>,
                              li: ({ children }) => {
                                const hasContent = Array.isArray(children)
                                  ? children.some(c => c !== null && c !== undefined && c !== '')
                                  : children !== null && children !== undefined && children !== '';
                                if (!hasContent) return null;
                                return <li className="mb-1">{children}</li>;
                              },
                              code: ({ children }) => <code className="bg-muted px-1 py-0.5 rounded text-sm">{children}</code>,
                              pre: ({ children }) => <pre className="bg-muted p-3 rounded my-2 overflow-x-auto text-sm">{children}</pre>,
                            }}
                          >
                            {message.content}
                          </ReactMarkdown>
                        ) : (
                          <p className="whitespace-pre-wrap">{message.content}</p>
                        )}
                      </div>

                      {message.references && message.references.length > 0 && (
                        <div className="mt-3 pt-2.5 border-t border-border/50">
                          <div className="flex items-center gap-1.5 mb-1.5">
                            <FileText size={13} className="text-muted-foreground" />
                            <span className="text-xs font-semibold text-muted-foreground">Referências Citadas:</span>
                          </div>
                          <div className="space-y-1">
                            {message.references.map((ref, idx) => (
                              <p key={idx} className="text-xs text-muted-foreground pl-3">
                                {idx + 1}. {ref}
                              </p>
                            ))}
                          </div>
                        </div>
                      )}

                      {message.allRelevantSources && message.allRelevantSources.length > 0 && (
                        <div className="mt-2.5 pt-2.5 border-t border-border/50">
                          <Accordion type="single" collapsible className="w-full">
                            <AccordionItem value="sources" className="border-none">
                              <AccordionTrigger className="text-xs font-semibold text-muted-foreground hover:no-underline py-1">
                                <div className="flex items-center gap-1.5">
                                  <Search size={13} />
                                  <span>
                                    Documentos Consultados
                                    {message.stats && (
                                      <span className="ml-1 font-normal">
                                        ({message.stats.total_consulted} encontrados, {message.stats.total_cited} citados)
                                      </span>
                                    )}
                                  </span>
                                </div>
                              </AccordionTrigger>
                              <AccordionContent>
                                <div className="space-y-1.5 pt-1.5">
                                  {message.allRelevantSources.map((source, idx) => (
                                    <div
                                      key={idx}
                                      className={`text-xs pl-3 py-1.5 rounded ${source.cited ? 'bg-green-500/10' : 'bg-muted/50'}`}
                                    >
                                      <div className="flex items-start gap-1.5">
                                        {source.cited ? (
                                          <CheckCircle2 size={13} className="text-green-500 mt-0.5 flex-shrink-0" />
                                        ) : (
                                          <Circle size={13} className="text-muted-foreground mt-0.5 flex-shrink-0" />
                                        )}
                                        <div className="flex-1 min-w-0">
                                          <p className={`break-words ${source.cited ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                                            {source.filename}
                                          </p>
                                          {source.score !== null && (
                                            <p className="text-[10px] text-muted-foreground mt-0.5">
                                              Relevância: {(source.score * 100).toFixed(1)}%
                                            </p>
                                          )}
                                        </div>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </AccordionContent>
                            </AccordionItem>
                          </Accordion>
                        </div>
                      )}
                    </div>

                    {/* Avatar user — oculto em mobile */}
                    {message.sender === 'user' && (
                      <div className="hidden sm:flex w-8 h-8 bg-gradient-primary rounded-full items-center justify-center flex-shrink-0 mt-1">
                        <PawPrint size={16} className="text-white" />
                      </div>
                    )}
                  </div>
                ))}

                {isLoading && (
                  <div className="flex gap-2 justify-start w-full">
                    <div className="hidden sm:flex w-8 h-8 rounded-full items-center justify-center flex-shrink-0 overflow-hidden mt-1">
                      <img src={logoImg} alt="RAG" className="w-full h-full object-contain" />
                    </div>
                    <div className="bg-transparent border border-primary/30 px-3 py-2.5 rounded-2xl flex-1 min-w-0 text-foreground">
                      <div className="flex items-center gap-2">
                        <Loader2 size={15} className="animate-spin flex-shrink-0" />
                        <span className="text-base text-muted-foreground">Pesquisando nos documentos...</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* Input */}
          <div className="bg-glass border border-glass backdrop-blur-xl rounded-xl p-2 sm:p-3">
            <div className="flex gap-2 items-end">
              <Textarea
                value={inputMessage}
                onChange={(e) => setInputMessage(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="Digite sua pergunta..."
                className="flex-1 min-h-[44px] max-h-[120px] resize-none border-border text-base text-foreground placeholder:text-muted-foreground"
                disabled={isLoading}
              />
              <Button
                onClick={handleSendMessage}
                disabled={!inputMessage.trim() || isLoading}
                className="bg-gradient-primary hover:opacity-90 shadow-glow h-11 w-11 p-0 flex-shrink-0"
              >
                {isLoading ? (
                  <Loader2 size={18} className="animate-spin" />
                ) : (
                  <Send size={18} />
                )}
              </Button>
            </div>
            <p className="hidden sm:block mt-2 text-xs text-muted-foreground pl-1">
              Enter para enviar · Shift+Enter para quebrar linha
            </p>
          </div>
        </div>

      </div>
    </div>
  );
};

export default Index;
