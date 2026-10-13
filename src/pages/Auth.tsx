import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { LogIn, Mail, Lock, Eye, EyeOff, Send, ArrowLeft } from "lucide-react";
import React from "react";
import logo from "@/assets/logo.png";

const Auth = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) navigate("/");
    };
    checkUser();
  }, [navigate]);

  const traduzirErro = (msg: string): string => {
    const m = msg.toLowerCase();
    if (m.includes("invalid login credentials") || m.includes("invalid credentials")) return "Email ou senha incorretos.";
    if (m.includes("email not confirmed")) return "Email ainda não confirmado. Verifique sua caixa de entrada.";
    if (m.includes("password should be at least")) return "A senha deve ter no mínimo 6 caracteres.";
    if (m.includes("unable to validate email address")) return "Endereço de email inválido.";
    if (m.includes("email rate limit exceeded")) return "Muitas tentativas. Aguarde alguns minutos e tente novamente.";
    if (m.includes("network") || m.includes("fetch")) return "Erro de conexão. Verifique sua internet.";
    return msg;
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (error) {
        toast({ title: "Erro ao enviar email", description: traduzirErro(error.message), variant: "destructive" });
        return;
      }
      toast({ title: "Email enviado!", description: "Se o endereço estiver cadastrado, você receberá um link para redefinir a senha." });
      setForgotMode(false);
    } catch {
      toast({ title: "Erro inesperado", description: "Tente novamente mais tarde.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        toast({ title: "Erro ao fazer login", description: traduzirErro(error.message), variant: "destructive" });
        return;
      }
      toast({ title: "Login realizado com sucesso!", className: "border-0 text-white", style: { backgroundColor: "#87b256" } as React.CSSProperties });
      navigate("/");
    } catch {
      toast({ title: "Erro inesperado", description: "Tente novamente mais tarde.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-[100dvh] bg-gradient-secondary flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-5 text-center">
          <div className="flex items-center justify-center gap-3 mb-1">
            <img src={logo} alt="Nefro & Uro.AI" className="h-12 w-auto object-contain" />
            <h1 className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
              RAG Nefro & Uro
            </h1>
          </div>
          <p className="text-xs text-muted-foreground italic">Retrieval-Augmented Generation</p>
        </div>

        <Card className="p-6 bg-glass border-glass backdrop-blur-xl shadow-soft">
          <form onSubmit={forgotMode ? handleForgot : handleSubmit} className="space-y-4">
            {forgotMode && (
              <p className="text-sm text-muted-foreground">
                Informe seu email e enviaremos um link para redefinir a senha.
              </p>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email" className="flex items-center gap-2 text-sm">
                <Mail size={14} />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                className="bg-transparent border-primary h-10"
              />
            </div>

            {!forgotMode && (
            <div className="space-y-1.5">
              <Label htmlFor="password" className="flex items-center gap-2 text-sm">
                <Lock size={14} />
                Senha
              </Label>
              <div className="relative">
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  className="bg-transparent border-primary pr-10 h-10"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                  aria-label={showPassword ? "Ocultar senha" : "Exibir senha"}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
              <div className="text-right">
                <button
                  type="button"
                  onClick={() => setForgotMode(true)}
                  className="text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                >
                  Esqueci minha senha
                </button>
              </div>
            </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-primary hover:opacity-90 shadow-glow mt-2"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {forgotMode ? "Enviando..." : "Entrando..."}
                </div>
              ) : forgotMode ? (
                <div className="flex items-center gap-2">
                  <Send size={18} />
                  Enviar link de recuperação
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <LogIn size={18} />
                  Entrar
                </div>
              )}
            </Button>

            {forgotMode && (
              <button
                type="button"
                onClick={() => setForgotMode(false)}
                className="w-full flex items-center justify-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                <ArrowLeft size={14} />
                Voltar ao login
              </button>
            )}
          </form>
        </Card>
      </div>
    </div>
  );
};

export default Auth;
