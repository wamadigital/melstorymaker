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
-- `esfriou` entra ANTES de `perdido` so por arrumacao (a ordem do enum nao e
-- usada em comparacao nenhuma). Ver lib/admin/esfriar.ts.
alter type lead_status add value if not exists 'esfriou' before 'perdido';

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
  -- "Ja chamei no WhatsApp": a Mel marca na caixa ao lado do botao, nos cartoes
  -- de "Novo", e o botao apaga enquanto o lead nao responde. E marca dela, nao
  -- prova de contato (o wa.me so abre a conversa). Null = nao marcado.
  chamado_whatsapp_em timestamptz,
  -- Qualificacao comercial manual, independente da raia. Null = nao qualificado.
  qualificado_em timestamptz,
  -- Codigo curto do link publico da proposta: melstorymaker.com.br/p/a3f9.
  -- O UUID funcionava, mas o link ficava com 36 caracteres e a Mel manda isso
  -- por WhatsApp. Nasce so quando o PDF e gerado; lead sem proposta nao tem.
  -- O unique vem do indice logo abaixo, que tambem cobre banco ja existente.
  slug text,
  -- Dados de atribuicao da Meta gravados na criacao do lead: cookies do Pixel
  -- mais navegador e ip do lead, {"fbp", "fbc", "ua", "ip"}. Os eventos do
  -- CRM saem quando a Mel move o cartao, usando os identificadores do lead, e so com isto
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
alter table leads add column if not exists chamado_whatsapp_em timestamptz;
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

-- Meta CRM: bloco identico a supabase/crm-outbox.sql -------------------------

-- CRM -> Meta. Aplicar ANTES do deploy; idempotente e sem backfill historico.
-- O mesmo bloco integra schema.sql, fonte completa de execucao manual.
-- Cada fato e sua outbox confirmam/abortam na mesma transacao do lead.

alter table public.leads add column if not exists qualificado_em timestamptz;

create table if not exists public.meta_crm_outbox (
  event_id text primary key,
  lead_id uuid not null references public.leads(id) on delete cascade,
  etapa text not null check (etapa in
    ('lead_criado', 'formulario_completo', 'enviado', 'virou_cliente', 'perdido', 'qualificado')),
  evento text not null,
  ocorrido_em timestamptz not null,
  -- Somente categoria, contato e identificadores; nao todas as respostas.
  snapshot jsonb not null,
  estado text not null default 'pendente'
    check (estado in ('pendente', 'processando', 'enviado', 'encerrado')),
  tentativas integer not null default 0 check (tentativas between 0 and 5),
  proxima_tentativa_em timestamptz not null default now(),
  lease_token uuid,
  lease_ate timestamptz,
  primeira_tentativa_em timestamptz,
  enviado_em timestamptz,
  ultimo_erro text,
  unique (lead_id, etapa)
);

alter table public.meta_crm_outbox enable row level security;
revoke all on table public.meta_crm_outbox from anon, authenticated, public;
grant select, insert, update, delete on table public.meta_crm_outbox to service_role;

create index if not exists meta_crm_outbox_pendentes_idx
  on public.meta_crm_outbox (proxima_tentativa_em, ocorrido_em)
  where estado in ('pendente', 'processando');

create or replace function public.registrar_meta_crm()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  etapas text[] := array[]::text[];
  etapa_atual text;
  nome_evento text;
  fato_em timestamptz := statement_timestamp();
