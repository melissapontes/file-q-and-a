-- ⚠️ SCRIPT DE LIMPEZA DO BANCO - Use com cuidado!
-- Este script remove TODOS os documentos e chunks existentes
-- Execute este script no SQL Editor do Supabase Dashboard

-- =============================================================================
-- PASSO 1: BACKUP (OPCIONAL - Execute antes de deletar)
-- =============================================================================

-- Exportar lista de documentos para referência futura
-- COPIE o resultado desta query antes de continuar
SELECT 
  id,
  user_id,
  original_name,
  tags,
  created_at,
  openai_file_id
FROM documents
ORDER BY created_at DESC;

-- =============================================================================
-- PASSO 2: LIMPEZA SEGURA
-- =============================================================================

-- 2.1 - Deletar todos os chunks (se a tabela existir)
-- Esta operação é segura pois document_chunks tem cascade delete
DO $$ 
BEGIN
  IF EXISTS (
    SELECT FROM information_schema.tables 
    WHERE table_schema = 'public' 
    AND table_name = 'document_chunks'
  ) THEN
    DELETE FROM document_chunks;
    RAISE NOTICE 'document_chunks limpo com sucesso';
  ELSE
    RAISE NOTICE 'Tabela document_chunks não existe ainda';
  END IF;
END $$;

-- 2.2 - Deletar todos os documentos
-- ATENÇÃO: Isso remove TODOS os documentos de TODOS os usuários
DELETE FROM documents;

-- =============================================================================
-- PASSO 3: VERIFICAÇÃO
-- =============================================================================

-- Verificar quantos registros restam
SELECT 
  'documents' as tabela,
  COUNT(*) as registros
FROM documents
UNION ALL
SELECT 
  'document_chunks' as tabela,
  COALESCE((SELECT COUNT(*) FROM document_chunks), 0) as registros;

-- =============================================================================
-- RESULTADO ESPERADO:
-- =============================================================================
-- tabela          | registros
-- ----------------+-----------
-- documents       | 0
-- document_chunks | 0
--
-- Se você vir 0 em ambos, a limpeza foi bem-sucedida! ✅
-- =============================================================================

-- =============================================================================
-- PRÓXIMOS PASSOS APÓS LIMPEZA:
-- =============================================================================
-- 1. Aplicar a migration: 20260202_create_document_chunks.sql
-- 2. Fazer upload dos PDFs novamente via interface
-- 3. Sistema pgvector processará automaticamente cada upload
-- 4. Testar perguntas e verificar qualidade das respostas
-- =============================================================================
