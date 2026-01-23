import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Upload, MessageCircle, Home, LogIn, LogOut, User, FileText, Moon, Sun } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useTheme } from "next-themes";
import logo from "@/assets/logo.png";

const Navigation = () => {
  const location = useLocation();
  const { user, loading, signOut } = useAuth();
  const { theme, setTheme } = useTheme();

  const navItems = [
    { path: "/", label: "Home", icon: Home },
    { path: "/upload", label: "Upload", icon: Upload },
    { path: "/documents", label: "Documentos", icon: FileText },
    { path: "/ask", label: "Pergunte", icon: MessageCircle },
  ];

  return (
    <nav className="bg-glass border-b border-glass backdrop-blur-xl">
      <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-4">
        <div className="flex items-center justify-between gap-2">
          <Link to="/" className="flex items-center">
            <img src={logo} alt="Nefro & Uro.AI Logo" className="h-10 sm:h-12 w-auto object-contain" />
          </Link>
          
          <div className="flex items-center gap-1 sm:gap-2">
            {!loading && (
              <>
                {user ? (
                  <>
                    {navItems.map(({ path, label, icon: Icon }) => {
                      const isActive = location.pathname === path;
                      const isAskPage = path === "/ask";
                      const isHomePage = location.pathname === "/";

                      // Na Home, apenas "Pergunte" fica destacado; em outras páginas, a página ativa
                      const shouldHighlight = isHomePage ? isAskPage : isActive;
                      const variant = shouldHighlight ? "default" : "ghost";

                      return (
                        <Button
                          key={path}
                          variant={variant}
                          size="sm"
                          asChild
                          className={shouldHighlight ? "shadow-glow" : ""}
                        >
                          <Link to={path} className="flex items-center gap-1 sm:gap-2">
                            <Icon size={16} />
                            <span className="hidden sm:inline">{label}</span>
                          </Link>
                        </Button>
                      );
                    })}
                    <div className="flex items-center gap-1 sm:gap-2 ml-1 sm:ml-2 pl-1 sm:pl-2 border-l border-glass">
                      <span className="text-xs sm:text-sm text-muted-foreground hidden md:flex items-center gap-1">
                        <User size={14} />
                        {user.email}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                        className="relative"
                        aria-label="Alternar tema"
                      >
                        <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                        <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={signOut}
                        className="flex items-center gap-1 sm:gap-2"
                      >
                        <LogOut size={16} />
                        <span className="hidden sm:inline">Sair</span>
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
                      className="relative"
                      aria-label="Alternar tema"
                    >
                      <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                      <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                    </Button>
                    <Button
                      variant="default"
                      size="sm"
                      asChild
                      className="shadow-glow"
                    >
                      <Link to="/auth" className="flex items-center gap-1 sm:gap-2">
                        <LogIn size={16} />
                        <span className="hidden sm:inline">Entrar</span>
                      </Link>
                    </Button>
                  </>
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