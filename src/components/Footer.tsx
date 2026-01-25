import { Instagram } from "lucide-react";

const Footer = () => {
  return (
    <footer className="bg-glass border-t border-glass backdrop-blur-xl py-2 sm:py-4 flex-shrink-0">
      <div className="container mx-auto px-3 sm:px-4 text-center">
        <p className="text-muted-foreground text-xs sm:text-sm">© 2026 RAG Nefro e Uro.</p>
        <p className="text-muted-foreground text-xs sm:text-sm mt-0.5 sm:mt-1">
          <span className="hidden sm:inline">Desenvolvido por </span>
          <a
            href="https://www.instagram.com/mpdigital.tech/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium hover:text-primary transition-colors inline-flex items-center gap-1"
          >
            <span className="sm:hidden">Por </span>
            MP Digital Vet
            <Instagram size={12} className="sm:w-[14px] sm:h-[14px]" />
          </a>
          <span className="hidden sm:inline"> — Soluções Digitais para a Saúde.</span>
        </p>
      </div>
    </footer>
  );
};

export default Footer;