begin
  if tg_op = 'INSERT' then
    etapas := array_append(etapas, 'lead_criado');
  end if;

  if tg_op = 'INSERT' or new.status is distinct from old.status then
    case new.status::text
      when 'aguardando_revisao' then
        -- Voltar para revisao nao e outra conclusao de formulario.
        if tg_op = 'UPDATE' and old.status::text = 'incompleto' then
          etapas := array_append(etapas, 'formulario_completo');
        end if;
      when 'enviado' then etapas := array_append(etapas, 'enviado');
      when 'virou_cliente' then etapas := array_append(etapas, 'virou_cliente');
      when 'perdido' then etapas := array_append(etapas, 'perdido');
      else null;
    end case;
  end if;

  if new.qualificado_em is not null and
    (tg_op = 'INSERT' or old.qualificado_em is null) then
    etapas := array_append(etapas, 'qualificado');
  end if;
  -- Desmarcar qualificacao nao e abandono: nao gera LeadPerdido.

  foreach etapa_atual in array etapas loop
    nome_evento := case etapa_atual
      when 'lead_criado' then 'CRMLeadCriado'
      when 'formulario_completo' then 'CRMFormularioCompleto'
      when 'enviado' then 'CRMPropostaEnviada'
      when 'virou_cliente' then 'CRMVirouCliente'
      when 'perdido' then 'CRMLeadPerdido'
      when 'qualificado' then 'CRMLeadQualificado'
    end;
    insert into public.meta_crm_outbox
      (event_id, lead_id, etapa, evento, ocorrido_em, snapshot)
    values (
      -- CRM tem nomes e IDs distintos do canal Site legado.
      'crm_' || etapa_atual || '_' || new.id::text,
      new.id, etapa_atual, nome_evento, fato_em,
      jsonb_build_object('categoria', new.categoria, 'email', new.email,
        'whatsapp', new.whatsapp, 'nome', new.respostas ->> 'nome', 'rastreio', new.rastreio)
    ) on conflict (lead_id, etapa) do nothing;
  end loop;
  return new;
end;
$$;

revoke execute on function public.registrar_meta_crm() from anon, authenticated, public;
grant execute on function public.registrar_meta_crm() to service_role;
drop trigger if exists leads_registrar_meta_crm on public.leads;
create trigger leads_registrar_meta_crm
  after insert or update of status, qualificado_em on public.leads
  for each row execute function public.registrar_meta_crm();

-- Uma reivindicacao atomica por chamada. O token impede ACK de worker antigo.
-- 90s de lease excedem o timeout HTTP10s e a execucao bounded do dispatcher.
-- Eventos encerram em 47h desde o fato, antes da janela de deduplicacao48h;
-- nao reenviar depois dela mesmo quando o ACK original se perdeu.
create or replace function public.reivindicar_meta_crm(p_lead_id uuid default null)
returns setof public.meta_crm_outbox
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  with expirados as (
    select o.event_id from public.meta_crm_outbox o
    where o.estado in ('pendente', 'processando')
      and (p_lead_id is null or o.lead_id = p_lead_id)
      and (o.estado = 'pendente' or o.lease_ate <= statement_timestamp())
      and (o.ocorrido_em <= statement_timestamp() - interval '47 hours' or o.tentativas >= 5)
    order by o.ocorrido_em limit 100 for update skip locked
  )
  update public.meta_crm_outbox o
    set estado = 'encerrado', lease_token = null, lease_ate = null,
      ultimo_erro = case when o.tentativas >= 5 then 'limite_tentativas' else 'prazo_expirado' end
    from expirados e where o.event_id = e.event_id;

  return query
  with candidato as (
    select o.event_id from public.meta_crm_outbox o
    where o.estado in ('pendente', 'processando')
      and (p_lead_id is null or o.lead_id = p_lead_id)
      and o.proxima_tentativa_em <= statement_timestamp()
      and (o.estado = 'pendente' or o.lease_ate <= statement_timestamp())
      and o.ocorrido_em > statement_timestamp() - interval '47 hours'
      and o.tentativas < 5
    order by o.ocorrido_em, o.event_id limit 1 for update skip locked
  )
  update public.meta_crm_outbox o
    set estado = 'processando', lease_token = gen_random_uuid(),
      lease_ate = statement_timestamp() + interval '90 seconds',
      -- Tambem protege crash/ACK de banco perdido: expirar o lease sozinho nao
      -- permite que cinco workers queimem o limite em poucos minutos.
      proxima_tentativa_em = statement_timestamp() + case o.tentativas
        when 0 then interval '15 minutes'
        when 1 then interval '1 hour'
        when 2 then interval '6 hours'
        else interval '24 hours' end,
      primeira_tentativa_em = coalesce(o.primeira_tentativa_em, statement_timestamp()),
      -- O cadastro ja grava rastreio no INSERT. Tolera enriquecimento de leads
      -- legados antes do primeiro envio; retries preservam o snapshot inteiro.
      snapshot = case when o.tentativas = 0
        then o.snapshot || jsonb_build_object('rastreio', l.rastreio)
        else o.snapshot end,
      tentativas = o.tentativas + 1
    from candidato c, public.leads l
    where o.event_id = c.event_id and l.id = o.lead_id
    returning o.*;
end;
$$;

revoke execute on function public.reivindicar_meta_crm(uuid) from anon, authenticated, public;
grant execute on function public.reivindicar_meta_crm(uuid) to service_role;
