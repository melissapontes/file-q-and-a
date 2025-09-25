import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Upload, MessageCircle, Home, LogIn, LogOut, User } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const Navigation = () => {
  const location = useLocation();
  const { user, loading, signOut } = useAuth();

  const navItems = [
    { path: "/", label: "Home", icon: Home },
    { path: "/upload", label: "Upload", icon: Upload },
    { path: "/ask", label: "Ask", icon: MessageCircle },
  ];

  return (
    <nav className="bg-glass border-b border-glass backdrop-blur-xl">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <Link to="/" className="text-2xl font-bold bg-gradient-primary bg-clip-text text-transparent">
            RAG AI
          </Link>
          
          <div className="flex items-center gap-2">
            {!loading && (
              <>
                {user ? (
                  <>
                    {navItems.map(({ path, label, icon: Icon }) => (
                      <Button
                        key={path}
                        variant={location.pathname === path ? "default" : "ghost"}
                        size="sm"
                        asChild
                        className={location.pathname === path ? "shadow-glow" : ""}
                      >
                        <Link to={path} className="flex items-center gap-2">
                          <Icon size={16} />
                          {label}
                        </Link>
                      </Button>
                    ))}
                    <div className="flex items-center gap-2 ml-2 pl-2 border-l border-glass">
                      <span className="text-sm text-muted-foreground flex items-center gap-1">
                        <User size={14} />
                        {user.email}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={signOut}
                        className="flex items-center gap-2"
                      >
                        <LogOut size={16} />
                        Sair
                      </Button>
                    </div>
                  </>
                ) : (
                  <Button
                    variant="default"
                    size="sm"
                    asChild
                    className="shadow-glow"
                  >
                    <Link to="/auth" className="flex items-center gap-2">
                      <LogIn size={16} />
                      Entrar
                    </Link>
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;