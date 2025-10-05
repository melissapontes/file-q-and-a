import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Upload, MessageCircle, Zap, Shield, Sparkles } from "lucide-react";

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-secondary">
      {/* Hero Section */}
      <section className="container mx-auto px-6 py-20 text-center">
        <div className="max-w-4xl mx-auto">
          <div className="mb-8">
           
            
            <h1 className="text-6xl font-bold mb-6 bg-gradient-primary bg-clip-text text-transparent leading-tight">
              RAG
              <br />
              Nefro & URO
            </h1>
            
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
              Pergunte ao RAG Nefro & Uro e obtenha respostas precisas baseadas no conteúdo dos seus arquivos.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4 justify-center mb-16">
            <Button 
              size="lg" 
              className="bg-gradient-primary hover:opacity-90 shadow-glow text-lg px-8 py-6"
              asChild
            >
              <Link to="/upload" className="flex items-center gap-2">
                <Upload size={20} />
                Upload
              </Link>
            </Button>
            
            <Button 
              variant="outline" 
              size="lg" 
              className="border-glass bg-glass backdrop-blur-xl text-lg px-8 py-6"
              asChild
            >
              <Link to="/ask" className="flex items-center gap-2">
                <MessageCircle size={20} />
                Pergunte
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* Features Section */}
      <section className="container mx-auto px-6 py-16">
        <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto">
          <Card className="p-8 bg-glass border-glass backdrop-blur-xl shadow-soft text-center hover:scale-105 transition-transform duration-300">
            <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center mx-auto mb-6 shadow-glow">
              <Upload className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-xl font-bold mb-4">Upload Simples</h3>
            <p className="text-muted-foreground leading-relaxed">
              Interface drag & drop intuitiva para upload de documentos PDF, TXT, MD e DOCX 
              com validação automática de tipos.
            </p>
          </Card>

          <Card className="p-8 bg-glass border-glass backdrop-blur-xl shadow-soft text-center hover:scale-105 transition-transform duration-300">
            <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center mx-auto mb-6 shadow-glow">
              <Zap className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-xl font-bold mb-4">RAG Inteligente</h3>
            <p className="text-muted-foreground leading-relaxed">
              Tecnologia de Retrieval-Augmented Generation (RAG) para respostas precisas 
              baseadas no conteúdo dos seus documentos.
            </p>
          </Card>

          <Card className="p-8 bg-glass border-glass backdrop-blur-xl shadow-soft text-center hover:scale-105 transition-transform duration-300">
            <div className="w-12 h-12 bg-gradient-primary rounded-full flex items-center justify-center mx-auto mb-6 shadow-glow">
              <Shield className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-xl font-bold mb-4">Seguro & Rápido</h3>
            <p className="text-muted-foreground leading-relaxed">
              Processamento seguro com feedback em tempo real e 
              interface responsiva para melhor experiência.
            </p>
          </Card>
        </div>
      </section>

    </div>
  );
};

export default Index;
