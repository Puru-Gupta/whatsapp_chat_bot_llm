-- ============================================================
-- AQLI WhatsApp Chatbot - Supabase Schema
-- Run this in your Supabase SQL editor
-- ============================================================

-- Enable pgvector extension
create extension if not exists vector;

-- ============================================================
-- conversations
-- ============================================================
create table if not exists conversations (
  id uuid default gen_random_uuid() primary key,
  phone text unique not null,
  name text,
  mode text not null default 'agent' check (mode in ('agent', 'human')),
  last_message text,
  unread_count integer default 0,
  updated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- ============================================================
-- messages
-- ============================================================
create table if not exists messages (
  id uuid default gen_random_uuid() primary key,
  conversation_id uuid references conversations(id) on delete cascade not null,
  role text not null check (role in ('user', 'assistant', 'human', 'system')),
  content text not null,
  whatsapp_msg_id text unique,
  source text default 'whatsapp',
  created_at timestamp with time zone default now()
);

create index if not exists idx_messages_conversation on messages(conversation_id);
create index if not exists idx_messages_created_at on messages(created_at desc);

-- ============================================================
-- knowledge_sources
-- ============================================================
create table if not exists knowledge_sources (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  source_type text not null check (source_type in ('pdf', 'doc', 'txt', 'manual', 'website', 'faq')),
  source_url text,
  file_path text,
  chunk_count integer default 0,
  status text not null default 'active' check (status in ('active', 'inactive', 'processing', 'error')),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- ============================================================
-- knowledge_chunks
-- ============================================================
create table if not exists knowledge_chunks (
  id uuid default gen_random_uuid() primary key,
  source_id uuid references knowledge_sources(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  metadata jsonb default '{}'::jsonb,
  embedding vector(384),
  created_at timestamp with time zone default now()
);

create index if not exists idx_knowledge_chunks_source on knowledge_chunks(source_id);

-- HNSW index for fast vector similarity search
create index if not exists idx_knowledge_chunks_embedding
  on knowledge_chunks using hnsw (embedding vector_cosine_ops);

-- ============================================================
-- Vector search RPC function
-- ============================================================
create or replace function match_knowledge_chunks (
  query_embedding vector(384),
  match_count int default 5,
  similarity_threshold float default 0.5
)
returns table (
  id uuid,
  source_id uuid,
  content text,
  metadata jsonb,
  similarity float
)
language sql stable
as $$
  select
    kc.id,
    kc.source_id,
    kc.content,
    kc.metadata,
    1 - (kc.embedding <=> query_embedding) as similarity
  from knowledge_chunks kc
  inner join knowledge_sources ks on ks.id = kc.source_id
  where ks.status = 'active'
    and (1 - (kc.embedding <=> query_embedding)) >= similarity_threshold
  order by kc.embedding <=> query_embedding
  limit match_count;
$$;

-- ============================================================
-- Row Level Security (RLS)
-- Enable RLS and allow service role full access
-- ============================================================
alter table conversations enable row level security;
alter table messages enable row level security;
alter table knowledge_sources enable row level security;
alter table knowledge_chunks enable row level security;

-- Service role bypass (used server-side)
drop policy if exists "service_role_all_conversations" on conversations;
create policy "service_role_all_conversations" on conversations
  for all using (auth.role() = 'service_role');

drop policy if exists "service_role_all_messages" on messages;
create policy "service_role_all_messages" on messages
  for all using (auth.role() = 'service_role');

drop policy if exists "service_role_all_knowledge_sources" on knowledge_sources;
create policy "service_role_all_knowledge_sources" on knowledge_sources
  for all using (auth.role() = 'service_role');

drop policy if exists "service_role_all_knowledge_chunks" on knowledge_chunks;
create policy "service_role_all_knowledge_chunks" on knowledge_chunks
  for all using (auth.role() = 'service_role');

-- ============================================================
-- Auto-update updated_at trigger
-- ============================================================
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists conversations_updated_at on conversations;
create trigger conversations_updated_at
  before update on conversations
  for each row execute function update_updated_at();

drop trigger if exists knowledge_sources_updated_at on knowledge_sources;
create trigger knowledge_sources_updated_at
  before update on knowledge_sources
  for each row execute function update_updated_at();
