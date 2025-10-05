import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { LogIn, UserPlus, Mail, Lock, ArrowLeft, Eye, EyeOff } from "lucide-react";

const Auth = () => {
  const [isLogin, setIsLogin] = useState(true);
  const [isForgotPassword, setIsForgotPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    // Check if user is already logged in
    const checkUser = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        navigate("/");
      }
    };
    checkUser();
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isForgotPassword) {
        const { data, error } = await supabase.functions.invoke("reset-password", {
          body: { 
            email,
            redirectTo: `${window.location.origin}/auth`,
          },
        });

        if (error || data?.error) {
          toast({
            title: "Erro ao enviar email",
            description: data?.error || error.message,
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Email enviado!",
          description: "Verifique sua caixa de entrada para redefinir sua senha.",
        });
        setIsForgotPassword(false);
      } else if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) {
          toast({
            title: "Erro ao fazer login",
            description: error.message,
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Login realizado com sucesso!",
          description: "Bem-vindo de volta.",
        });
        navigate("/");
      } else {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
          }
        });

        if (error) {
          toast({
            title: "Erro ao criar conta",
            description: error.message,
            variant: "destructive",
          });
          return;
        }

        toast({
          title: "Conta criada com sucesso!",
          description: "Verifique seu email para confirmar a conta.",
        });
      }
    } catch (error) {
      toast({
        title: "Erro inesperado",
        description: "Tente novamente mais tarde.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-secondary flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <Link 
            to="/" 
            className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-4"
          >
            <ArrowLeft size={16} />
            Voltar ao início
          </Link>
          <h1 className="text-3xl font-bold mb-2 bg-gradient-primary bg-clip-text text-transparent">
            {isForgotPassword ? "Recuperar Senha" : isLogin ? "Fazer Login" : "Criar Conta"}
          </h1>
          <p className="text-muted-foreground">
            {isForgotPassword
              ? "Digite seu email para receber instruções"
              : isLogin 
                ? "Entre para acessar o sistema RAG" 
                : "Crie sua conta para começar"
            }
          </p>
        </div>

        <Card className="p-8 bg-glass border-glass backdrop-blur-xl shadow-soft">
          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2">
                <Mail size={16} />
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="seu@email.com"
                required
                className="bg-secondary border-glass"
              />
            </div>

            {!isForgotPassword && (
              <div className="space-y-2">
                <Label htmlFor="password" className="flex items-center gap-2">
                  <Lock size={16} />
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
                    minLength={6}
                    className="bg-secondary border-glass pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                    aria-label={showPassword ? "Ocultar senha" : "Exibir senha"}
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {!isLogin && (
                  <p className="text-xs text-muted-foreground">
                    Mínimo 6 caracteres
                  </p>
                )}
              </div>
            )}

            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-primary hover:opacity-90 shadow-glow"
              size="lg"
            >
              {loading ? (
                <div className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  {isForgotPassword ? "Enviando..." : isLogin ? "Entrando..." : "Criando conta..."}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  {isForgotPassword ? <Mail size={20} /> : isLogin ? <LogIn size={20} /> : <UserPlus size={20} />}
                  {isForgotPassword ? "Enviar Email" : isLogin ? "Entrar" : "Criar Conta"}
                </div>
              )}
            </Button>
          </form>

          <div className="mt-6 text-center space-y-3">
            {!isForgotPassword && isLogin && (
              <button
                type="button"
                onClick={() => setIsForgotPassword(true)}
                className="text-sm text-muted-foreground hover:text-foreground transition-colors block w-full"
              >
                Esqueceu sua senha?
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setIsForgotPassword(false);
                setIsLogin(!isLogin);
              }}
              className="text-sm text-muted-foreground hover:text-foreground transition-colors block w-full"
            >
              {isForgotPassword
                ? "Voltar ao login"
                : isLogin 
                  ? "Não tem uma conta? Criar conta" 
                  : "Já tem uma conta? Fazer login"
              }
            </button>
          </div>
        </Card>
      </div>
    </div>
  );
};

export default Auth;