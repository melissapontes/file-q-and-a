import { useState, useCallback, useRef } from "react";
import logoImg from "@/assets/logo.png";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Send, Loader2, Paperclip, X, FileText, Search, CheckCircle2, Circle, ArrowUpRight } from "lucide-react";
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

const WELCOME =
  'Sou seu assistente em nefrologia e urologia veterinária. Faça uma pergunta — eu cruzo os documentos indexados e devolvo uma resposta objetiva, por espécie, e com as fontes citadas.';

// Perguntas-exemplo que já exercitam o filtro de espécie e a detecção de protocolo/doses.
const EXAMPLES = [
  'Qual o protocolo de tratamento para doença renal crônica em gatos? Inclua as doses.',
  'Como manejar urolitíase por oxalato de cálcio em cães?',
  'Quais os valores de referência de creatinina e SDMA no estadiamento IRIS?',
];

const Index = () => {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', content: WELCOME, sender: 'ai', timestamp: new Date() },
  ]);
  const [inputMessage, setInputMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const { toast } = useToast();
  const scrollRef = useRef<HTMLDivElement>(null);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const validFiles = acceptedFiles.filter(file => {
      const validTypes = ['.pdf', '.txt', '.md', '.docx', '.jpg', '.jpeg', '.png'];
      const extension = '.' + file.name.split('.').pop()?.toLowerCase();
      return validTypes.includes(extension);
    });

    if (validFiles.length !== acceptedFiles.length) {
      toast({
        title: "Arquivos inválidos",
        description: "Apenas .pdf, .txt, .md, .docx, .jpg, .jpeg e .png são aceitos.",
        variant: "destructive",
      });
    }

    setAttachedFiles(prev => [...prev, ...validFiles]);
  }, [toast]);

  const { getRootProps, getInputProps, open: openFilePicker, isDragActive } = useDropzone({
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

  const handleSendMessage = async (override?: string) => {
    const question = (override ?? inputMessage).trim();
    if (!question || isLoading) return;

    const filesInfo = attachedFiles.length > 0
      ? `\n📎 Anexos: ${attachedFiles.map(f => f.name).join(', ')}`
      : '';

    const userMessage: Message = {
      id: Date.now().toString(),
      content: question + filesInfo,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    const currentFiles = [...attachedFiles];
    setInputMessage("");
    setAttachedFiles([]);
    setIsLoading(true);
    requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }));

    try {
      const formData = new FormData();
      formData.append('question', question);
      currentFiles.forEach((file) => formData.append('files', file));

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Não autenticado');

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/ask-document`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session.access_token}` },
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Falha ao obter a resposta');
      }

      const data = await response.json();

      const aiMessage: Message = {
        id: (Date.now() + 1).toString(),
        content: data.answer || 'Não consegui processar sua pergunta.',
        sender: 'ai',
        timestamp: new Date(),
        references: data.references || [],
        allRelevantSources: data.all_relevant_sources || [],
        stats: data.stats,
      };

      setMessages(prev => [...prev, aiMessage]);
    } catch (error: any) {
      console.error('Error asking document:', error);
      const errorDetails = error?.message || (typeof error === 'string' ? error : 'Erro desconhecido ao processar sua pergunta.');

      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        content: `**Não foi possível responder.**\n\n${errorDetails}\n\nTente novamente em instantes.`,
        sender: 'ai',
        timestamp: new Date(),
      }]);

      toast({ title: "Erro ao processar pergunta", description: errorDetails, variant: "destructive" });
    } finally {
      setIsLoading(false);
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }));
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const isEmpty = messages.length === 1;

  return (
    <div {...getRootProps()} className="flex-1 flex flex-col overflow-hidden outline-none">
      <input {...getInputProps()} />

      {/* Overlay de arrastar-e-soltar */}
      {isDragActive && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-brand px-10 py-8 text-center">
            <Paperclip className="mx-auto mb-2 text-brand" size={24} />
            <p className="font-medium text-foreground">Solte para anexar à sua pergunta</p>
          </div>
        </div>
      )}

      <div className="w-full max-w-3xl mx-auto flex flex-col flex-1 overflow-hidden px-4 py-4 sm:py-6">

        {isEmpty ? (
          /* ───────── Herói / estado inicial ───────── */
          <div className="flex-1 flex flex-col justify-center min-h-0">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground mb-5">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-verified" />
              Respostas fundamentadas nos documentos · cães e gatos
            </div>

            <h1 className="font-serif text-3xl sm:text-[2.6rem] leading-[1.1] text-foreground max-w-xl">
              O que você precisa saber sobre o rim e o trato urinário hoje?
            </h1>
            <p className="mt-4 text-[15px] leading-relaxed text-muted-foreground max-w-lg">
              {WELCOME}
            </p>

            <div className="mt-8">
              <p className="text-xs font-medium text-muted-foreground mb-3">Comece por uma destas</p>
              <div className="flex flex-col gap-2">
                {EXAMPLES.map((q) => (
                  <button
                    key={q}
                    onClick={() => handleSendMessage(q)}
                    className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 text-left text-sm text-foreground transition-colors hover:border-brand/60 hover:bg-secondary"
                  >
                    <span>{q}</span>
                    <ArrowUpRight size={16} className="shrink-0 text-muted-foreground transition-colors group-hover:text-brand" />
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          /* ───────── Conversa ───────── */
          <ScrollArea className="flex-1 -mx-1 px-1">
            <div ref={scrollRef} className="space-y-5 pb-2">
              {messages.map((message) => (
                <div key={message.id} className={`flex gap-3 ${message.sender === 'user' ? 'justify-end' : 'justify-start'} w-full`}>
                  {message.sender === 'ai' && (
                    <div className="hidden sm:flex w-8 h-8 rounded-full items-center justify-center shrink-0 overflow-hidden mt-1 ring-1 ring-border bg-card">
                      <img src={logoImg} alt="" className="w-full h-full object-contain p-1" />
                    </div>
                  )}

                  <div
                    className={
                      message.sender === 'user'
                        ? 'max-w-[85%] rounded-2xl rounded-tr-sm bg-secondary border border-border px-4 py-2.5 text-foreground'
                        : 'flex-1 min-w-0 rounded-xl rounded-tl-sm bg-card border border-border shadow-soft rule-brand pl-5 pr-4 py-3.5 text-card-foreground'
                    }
                  >
                    <div className="text-[15px] leading-relaxed prose prose-sm sm:prose-base max-w-full dark:prose-invert break-words prose-headings:font-serif [&>*]:max-w-full [&_*]:break-words">
                      {message.sender === 'ai' ? (
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                            strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                            em: ({ children }) => <em className="italic">{children}</em>,
                            ul: ({ children }) => <ul className="list-disc list-outside ml-5 mb-3 space-y-1">{children}</ul>,
                            ol: ({ children }) => <ol className="list-decimal list-outside ml-5 mb-3 space-y-1">{children}</ol>,
                            li: ({ children }) => {
                              const hasContent = Array.isArray(children)
                                ? children.some(c => c !== null && c !== undefined && c !== '')
                                : children !== null && children !== undefined && children !== '';
                              if (!hasContent) return null;
                              return <li className="mb-1">{children}</li>;
                            },
                            code: ({ children }) => <code className="bg-muted px-1 py-0.5 rounded text-[0.85em]">{children}</code>,
                            pre: ({ children }) => <pre className="bg-muted p-3 rounded-lg my-2 overflow-x-auto text-sm">{children}</pre>,
                          }}
                        >
                          {message.content}
                        </ReactMarkdown>
                      ) : (
                        <p className="whitespace-pre-wrap m-0">{message.content}</p>
                      )}
                    </div>

                    {message.references && message.references.length > 0 && (
                      <div className="mt-3.5 pt-3 border-t border-border">
                        <div className="flex items-center gap-1.5 mb-2">
                          <FileText size={13} className="text-brand" />
                          <span className="text-xs font-semibold text-foreground">Referências citadas</span>
                        </div>
                        <ol className="space-y-1">
                          {message.references.map((ref, idx) => (
                            <li key={idx} className="flex gap-2 text-xs text-muted-foreground">
                              <span className="text-brand font-medium tabular-nums">{idx + 1}.</span>
                              <span>{ref}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {message.allRelevantSources && message.allRelevantSources.length > 0 && (
                      <div className="mt-2.5 pt-2.5 border-t border-border">
                        <Accordion type="single" collapsible className="w-full">
                          <AccordionItem value="sources" className="border-none">
                            <AccordionTrigger className="text-xs font-semibold text-muted-foreground hover:no-underline hover:text-foreground py-1">
                              <div className="flex items-center gap-1.5">
                                <Search size={13} />
                                <span>
                                  Documentos consultados
                                  {message.stats && (
                                    <span className="ml-1 font-normal">
                                      ({message.stats.total_consulted} encontrados · {message.stats.total_cited} citados)
                                    </span>
                                  )}
                                </span>
                              </div>
                            </AccordionTrigger>
                            <AccordionContent>
                              <div className="space-y-1.5 pt-1.5">
                                {message.allRelevantSources.map((source, idx) => (
                                  <div key={idx} className={`text-xs px-2.5 py-1.5 rounded-md ${source.cited ? 'bg-verified-soft' : 'bg-muted/60'}`}>
                                    <div className="flex items-start gap-2">
                                      {source.cited ? (
                                        <CheckCircle2 size={13} className="text-verified mt-0.5 shrink-0" />
                                      ) : (
                                        <Circle size={13} className="text-muted-foreground mt-0.5 shrink-0" />
                                      )}
                                      <div className="flex-1 min-w-0">
                                        <p className={`break-words ${source.cited ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>
                                          {source.filename}
                                        </p>
                                        {source.score !== null && (
                                          <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">
                                            Relevância {(source.score * 100).toFixed(1)}%
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
                </div>
              ))}

              {isLoading && (
                <div className="flex gap-3 justify-start w-full">
                  <div className="hidden sm:flex w-8 h-8 rounded-full items-center justify-center shrink-0 overflow-hidden mt-1 ring-1 ring-border bg-card">
                    <img src={logoImg} alt="" className="w-full h-full object-contain p-1" />
                  </div>
                  <div className="rounded-xl rounded-tl-sm bg-card border border-border shadow-soft rule-brand pl-5 pr-4 py-3.5 flex items-center gap-2.5">
                    <Loader2 size={15} className="animate-spin text-brand shrink-0" />
                    <span className="text-sm text-muted-foreground">Consultando os documentos…</span>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        )}

        {/* ───────── Barra de entrada ───────── */}
        <div className="mt-4 shrink-0">
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {attachedFiles.map((file, index) => (
                <span key={index} className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-xs text-foreground">
                  <Paperclip size={12} className="text-muted-foreground" />
                  <span className="max-w-[160px] truncate">{file.name}</span>
                  <button onClick={() => removeFile(index)} className="text-muted-foreground hover:text-destructive" aria-label="Remover anexo">
                    <X size={13} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 shadow-soft focus-within:border-brand/70 focus-within:ring-2 focus-within:ring-brand/20 transition-colors">
            <button
              onClick={openFilePicker}
              className="h-10 w-10 shrink-0 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
              aria-label="Anexar arquivo"
              type="button"
            >
              <Paperclip size={18} />
            </button>
            <Textarea
              value={inputMessage}
              onChange={(e) => setInputMessage(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Pergunte sobre diagnóstico, protocolo, doses…"
              className="flex-1 min-h-[40px] max-h-[140px] resize-none border-0 bg-transparent px-1 py-2 text-[15px] shadow-none focus-visible:ring-0 placeholder:text-muted-foreground"
              disabled={isLoading}
            />
            <Button
              onClick={() => handleSendMessage()}
              disabled={!inputMessage.trim() || isLoading}
              className="h-10 w-10 p-0 shrink-0 rounded-lg bg-brand text-brand-foreground hover:bg-brand/90 disabled:opacity-40"
            >
              {isLoading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </Button>
          </div>
          <p className="hidden sm:block mt-2 text-xs text-muted-foreground pl-1">
            Enter envia · Shift + Enter quebra linha · arraste arquivos para anexar
          </p>
        </div>

      </div>
    </div>
  );
};

export default Index;
