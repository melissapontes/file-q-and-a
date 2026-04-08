import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Upload, LogOut, User, FileText, Bug, Tags, Menu, X, LogIn } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ThemeToggle from "./ThemeToggle";
import logo from "@/assets/logo.png";

const Navigation = () => {
  const location = useLocation();
  const { user, loading, isAdmin, signOut } = useAuth();
  const [open, setOpen] = useState(false);

  const menuItems = [
    { path: "/topics", label: "Tópicos", icon: Tags, adminOnly: false },
    { path: "/upload", label: "Upload", icon: Upload, adminOnly: true },
    { path: "/documents", label: "Documentos", icon: FileText, adminOnly: true },
    { path: "/debug", label: "Debug", icon: Bug, adminOnly: true },
  ].filter(item => !item.adminOnly || isAdmin);

  return (
    <>
      <nav className="bg-glass border-b border-glass backdrop-blur-xl relative z-50">
        <div className="container mx-auto px-4 py-2">
          <div className="flex items-center justify-between">
            {/* Logo + Nome */}
            <Link to="/" className="flex items-center gap-2" onClick={() => setOpen(false)}>
              <img src={logo} alt="Logo" className="h-10 w-auto object-contain" />
              <span className="font-bold text-base sm:text-lg bg-gradient-primary bg-clip-text text-transparent leading-tight">
                RAG Nefro & Uro
              </span>
            </Link>

            {/* Direita */}
            <div className="flex items-center gap-2">
              <ThemeToggle />
              {!loading && (
                user ? (
                  <button
                    onClick={() => setOpen(prev => !prev)}
                    className="p-2 rounded-md hover:bg-muted transition-colors"
                    aria-label="Menu"
                  >
                    {open ? <X size={22} /> : <Menu size={22} />}
                  </button>
                ) : (
                  <Link
                    to="/auth"
                    className="flex items-center gap-1 text-sm font-medium text-primary hover:opacity-80 transition-opacity"
                  >
                    <LogIn size={16} />
                    Entrar
                  </Link>
                )
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Drawer */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="fixed top-0 right-0 h-full w-64 z-50 bg-card border-l border-border shadow-2xl flex flex-col">
            {/* Header do drawer */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <User size={14} className="text-muted-foreground" />
                <span className="text-xs text-muted-foreground truncate max-w-[160px]">{user?.email}</span>
              </div>
              <button onClick={() => setOpen(false)} className="p-1 hover:text-foreground text-muted-foreground">
                <X size={18} />
              </button>
            </div>

            {/* Itens */}
            <nav className="flex-1 px-2 py-3 space-y-1">
              {menuItems.map(({ path, label, icon: Icon }) => {
                const isActive = location.pathname === path;
                return (
                  <Link
                    key={path}
                    to={path}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                      isActive
                        ? "bg-primary text-primary-foreground shadow-glow"
                        : "hover:bg-muted text-foreground"
                    }`}
                  >
                    <Icon size={17} />
                    {label}
                  </Link>
                );
              })}
            </nav>

            {/* Sair */}
            <div className="px-2 py-3 border-t border-border">
              <button
                onClick={() => { setOpen(false); signOut(); }}
                className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-destructive dark:text-white hover:bg-destructive/10 w-full transition-colors"
              >
                <LogOut size={17} />
                Sair
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
};

export default Navigation;
