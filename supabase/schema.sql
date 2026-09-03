-- Schema completo | Sistema de Propostas Mel Simao Storymaker
--
-- Aplicar MANUALMENTE no SQL Editor do Supabase. Este MVP nao usa migrations
-- automaticas. O arquivo e idempotente: pode rodar de novo sem quebrar.

-- Enums -------------------------------------------------------------------

do $$ begin
  create type lead_categoria as enum ('debutante', 'aniversario', 'casamento', 'corporativo');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type lead_status as enum
    ('incompleto', 'aguardando_revisao', 'enviado', 'virou_cliente');
exception when duplicate_object then null;
end $$;

-- O bloco acima e no-op num banco que ja tem o tipo: `duplicate_object` engole a
-- criacao inteira, inclusive o valor novo. Todo valor acrescentado ao enum
-- precisa TAMBEM aparecer aqui embaixo -- mesma regra das colunas (l.44) e mesma
-- armadilha que aconteceu com `slug`.
--
-- `add value` nao aceita plpgsql (por isso nao vai dentro de um `do $$`) e o
-- valor novo nao pode ser USADO na mesma transacao. Por isso este arquivo nao
-- tem nenhum `default 'virou_cliente'`. Ao rodar a mao no SQL Editor, execute
-- esta linha isolada ANTES do arquivo inteiro.
alter type lead_status add value if not exists 'virou_cliente';
alter type lead_status add value if not exists 'perdido';

-- Tabela ------------------------------------------------------------------

create table if not exists leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  categoria lead_categoria not null,
  status lead_status not null default 'incompleto',
  respostas jsonb not null default '{}'::jsonb,
  passo_atual text,
  -- Colunas promovidas: preenchidas no autosave junto com o jsonb para a lista
  -- do admin ser rapida sem parse de jsonb.
  nome_display text,
  data_evento date,
  email text,
  whatsapp text,
  pdf_url text,
  pdf_gerado_em timestamptz,
  enviado_em timestamptz,
  -- Cobranca de quem recebeu a proposta e sumiu. O relogio conta a partir de
  -- `enviado_em`; estas duas colunas guardam QUANDO a Mel mandou cada lembrete,
  -- e e a presenca delas que faz o cartao parar de gritar no quadro.
  lembrete_7_em timestamptz,
  lembrete_30_em timestamptz,
  -- Codigo curto do link publico da proposta: melstorymaker.com.br/p/a3f9.
  -- O UUID funcionava, mas o link ficava com 36 caracteres e a Mel manda isso
  -- por WhatsApp. Nasce so quando o PDF e gerado; lead sem proposta nao tem.
  -- O unique vem do indice logo abaixo, que tambem cobre banco ja existente.
  slug text
);

-- `create table if not exists` acima NAO acrescenta coluna a uma tabela que ja
-- existe: o bloco inteiro vira no-op. Como o runbook e rodar este arquivo a mao
-- no SQL Editor, toda coluna nova precisa TAMBEM aparecer aqui embaixo, senao o
-- schema do repo deixa de reproduzir o de producao -- e foi exatamente o que
-- aconteceu com `slug`, aplicada por migration fora do arquivo.
alter table leads add column if not exists slug text;
alter table leads add column if not exists lembrete_7_em timestamptz;
alter table leads add column if not exists lembrete_30_em timestamptz;

create unique index if not exists leads_slug_key on leads (slug);
create index if not exists leads_status_idx on leads (status);
create index if not exists leads_created_idx on leads (created_at desc);
create index if not exists leads_slug_idx on leads (slug) where slug is not null;

-- updated_at ---------------------------------------------------------------

-- `set search_path` fixo nao e detalhe: sem ele, quem conseguir criar um objeto
-- num schema que venha antes no search_path sequestra a resolucao de now()
-- dentro do trigger. O linter do Supabase acusa isso como
-- function_search_path_mutable.
create or replace function set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Funcao de trigger nao precisa ser chamavel via /rest/v1/rpc. O Supabase
-- concede execute para anon e authenticated por padrao em tudo que esta em
-- public; aqui isso so aumenta superficie sem servir para nada.
revoke execute on function set_updated_at() from anon, authenticated, public;

drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at
  before update on leads
  for each row
  execute function set_updated_at();

-- Seguranca ----------------------------------------------------------------
--
-- RLS ligado e ZERO policies, de proposito. O formulario publico nunca fala
-- direto com o Supabase: todo acesso passa por route handlers do Next usando a
-- service role key (que atravessa RLS). Se um acesso falhar por RLS, a correcao
-- e no route handler -- nunca criar policy publica nesta tabela.

alter table leads enable row level security;

-- Storage ------------------------------------------------------------------
--
-- Bucket publico: o link do PDF vai por WhatsApp e precisa abrir sem sessao.
-- Com public = true a leitura via /object/public/... dispensa policy; a escrita
-- acontece so pela service role, que ja atravessa RLS.

insert into storage.buckets (id, name, public)
values ('propostas', 'propostas', true)
on conflict (id) do update set public = true;
