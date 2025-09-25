import { Link, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Upload, MessageCircle, Home } from "lucide-react";

const Navigation = () => {
  const location = useLocation();

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
          
          <div className="flex gap-2">
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
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;