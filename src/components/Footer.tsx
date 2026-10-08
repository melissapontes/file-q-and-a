import { Instagram } from "lucide-react";

const Footer = () => {
  return (
    <footer className="border-t border-border py-5">
      <div className="container mx-auto px-4 flex flex-col sm:flex-row items-center justify-center gap-x-2 gap-y-1 text-center text-xs text-muted-foreground">
        <span>© 2026 Nefro &amp; Uro Vet</span>
        <span className="hidden sm:inline text-border">·</span>
        <span className="inline-flex items-center gap-1">
          Desenvolvido por
          <a
            href="https://www.instagram.com/mpdigital.tech/"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-foreground hover:text-brand transition-colors inline-flex items-center gap-1"
          >
            MP Digital Tech
            <Instagram size={13} />
          </a>
        </span>
      </div>
    </footer>
  );
};

export default Footer;
