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
  -- Lembrete por e-mail de quem parou no formulario (coluna "Novo"): QUANDO a
  -- Mel mandou o ultimo. O botao trava por 7 dias a partir daqui, e a rota de
  -- envio confere a mesma trava -- ver lib/admin/lembrete-email.ts.
  lembrete_email_em timestamptz,
  -- Codigo curto do link publico da proposta: melstorymaker.com.br/p/a3f9.
  -- O UUID funcionava, mas o link ficava com 36 caracteres e a Mel manda isso
  -- por WhatsApp. Nasce so quando o PDF e gerado; lead sem proposta nao tem.
  -- O unique vem do indice logo abaixo, que tambem cobre banco ja existente.
  slug text,
  -- Dados de atribuicao da Meta gravados na criacao do lead: cookies do Pixel
  -- mais navegador e ip do lead, {"fbp", "fbc", "ua", "ip"}. Os eventos do
  -- quadro saem quando a Mel move o cartao, como evento de site, e so com isto
  -- a conversao volta ao anuncio que trouxe o lead. jsonb pelo mesmo motivo de
  -- `respostas`: outro identificador no futuro nao vira migration.
  rastreio jsonb
);

-- `create table if not exists` acima NAO acrescenta coluna a uma tabela que ja
-- existe: o bloco inteiro vira no-op. Como o runbook e rodar este arquivo a mao
-- no SQL Editor, toda coluna nova precisa TAMBEM aparecer aqui embaixo, senao o
-- schema do repo deixa de reproduzir o de producao -- e foi exatamente o que
-- aconteceu com `slug`, aplicada por migration fora do arquivo.
alter table leads add column if not exists slug text;
alter table leads add column if not exists lembrete_7_em timestamptz;
alter table leads add column if not exists lembrete_30_em timestamptz;
alter table leads add column if not exists lembrete_email_em timestamptz;
alter table leads add column if not exists rastreio jsonb;

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

-- Contratos ----------------------------------------------------------------
--
-- Contrato de prestacao de servicos com o CLIENTE (a Mel e a CONTRATADA).
-- Uma linha por lead: o contrato nasce do lead e morre com ele (`on delete
-- cascade`). Os arquivos no bucket NAO caem pelo cascade -- a rota de exclusao
-- do lead apaga a pasta `{lead_id}/` do bucket ANTES de apagar a linha.
--
-- E PII (CPF, endereco, e-mail de quem assina): tabela com RLS e zero
-- policies, bucket PRIVADO, e o PDF so sai pela rota admin autenticada.
--
-- `dados` (o que a Mel preencheu), `documento` (o texto montado) e `avisos`
-- sao jsonb pelo mesmo motivo de `leads.respostas`: mudar o formulario do
-- contrato ou acrescentar uma clausula ao modelo nao vira migration.
--
-- Colunas INTERNAS (nunca vao para o navegador; o select do painel e
-- explicito, em lib/supabase/contratos.ts): pdf_path, posicoes_assinatura,
-- assinatura_token, assinado_path, trilha_path.

create table if not exists contratos (
  lead_id uuid primary key references leads(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- rascunho > redigido > pdf_gerado > enviado > assinado (ver o check abaixo).
  -- Em `enviado` e `assinado` o texto esta TRAVADO.
  status text not null default 'rascunho',
  dados jsonb not null default '{}'::jsonb,
  documento jsonb,
  avisos jsonb not null default '[]'::jsonb,
  redigido_em timestamptz,
  revisado_em timestamptz,
  pdf_path text,
  pdf_sha256 text,
  pdf_gerado_em timestamptz,
  -- Onde o campo de assinatura de cada parte vai no PDF (pt, origem no topo).
  -- Sai da mesma renderizacao que gravou o PDF: um nao existe sem o outro.
  posicoes_assinatura jsonb,
  assinatura_provedor text,
  assinatura_token text,
  assinatura_status text,
  assinatura_signatarios jsonb,
  assinatura_enviada_em timestamptz,
  assinatura_atualizada_em timestamptz,
  assinado_em timestamptz,
  -- O PDF assinado e a trilha de auditoria sao IMUTAVEIS: gravados uma vez,
  -- num caminho proprio de cada envio, e nunca sobrescritos.
  assinado_path text,
  trilha_path text
);

-- Mesma regra da tabela leads: `create table if not exists` nao acrescenta
-- coluna a tabela que ja existe. Toda coluna tambem aqui embaixo. (`lead_id`
-- fica de fora: nasce com a tabela, e `add column if not exists ... primary
-- key` ja criou indice duplicado em versao antiga do Postgres.)
alter table contratos add column if not exists created_at timestamptz not null default now();
alter table contratos add column if not exists updated_at timestamptz not null default now();
alter table contratos add column if not exists status text not null default 'rascunho';
alter table contratos add column if not exists dados jsonb not null default '{}'::jsonb;
alter table contratos add column if not exists documento jsonb;
alter table contratos add column if not exists avisos jsonb not null default '[]'::jsonb;
alter table contratos add column if not exists redigido_em timestamptz;
alter table contratos add column if not exists revisado_em timestamptz;
alter table contratos add column if not exists pdf_path text;
alter table contratos add column if not exists pdf_sha256 text;
alter table contratos add column if not exists pdf_gerado_em timestamptz;
alter table contratos add column if not exists posicoes_assinatura jsonb;
alter table contratos add column if not exists assinatura_provedor text;
alter table contratos add column if not exists assinatura_token text;
alter table contratos add column if not exists assinatura_status text;
alter table contratos add column if not exists assinatura_signatarios jsonb;
alter table contratos add column if not exists assinatura_enviada_em timestamptz;
alter table contratos add column if not exists assinatura_atualizada_em timestamptz;
alter table contratos add column if not exists assinado_em timestamptz;
alter table contratos add column if not exists assinado_path text;
alter table contratos add column if not exists trilha_path text;

-- Status como text + check, e nao enum: valor novo e `drop` + `add` aqui, sem
-- a danca do `alter type ... add value` fora de transacao que o lead_status
-- exige. Os valores espelham STATUS_CONTRATO e STATUS_ASSINATURA
-- (lib/contrato/tipos.ts) -- mudou la, muda aqui.
alter table contratos drop constraint if exists contratos_status_check;
alter table contratos add constraint contratos_status_check
  check (status in ('rascunho', 'redigido', 'pdf_gerado', 'enviado', 'assinado'));

alter table contratos drop constraint if exists contratos_assinatura_status_check;
alter table contratos add constraint contratos_assinatura_status_check
  check (
    assinatura_status is null
    or assinatura_status in ('enviado', 'concluido', 'recusado', 'expirado', 'cancelado')
  );

drop trigger if exists contratos_set_updated_at on contratos;
create trigger contratos_set_updated_at
  before update on contratos
  for each row
  execute function set_updated_at();

-- RLS ligado e ZERO policies, como em leads: todo acesso passa pelas rotas do
-- painel com a service role. O revoke e uma segunda porta: mesmo que alguem
-- crie uma policy por engano, anon e authenticated nao tem privilegio na
-- tabela. (A service role tem os proprios grants e atravessa o RLS.)
alter table contratos enable row level security;
revoke all on table contratos from anon, authenticated;

-- Bucket PRIVADO: sem URL publica. O PDF sai so por
-- /api/admin/leads/[id]/contrato/arquivo, com sessao e `Cache-Control:
-- no-store`. So PDF e ate 10 MB: um contrato de 6 paginas tem ~30 kB, e a
-- trava impede que o bucket vire deposito de outra coisa.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('contratos', 'contratos', false, 10485760, array['application/pdf'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
