-- Ver todos os documentos no sistema
SELECT 
  id,
  original_name,
  openai_file_id,
  tags,
  processing_status,
  created_at
FROM documents
ORDER BY created_at DESC;

-- Contar documentos por status
SELECT 
  processing_status,
  COUNT(*) as total
FROM documents
GROUP BY processing_status;

-- Ver documentos prontos para busca
SELECT 
  original_name,
  openai_file_id,
  tags
FROM documents
WHERE processing_status = 'completed'
  AND openai_file_id IS NOT NULL
ORDER BY original_name;
