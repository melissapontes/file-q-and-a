-- Enable pgvector extension
create extension if not exists vector;

-- Create document_chunks table for RAG
create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid references public.documents(id) on delete cascade not null,
  chunk_text text not null,
  chunk_index integer not null,
  embedding vector(1536), -- OpenAI ada-002 embedding dimension
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

-- Create index for similarity search
create index if not exists document_chunks_embedding_idx 
  on public.document_chunks 
  using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

-- Create index for document_id lookups
create index if not exists document_chunks_document_id_idx 
  on public.document_chunks(document_id);

-- Enable RLS
alter table public.document_chunks enable row level security;

-- RLS Policies
create policy "Users can view their own document chunks"
  on public.document_chunks for select
  using (
    exists (
      select 1 from public.documents
      where documents.id = document_chunks.document_id
      and documents.user_id = auth.uid()
    )
  );

create policy "Users can insert their own document chunks"
  on public.document_chunks for insert
  with check (
    exists (
      select 1 from public.documents
      where documents.id = document_chunks.document_id
      and documents.user_id = auth.uid()
    )
  );

create policy "Users can delete their own document chunks"
  on public.document_chunks for delete
  using (
    exists (
      select 1 from public.documents
      where documents.id = document_chunks.document_id
      and documents.user_id = auth.uid()
    )
  );

-- Function to search similar chunks
create or replace function search_document_chunks(
  query_embedding vector(1536),
  match_threshold float default 0.7,
  match_count int default 5,
  filter_document_ids uuid[] default null,
  filter_tags text[] default null
)
returns table (
  chunk_id uuid,
  document_id uuid,
  document_name text,
  document_tags text[],
  chunk_text text,
  chunk_index integer,
  similarity float
)
language plpgsql
as $$
begin
  return query
  select
    dc.id as chunk_id,
    dc.document_id,
    d.original_name as document_name,
    d.tags as document_tags,
    dc.chunk_text,
    dc.chunk_index,
    1 - (dc.embedding <=> query_embedding) as similarity
  from document_chunks dc
  inner join documents d on d.id = dc.document_id
  where
    (filter_document_ids is null or dc.document_id = any(filter_document_ids))
    and (filter_tags is null or d.tags && filter_tags)
    and (1 - (dc.embedding <=> query_embedding)) > match_threshold
  order by dc.embedding <=> query_embedding
  limit match_count;
end;
$$;

-- Comment
comment on table public.document_chunks is 'Stores document chunks with embeddings for RAG retrieval';
comment on function search_document_chunks is 'Semantic search for document chunks with optional tag and document filtering';
