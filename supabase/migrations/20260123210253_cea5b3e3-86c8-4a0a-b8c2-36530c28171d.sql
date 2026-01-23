-- Primeiro remover todos os arquivos do bucket documents
DELETE FROM storage.objects WHERE bucket_id = 'documents';

-- Depois remover o bucket
DELETE FROM storage.buckets WHERE id = 'documents';

-- Tornar a coluna storage_path opcional (não mais usada)
ALTER TABLE public.documents ALTER COLUMN storage_path DROP NOT NULL;

-- Adicionar política de DELETE que estava faltando
CREATE POLICY "Users can delete their own documents"
ON public.documents
FOR DELETE
USING (auth.uid() = user_id);