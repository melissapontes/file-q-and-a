import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Upload, MessageCircle, Home, FileText, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import logo from "@/assets/logo.png";

const Navigation = () => {
  const location = useLocation();
  const { theme, setTheme } = useTheme();

  const navItems = [
    { path: "/", label: "Home", icon: Home },
    { path: "/upload", label: "Upload", icon: Upload },
    { path: "/documents", label: "Documentos", icon: FileText },
    { path: "/ask", label: "Pergunte", icon: MessageCircle },
  ];

  return (
    <nav className="bg-glass border-b border-glass backdrop-blur-xl flex-shrink-0">
      <div className="container mx-auto px-2 sm:px-4 py-1.5 sm:py-3">
        <div className="flex items-center justify-between gap-1 sm:gap-2">
          <Link to="/" className="flex items-center flex-shrink-0">
            <img src={logo} alt="Nefro & Uro.AI Logo" className="h-8 sm:h-12 w-auto object-contain" />
          </Link>
          
          <div className="flex items-center gap-0.5 sm:gap-2">
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
                  className={`h-8 sm:h-9 px-2 sm:px-3 ${shouldHighlight ? "shadow-glow" : ""}`}
                >
                  <Link to={path} className="flex items-center gap-0.5 sm:gap-2">
                    <Icon size={14} className="sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">{label}</span>
                  </Link>
                </Button>
              );
            })}
            <div className="flex items-center gap-1 sm:gap-2 ml-1 sm:ml-2 pl-1 sm:pl-2 border-l border-glass">
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
            </div>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;
