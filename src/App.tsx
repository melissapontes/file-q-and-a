import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "./hooks/useAuth";
import { ThemeProvider } from "./hooks/useTheme";
import Navigation from "./components/Navigation";
import Footer from "./components/Footer";
import Index from "./pages/Index";
import Upload from "./pages/Upload";
import Auth from "./pages/Auth";
import Documents from "./pages/Documents";
import Debug from "./pages/Debug";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const AdminRoute = ({ element }: { element: JSX.Element }) => {
  const { isAdmin, loading } = useAuth();
  if (loading) return null;
  return isAdmin ? element : <Navigate to="/" replace />;
};

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <AuthProvider>
          <TooltipProvider>
            <Toaster />
          <Sonner />
          <BrowserRouter>
            <div className="min-h-screen bg-background flex flex-col">
              <Navigation />
              <main className="flex-1">
                <Routes>
                  <Route path="/" element={<Index />} />
                  <Route path="/upload" element={<AdminRoute element={<Upload />} />} />
                  <Route path="/documents" element={<AdminRoute element={<Documents />} />} />
                  <Route path="/debug" element={<AdminRoute element={<Debug />} />} />
                  <Route path="/ask" element={<Navigate to="/" replace />} />
                  <Route path="/auth" element={<Auth />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </main>
                <Footer />
              </div>
            </BrowserRouter>
          </TooltipProvider>
        </AuthProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
};

export default App;
