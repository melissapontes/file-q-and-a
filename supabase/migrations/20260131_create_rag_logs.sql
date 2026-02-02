-- Create RAG Query Logs table
CREATE TABLE IF NOT EXISTS rag_query_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  question TEXT NOT NULL,
  documents_fetched INTEGER,
  documents_analyzed JSONB,
  final_selection JSONB,
  answer_preview TEXT,
  processing_time_ms INTEGER,
  status TEXT DEFAULT 'success'
);

-- Create index for faster queries
CREATE INDEX idx_rag_logs_created_at ON rag_query_logs(created_at DESC);
CREATE INDEX idx_rag_logs_status ON rag_query_logs(status);
