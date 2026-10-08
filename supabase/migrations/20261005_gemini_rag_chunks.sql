-- RAG próprio (Gemini + pgvector): substitui o vector store da OpenAI.

-- Funciona com o pgvector instalado em 'extensions' ou em 'public'.
set search_path = public, extensions;

create extension if not exists vector with schema extensions;

-- Espécie do documento (cat | dog | both), calculada na ingestão
alter table public.documents add column if not exists species text not null default 'both';
alter table public.documents add column if not exists chunk_count integer not null default 0;

create table if not exists public.rag_chunks (
  id          bigint generated always as identity primary key,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  page_start  integer,
  page_end    integer,
  content     text not null,
  species     text not null default 'both',
  embedding   vector(768) not null,
  fts         tsvector generated always as (to_tsvector('simple', content)) stored,
  created_at  timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create index if not exists rag_chunks_embedding_idx
  on public.rag_chunks using hnsw (embedding vector_cosine_ops);
create index if not exists rag_chunks_fts_idx
  on public.rag_chunks using gin (fts);
create index if not exists rag_chunks_document_idx
  on public.rag_chunks (document_id);

-- Só as Edge Functions (service role) acessam os trechos; o navegador não.
alter table public.rag_chunks enable row level security;

-- query_text: expressão tsquery já sanitizada pelo código, ex: 'citrato | potassio | gatos'.
-- Busca híbrida (vetor + texto) com filtro de espécie, combinada por Reciprocal Rank Fusion.
-- p_species: 'cat' | 'dog' | null. Documentos 'both' entram sempre.
create or replace function public.match_chunks(
  query_embedding vector(768),
  query_text      text,
  p_species       text default null,
  match_count     integer default 8
)
returns table (
  id bigint,
  document_id uuid,
  original_name text,
  page_start integer,
  page_end integer,
  content text,
  score double precision
)
language sql stable
set search_path = public, extensions
as $$
  with candidates as (
    select c.id, c.document_id, c.page_start, c.page_end, c.content,
           c.embedding, c.fts
    from public.rag_chunks c
    where p_species is null or c.species in (p_species, 'both')
  ),
  semantic as (
    select id, row_number() over (order by embedding <=> query_embedding) as rnk
    from candidates
    order by embedding <=> query_embedding
    limit 30
  ),
  lexical as (
    select id, row_number() over (order by ts_rank_cd(fts, q) desc) as rnk
    from candidates, to_tsquery('simple', query_text) q
    where fts @@ q
    order by ts_rank_cd(fts, q) desc
    limit 30
  ),
  fused as (
    select coalesce(s.id, l.id) as id,
           coalesce(1.0 / (60 + s.rnk), 0) + coalesce(1.0 / (60 + l.rnk), 0) as score
    from semantic s full outer join lexical l on s.id = l.id
  )
  select c.id, c.document_id, d.original_name, c.page_start, c.page_end, c.content, f.score
  from fused f
  join candidates c on c.id = f.id
  join public.documents d on d.id = c.document_id
  order by f.score desc
  limit match_count;
$$;

revoke all on function public.match_chunks from public, anon, authenticated;
grant execute on function public.match_chunks to service_role;
