-- Add tags column to documents table
ALTER TABLE public.documents 
ADD COLUMN tags text[] DEFAULT '{}';

-- Add index for faster tag searches
CREATE INDEX idx_documents_tags ON public.documents USING GIN(tags);

-- Add comment for documentation
COMMENT ON COLUMN public.documents.tags IS 'Array of tags/categories for document classification and precise search';