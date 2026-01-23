import { Instagram } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-glass border-t border-glass backdrop-blur-xl py-6">
      <div className="container mx-auto px-4 text-center">
        <p className="text-muted-foreground text-sm">© 2026 RAG Nefro e Uro.</p>
        <p className="text-muted-foreground text-sm mt-1">
          Desenvolvido por{" "}
          <a
            href="https://www.instagram.com/mpdigital.ai/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium hover:text-primary transition-colors inline-flex items-center gap-1"
          >
            MP Digital Vet
            <Instagram size={14} />
          </a>{" "}
          — Soluções Digitais para a Saúde.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
