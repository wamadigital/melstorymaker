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

-- Quadro ao vivo: bloco identico a supabase/quadro-tempo-real.sql -------------

-- Quadro ao vivo: o banco avisa o painel de que algum lead mudou. Idempotente;
-- pode ir antes ou depois do deploy (sem o SQL o quadro so nao se atualiza
-- sozinho; sem o codigo o aviso sai e ninguem ouve). O mesmo bloco integra
-- schema.sql, fonte completa de execucao manual.
--
-- CAMPAINHA, NAO ENTREGA. O aviso vai vazio (o realtime.send so acrescenta um
-- id aleatorio) e o quadro, ao ouvir, faz router.refresh(): os dados continuam
-- vindo do servidor pela service role, como sempre. Por isso `leads` segue com
-- ZERO policies -- a unica policy nova e de LEITURA em realtime.messages, e so
-- neste topico. Postgres Changes ouvindo `leads` exigiria policy em `leads` e
-- mandaria a linha inteira (respostas, contato, rastreio) pelo WebSocket.
--
-- Topico e evento espelham lib/admin/tempo-real.ts (o teste confere).

create or replace function public.avisar_quadro()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  -- realtime.send ja engole os proprios erros (vira WARNING). Este bloco cobre o
  -- que sobra, como o schema realtime mudar numa atualizacao do Supabase: aviso
  -- perdido e um refresh a menos no quadro, erro aqui derrubaria o formulario.
  begin
    perform realtime.send('{}'::jsonb, 'mudou', 'quadro-leads', true);
  exception when others then
    raise warning 'avisar_quadro: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.avisar_quadro() from anon, authenticated, public;
grant execute on function public.avisar_quadro() to service_role;

-- Por linha, e nao por statement: o trigger de statement dispara tambem quando
-- o UPDATE nao pega linha nenhuma, e o esfriarParados roda a CADA abertura do
-- quadro -- aviso, refresh, esfriar sem linha, aviso... em laco. Varias linhas
-- de uma vez (o esfriar em lote) viram varios avisos, e o quadro junta todos
-- num refresh so.
drop trigger if exists leads_avisar_quadro on public.leads;
create trigger leads_avisar_quadro
  after insert or update or delete on public.leads
  for each row execute function public.avisar_quadro();

-- Quem ouve: qualquer `authenticated`. E mais largo que o painel, que tambem
-- exige a conta no ADMIN_EMAILS (middleware): uma conta fora da lista ouviria
-- a campainha, mas ela sai vazia e o refresh que ela pede passa pelo
-- middleware. Sem policy de INSERT: ninguem do navegador publica neste
-- topico, so o banco.
drop policy if exists "painel ouve o aviso do quadro" on realtime.messages;
create policy "painel ouve o aviso do quadro"
  on realtime.messages
  for select
  to authenticated
  using (realtime.topic() = 'quadro-leads' and extension = 'broadcast');


-- WhatsApp MCP local: confirmação de recebimento (14/10/2026)
-- Confirmacao de recebimento via worker local. Aplicar manualmente antes do
-- deploy, em transacao. Nao habilita envios nem importa conclusoes historicas.
-- Nao ha trigger: o submit vencedor aguarda um INSERT auxiliar idempotente.
-- Uma falha/crash entre CAS e INSERT pode perder este aviso; nunca o formulario.

create table if not exists public.whatsapp_outbox (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads(id) on delete cascade,
  tipo text not null default 'confirmacao_recebimento'
    check (tipo = 'confirmacao_recebimento'),
  ocorrido_em timestamptz not null,
  expira_em timestamptz not null,
  destinatario text not null check (destinatario ~ '^55[0-9]{10,11}$'),
  mensagem text not null check (length(mensagem) between 1 and 2000),
  estado text not null default 'pendente' check (estado in
    ('pendente', 'reservado', 'enviando', 'enviado', 'indeterminado', 'expirado', 'cancelado')),
  tentativas integer not null default 0 check (tentativas between 0 and 5),
  proxima_tentativa_em timestamptz not null default now(),
  lease_token uuid,
  lease_ate timestamptz,
  iniciado_em timestamptz,
  enviado_em timestamptz,
  ultimo_codigo text,
  unique (lead_id, tipo),
  check (expira_em = ocorrido_em + interval '24 hours')
);

alter table public.whatsapp_outbox enable row level security;
revoke all on table public.whatsapp_outbox from anon, authenticated, public;
grant select, insert, update, delete on table public.whatsapp_outbox to service_role;
create index if not exists whatsapp_outbox_pendentes_idx
  on public.whatsapp_outbox (proxima_tentativa_em, ocorrido_em)
  where estado in ('pendente', 'reservado', 'enviando');

-- Normalizacao identica ao helper BR: tira mascara e acrescenta 55 apenas aos
-- 10/11 digitos nacionais. A validacao completa do DDD ocorre no servidor TS.
create or replace function public.registrar_confirmacao_whatsapp(
  p_lead_id uuid, p_destinatario text, p_mensagem text, p_ocorrido_em timestamptz
)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v_id uuid;
begin
  if p_ocorrido_em <= statement_timestamp() - interval '24 hours'
    or p_ocorrido_em > statement_timestamp() + interval '1 minute' then
    return null;
  end if;
  insert into public.whatsapp_outbox
    (lead_id, ocorrido_em, expira_em, destinatario, mensagem)
  select l.id, p_ocorrido_em, p_ocorrido_em + interval '24 hours', p_destinatario, p_mensagem
  from public.leads l
  where l.id = p_lead_id and l.status::text = 'aguardando_revisao'
    and p_destinatario = case
      when length(regexp_replace(l.whatsapp, '[^0-9]', '', 'g')) in (10, 11)
        then '55' || regexp_replace(l.whatsapp, '[^0-9]', '', 'g')
      else regexp_replace(l.whatsapp, '[^0-9]', '', 'g') end
  on conflict (lead_id, tipo) do nothing
  returning id into v_id;
  if v_id is null then
    select o.id into v_id from public.whatsapp_outbox o
    where o.lead_id = p_lead_id and o.tipo = 'confirmacao_recebimento';
  end if;
  return v_id;
end;
$$;
revoke execute on function public.registrar_confirmacao_whatsapp(uuid, text, text, timestamptz)
  from anon, authenticated, public;
grant execute on function public.registrar_confirmacao_whatsapp(uuid, text, text, timestamptz) to service_role;

create or replace function public.reivindicar_whatsapp()
returns setof public.whatsapp_outbox
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  -- Depois de started nao existe reenvio automatico. Preserva o token para
  -- aceitar um ACK tardio do MESMO worker, sem autorizar outra chamada WhatsApp.
  update public.whatsapp_outbox o
    set estado = 'indeterminado', ultimo_codigo = 'lease_expirado_durante_envio'
    where o.estado = 'enviando' and o.lease_ate <= statement_timestamp();

  -- So um lease que nunca entrou em enviando pode voltar a pendente.
  update public.whatsapp_outbox o
    set estado = 'pendente', lease_token = null, lease_ate = null,
      ultimo_codigo = 'lease_expirado_antes_envio'
    where o.estado = 'reservado' and o.lease_ate <= statement_timestamp();

  update public.whatsapp_outbox o
    set estado = 'cancelado', lease_token = null, lease_ate = null,
      ultimo_codigo = 'lead_ou_contato_alterado'
    from public.leads l
    where o.lead_id = l.id and o.estado in ('pendente', 'reservado')
      and (l.status::text <> 'aguardando_revisao' or o.destinatario is distinct from case
        when length(regexp_replace(l.whatsapp, '[^0-9]', '', 'g')) in (10, 11)
          then '55' || regexp_replace(l.whatsapp, '[^0-9]', '', 'g')
        else regexp_replace(l.whatsapp, '[^0-9]', '', 'g') end);

  update public.whatsapp_outbox o
    set estado = 'expirado', lease_token = null, lease_ate = null,
      ultimo_codigo = case when o.tentativas >= 5 then 'limite_tentativas' else 'prazo_expirado' end
    where o.estado in ('pendente', 'reservado')
      and (o.expira_em <= statement_timestamp() or (o.estado = 'pendente' and o.tentativas >= 5));

  return query
  with candidato as (
    select o.id from public.whatsapp_outbox o join public.leads l on l.id = o.lead_id
    where o.estado = 'pendente' and o.expira_em > statement_timestamp()
      and o.proxima_tentativa_em <= statement_timestamp() and o.tentativas < 5
      and l.status::text = 'aguardando_revisao'
      and o.destinatario = case
        when length(regexp_replace(l.whatsapp, '[^0-9]', '', 'g')) in (10, 11)
          then '55' || regexp_replace(l.whatsapp, '[^0-9]', '', 'g')
        else regexp_replace(l.whatsapp, '[^0-9]', '', 'g') end
    order by o.ocorrido_em, o.id limit 1 for update of o skip locked
  )
  update public.whatsapp_outbox o
    set estado = 'reservado', lease_token = gen_random_uuid(),
      lease_ate = statement_timestamp() + interval '90 seconds',
      proxima_tentativa_em = statement_timestamp() + interval '5 minutes',
      tentativas = o.tentativas + 1
    from candidato c where o.id = c.id returning o.*;
end;
$$;
revoke execute on function public.reivindicar_whatsapp() from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp() to service_role;

create or replace function public.resultado_whatsapp(
  p_id uuid, p_lease_token uuid, p_outcome text, p_code text default null
)
returns text
language plpgsql
security invoker
set search_path = pg_catalog
as $$
declare
  v public.whatsapp_outbox%rowtype;
  v_elegivel boolean;
begin
  select o.* into v from public.whatsapp_outbox o
    where o.id = p_id and o.lease_token = p_lease_token for update;
  if not found then return null; end if;

  if p_outcome = 'started' then
    if v.estado not in ('reservado', 'enviando') then return null; end if;
    select l.status::text = 'aguardando_revisao' and v.destinatario = case
      when length(regexp_replace(l.whatsapp, '[^0-9]', '', 'g')) in (10, 11)
        then '55' || regexp_replace(l.whatsapp, '[^0-9]', '', 'g')
      else regexp_replace(l.whatsapp, '[^0-9]', '', 'g') end
      into v_elegivel from public.leads l where l.id = v.lead_id;
    if v.lease_ate <= statement_timestamp() or v.expira_em <= statement_timestamp()
      or v_elegivel is not true then
      update public.whatsapp_outbox set
        estado = case when v.estado = 'enviando' then 'indeterminado'
          when v.expira_em <= statement_timestamp() then 'expirado' else 'cancelado' end,
        ultimo_codigo = 'started_recusado'
        where id = p_id;
      return null;
    end if;
    update public.whatsapp_outbox set estado = 'enviando',
      iniciado_em = coalesce(iniciado_em, statement_timestamp()) where id = p_id;
    return 'enviando';
  end if;

  -- O resultado real pode chegar depois de TTL/lease. Registra o fato, sem
  -- reautorizar envio. Token e estado continuam condicionando o ACK tardio.
  if p_outcome = 'sent' and v.estado in ('enviando', 'indeterminado', 'enviado') then
    update public.whatsapp_outbox set estado = 'enviado',
      enviado_em = coalesce(enviado_em, statement_timestamp()), ultimo_codigo = null where id = p_id;
    return 'enviado';
  end if;
  if p_outcome in ('indeterminate', 'failed') and v.estado in ('enviando', 'indeterminado') then
    update public.whatsapp_outbox set estado = 'indeterminado',
      ultimo_codigo = coalesce(p_code, 'resultado_indeterminado') where id = p_id;
    return 'indeterminado';
  end if;
  if p_outcome = 'failed' and v.estado = 'reservado' then
    update public.whatsapp_outbox set
      estado = case when expira_em <= statement_timestamp() or tentativas >= 5
        then 'expirado' else 'pendente' end,
      lease_token = null, lease_ate = null,
      proxima_tentativa_em = statement_timestamp() + interval '5 minutes',
      ultimo_codigo = coalesce(p_code, 'falha_antes_envio') where id = p_id;
    return case when v.expira_em <= statement_timestamp() or v.tentativas >= 5
      then 'expirado' else 'pendente' end;
  end if;
  return null;
end;
$$;
revoke execute on function public.resultado_whatsapp(uuid, uuid, text, text) from anon, authenticated, public;
grant execute on function public.resultado_whatsapp(uuid, uuid, text, text) to service_role;


-- Lembrete unico para formulario em Novo ha MAIS de 24 horas.
-- Aplicar DEPOIS de whatsapp-outbox.sql, em transacao. Nao ativa flags,
-- nao importa leads anteriores ao corte e nao altera status/carimbos do lead.
-- O mesmo bloco encerra schema.sql. RPCs V1/V2 continuam confirmacao-only.
-- V3 exige capacidade de sequencia no servidor; uma sequencia iniciada nunca
-- volta a pendente, mesmo quando a interrupcao ocorre entre suas quatro partes.

alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_tipo_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_tipo_check
  check (tipo in ('confirmacao_recebimento', 'lembrete_formulario_24h'));

alter table public.whatsapp_outbox add column if not exists sequencia jsonb;

-- Snapshot aprovado: chaves, textos, pausas e URL individual sao fechados.
-- Extracao JSON tolera entradas malformadas sem casts/erros em CHECK/RPC.
create or replace function public.sequencia_lembrete_formulario_valida(
  p_sequencia jsonb, p_lead_id uuid, p_mensagem text
)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog
as $$
declare
  v_link text := p_sequencia #>> '{3,message}';
  v_aprovadas jsonb := jsonb_build_array(
    jsonb_build_object('message', 'Olá! Aqui é a Mel Storymaker 👋', 'delayBeforeSeconds', 0),
    jsonb_build_object('message', 'Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊', 'delayBeforeSeconds', 2),
    jsonb_build_object('message', 'Suas respostas estão salvas. Para continuar de onde parou:', 'delayBeforeSeconds', 3));
begin
  return coalesce(
    v_link ~ ('^https://[^[:space:]/?#@]+/continuar/' || p_lead_id::text || '$')
    and p_sequencia = v_aprovadas || jsonb_build_array(
      jsonb_build_object('message', v_link, 'delayBeforeSeconds', 2))
    and p_mensagem = (p_sequencia #>> '{0,message}') || E'\n\n'
      || (p_sequencia #>> '{1,message}') || E'\n\n'
      || (p_sequencia #>> '{2,message}') || E'\n\n' || v_link
    and length(p_mensagem) between 1 and 2000, false);
end;
$$;
revoke execute on function public.sequencia_lembrete_formulario_valida(jsonb, uuid, text)
  from anon, authenticated, public;
grant execute on function public.sequencia_lembrete_formulario_valida(jsonb, uuid, text) to service_role;

-- Nao inventa copy para o legado nem altera fatos de envio ja iniciado/final.
-- NULL permanece aceito apenas por compatibilidade dos registros anteriores;
-- todas as RPCs recusam claim/started de lembrete sem snapshot valido.
update public.whatsapp_outbox set estado = 'cancelado',
  lease_token = null, lease_ate = null, ultimo_codigo = 'tipo_legado_nao_suportado'
  where tipo = 'lembrete_formulario_24h' and sequencia is null
    and estado in ('pendente', 'reservado');
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_sequencia_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_sequencia_check check (
  (tipo = 'confirmacao_recebimento' and sequencia is null)
  or (tipo = 'lembrete_formulario_24h' and (sequencia is null
    or public.sequencia_lembrete_formulario_valida(sequencia, lead_id, mensagem))));

-- Mesmas regras de lib/form/validacao.ts: DDD existente, fixo ou celular com 9.
create or replace function public.destinatario_whatsapp_br(p_whatsapp text)
returns text
language sql immutable strict security invoker
set search_path = pg_catalog
as $$
  with digitos as (
    select regexp_replace(p_whatsapp, '[^0-9]', '', 'g') as d
  ), nacional as (
    select case when length(d) in (12, 13) and left(d, 2) = '55'
      then substring(d from 3) else d end as n from digitos
  )
  select case when length(n) in (10, 11)
    and substring(n from 1 for 2) = any(array[
      '11','12','13','14','15','16','17','18','19','21','22','24','27','28',
      '31','32','33','34','35','37','38','41','42','43','44','45','46','47','48','49',
      '51','53','54','55','61','62','63','64','65','66','67','68','69','71','73','74',
      '75','77','79','81','82','83','84','85','86','87','88','89','91','92','93','94',
      '95','96','97','98','99'])
    and (length(n) = 10 or substring(n from 3 for 1) = '9')
    then '55' || n else null end from nacional;
$$;
revoke execute on function public.destinatario_whatsapp_br(text) from anon, authenticated, public;
grant execute on function public.destinatario_whatsapp_br(text) to service_role;

-- O backend anterior pode chamar esta assinatura ao sofrer rollback.
-- Ela nunca cria lembrete plaintext, mesmo com a flag antiga habilitada.
create or replace function public.enfileirar_lembretes_formulario_whatsapp(
  p_inicio_em timestamptz, p_mensagem_prefixo text, p_app_url text
)
returns integer
language sql security invoker
set search_path = pg_catalog
as $$ select 0; $$;
revoke execute on function public.enfileirar_lembretes_formulario_whatsapp(timestamptz, text, text)
  from anon, authenticated, public;
grant execute on function public.enfileirar_lembretes_formulario_whatsapp(timestamptz, text, text) to service_role;

create or replace function public.enfileirar_lembretes_formulario_whatsapp_v3(
  p_inicio_em timestamptz, p_mensagens jsonb, p_app_url text
)
returns integer
language plpgsql security invoker
set search_path = pg_catalog
as $$
declare
  v_agora timestamptz := statement_timestamp();
  v_base text := regexp_replace(p_app_url, '/+$', '');
  v_quantidade integer;
  v_link_teste text := v_base || '/continuar/00000000-0000-4000-8000-000000000000';
  v_teste jsonb := p_mensagens || jsonb_build_array(
    jsonb_build_object('message', v_link_teste, 'delayBeforeSeconds', 2));
  v_texto text := (p_mensagens #>> '{0,message}') || E'\n\n'
    || (p_mensagens #>> '{1,message}') || E'\n\n'
    || (p_mensagens #>> '{2,message}') || E'\n\n';
begin
  if p_inicio_em is null or not isfinite(p_inicio_em) or p_inicio_em > v_agora
    or p_app_url is null or p_app_url !~ '^https://[^[:space:]/?#@]+/*$'
    or not public.sequencia_lembrete_formulario_valida(v_teste,
      '00000000-0000-4000-8000-000000000000', v_texto || v_link_teste) then
    return 0;
  end if;

  -- Ordem de locks: lead primeiro, outbox depois, tambem no claim/started.
  -- SKIP LOCKED evita disputar com conclusao/edicao/exclusao em andamento.
  with candidatos as materialized (
    select l.id, public.destinatario_whatsapp_br(l.whatsapp) as destinatario
    from public.leads l
    where l.status::text = 'incompleto' and l.created_at >= p_inicio_em
      and l.created_at < v_agora - interval '24 hours'
      and public.destinatario_whatsapp_br(l.whatsapp) is not null
      and not exists (select 1 from public.whatsapp_outbox o
        where o.lead_id = l.id and o.tipo = 'lembrete_formulario_24h')
    order by l.created_at, l.id limit 50 for update of l skip locked
  )
  insert into public.whatsapp_outbox
    (lead_id, tipo, ocorrido_em, expira_em, destinatario, mensagem, sequencia)
  select c.id, 'lembrete_formulario_24h', v_agora, v_agora + interval '24 hours',
    c.destinatario, v_texto || v_base || '/continuar/' || c.id::text,
    p_mensagens || jsonb_build_array(jsonb_build_object('message',
      v_base || '/continuar/' || c.id::text, 'delayBeforeSeconds', 2))
  from candidatos c
  on conflict (lead_id, tipo) do nothing;
  get diagnostics v_quantidade = row_count;
  return v_quantidade;
end;
$$;
revoke execute on function public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz, jsonb, text)
  from anon, authenticated, public;
grant execute on function public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz, jsonb, text) to service_role;

create or replace function public.reivindicar_whatsapp_v3(
  p_lembrete_ativo boolean, p_inicio_em timestamptz
)
returns setof public.whatsapp_outbox
language plpgsql security invoker
set search_path = pg_catalog
as $$
declare
  v_agora timestamptz := statement_timestamp();
  v_ativo boolean := p_lembrete_ativo is true and p_inicio_em is not null
    and isfinite(p_inicio_em) and p_inicio_em <= statement_timestamp();
  v_leads uuid[];
begin
  -- Captura os pais ANTES de qualquer lock na outbox. A exclusao por FK e o
  -- preparo seguem a mesma ordem. ACK final nunca precisa bloquear um lead.
  select coalesce(array_agg(p.id), array[]::uuid[]) into v_leads from (
    select l.id from public.leads l
    where exists (select 1 from public.whatsapp_outbox o where o.lead_id = l.id
      and o.estado in ('pendente', 'reservado', 'enviando'))
    order by l.id for update of l skip locked
  ) p;

  update public.whatsapp_outbox o
    set estado = 'indeterminado', ultimo_codigo = 'lease_expirado_durante_envio'
    where o.lead_id = any(v_leads) and o.estado = 'enviando' and o.lease_ate <= v_agora;
  update public.whatsapp_outbox o
    set estado = 'pendente', lease_token = null, lease_ate = null,
      ultimo_codigo = 'lease_expirado_antes_envio'
    where o.lead_id = any(v_leads) and o.estado = 'reservado' and o.lease_ate <= v_agora;
  update public.whatsapp_outbox o
    set estado = 'cancelado', lease_token = null, lease_ate = null,
      ultimo_codigo = 'lead_ou_contato_alterado'
    from public.leads l
    where o.lead_id = l.id and l.id = any(v_leads) and o.estado in ('pendente', 'reservado')
      and (o.destinatario is distinct from public.destinatario_whatsapp_br(l.whatsapp)
        or (o.tipo = 'confirmacao_recebimento' and l.status::text <> 'aguardando_revisao')
        or (o.tipo = 'lembrete_formulario_24h' and l.status::text <> 'incompleto'));
  update public.whatsapp_outbox o
    set estado = 'expirado', lease_token = null, lease_ate = null,
      ultimo_codigo = case when o.tentativas >= 5 then 'limite_tentativas' else 'prazo_expirado' end
    where o.lead_id = any(v_leads) and o.estado in ('pendente', 'reservado')
      and (o.expira_em <= v_agora or (o.estado = 'pendente' and o.tentativas >= 5));

  return query
  with candidato as (
    select o.id from public.whatsapp_outbox o join public.leads l on l.id = o.lead_id
    where l.id = any(v_leads) and o.estado = 'pendente' and o.expira_em > v_agora
      and o.proxima_tentativa_em <= v_agora and o.tentativas < 5
      and o.destinatario = public.destinatario_whatsapp_br(l.whatsapp)
      and ((o.tipo = 'confirmacao_recebimento' and l.status::text = 'aguardando_revisao')
        or (o.tipo = 'lembrete_formulario_24h' and v_ativo
          and public.sequencia_lembrete_formulario_valida(o.sequencia, o.lead_id, o.mensagem)
          and l.status::text = 'incompleto'
          and l.created_at >= p_inicio_em and l.created_at < v_agora - interval '24 hours'))
    order by case when o.tipo = 'confirmacao_recebimento' then 0 else 1 end,
      o.ocorrido_em, o.id limit 1 for update of o skip locked
  )
  update public.whatsapp_outbox o
    set estado = 'reservado', lease_token = gen_random_uuid(),
      lease_ate = v_agora + interval '90 seconds',
      proxima_tentativa_em = v_agora + interval '5 minutes', tentativas = o.tentativas + 1
    from candidato c where o.id = c.id returning o.*;
end;
$$;
revoke execute on function public.reivindicar_whatsapp_v3(boolean, timestamptz) from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp_v3(boolean, timestamptz) to service_role;

create or replace function public.resultado_whatsapp_v3(
  p_id uuid, p_lease_token uuid, p_outcome text, p_code text,
  p_lembrete_ativo boolean, p_inicio_em timestamptz
)
returns text
language plpgsql security invoker
set search_path = pg_catalog
as $$
declare
  v public.whatsapp_outbox%rowtype;
  v_lead_id uuid;
  v_status text;
  v_whatsapp text;
  v_criado timestamptz;
  v_agora timestamptz := statement_timestamp();
  v_ativo boolean := p_lembrete_ativo is true and p_inicio_em is not null
    and isfinite(p_inicio_em) and p_inicio_em <= statement_timestamp();
  v_elegivel boolean;
begin
  if p_outcome = 'started' then
    -- Leitura sem lock apenas descobre o pai; token e estado sao relidos abaixo.
    select o.lead_id into v_lead_id from public.whatsapp_outbox o
      where o.id = p_id and o.lease_token = p_lease_token;
    if not found then return null; end if;
    select l.status::text, l.whatsapp, l.created_at into v_status, v_whatsapp, v_criado
      from public.leads l where l.id = v_lead_id for update of l;
    if not found then return null; end if;
  end if;
  select o.* into v from public.whatsapp_outbox o
    where o.id = p_id and o.lease_token = p_lease_token for update;
  if not found then return null; end if;

  if p_outcome = 'started' then
    if v.estado not in ('reservado', 'enviando') then return null; end if;
    -- Flag/corte desligados nunca autorizam lembrete, nem por RPC legado.
    if v.tipo = 'lembrete_formulario_24h' and (not v_ativo
      or not public.sequencia_lembrete_formulario_valida(v.sequencia, v.lead_id, v.mensagem)) then
      return null;
    end if;
    v_elegivel := v.destinatario = public.destinatario_whatsapp_br(v_whatsapp)
      and ((v.tipo = 'confirmacao_recebimento' and v_status = 'aguardando_revisao')
        or (v.tipo = 'lembrete_formulario_24h' and v_status = 'incompleto'
          and v_criado >= p_inicio_em and v_criado < v_agora - interval '24 hours'));
    if v.lease_ate <= v_agora or v.expira_em <= v_agora or v_elegivel is not true then
      update public.whatsapp_outbox set
        estado = case when v.estado = 'enviando' then 'indeterminado'
          when v.expira_em <= v_agora then 'expirado' else 'cancelado' end,
        ultimo_codigo = 'started_recusado' where id = p_id;
      return null;
    end if;
    update public.whatsapp_outbox set estado = 'enviando',
      iniciado_em = coalesce(iniciado_em, v_agora),
      lease_ate = case when v.tipo = 'lembrete_formulario_24h'
        then coalesce(v.iniciado_em, v_agora) + interval '180 seconds'
        else v.lease_ate end where id = p_id;
    return 'enviando';
  end if;

  -- Resultados finais continuam validos sem flags, mesmo apos TTL ou rollback.
  if p_outcome = 'sent' and v.estado in ('enviando', 'indeterminado', 'enviado') then
    update public.whatsapp_outbox set estado = 'enviado',
      enviado_em = coalesce(enviado_em, v_agora), ultimo_codigo = null where id = p_id;
    return 'enviado';
  end if;
  if p_outcome in ('indeterminate', 'failed') and v.estado in ('enviando', 'indeterminado') then
    update public.whatsapp_outbox set estado = 'indeterminado',
      ultimo_codigo = coalesce(p_code, 'resultado_indeterminado') where id = p_id;
    return 'indeterminado';
  end if;
  if p_outcome = 'failed' and v.estado = 'reservado' then
    update public.whatsapp_outbox set
      estado = case when expira_em <= v_agora or tentativas >= 5 then 'expirado' else 'pendente' end,
      lease_token = null, lease_ate = null,
      proxima_tentativa_em = v_agora + interval '5 minutes',
      ultimo_codigo = coalesce(p_code, 'falha_antes_envio') where id = p_id;
    return case when v.expira_em <= v_agora or v.tentativas >= 5 then 'expirado' else 'pendente' end;
  end if;
  return null;
end;
$$;
revoke execute on function public.resultado_whatsapp_v3(uuid, uuid, text, text, boolean, timestamptz)
  from anon, authenticated, public;
grant execute on function public.resultado_whatsapp_v3(uuid, uuid, text, text, boolean, timestamptz) to service_role;

-- V2 tambem e confirmation-only, inclusive com flag/corte verdadeiros. Isso
-- fecha o rollback para o backend que ja conhecia o lembrete plaintext.
create or replace function public.reivindicar_whatsapp_v2(
  p_lembrete_ativo boolean, p_inicio_em timestamptz
)
returns setof public.whatsapp_outbox
language sql security invoker
set search_path = pg_catalog
as $$ select * from public.reivindicar_whatsapp_v3(false, null); $$;
revoke execute on function public.reivindicar_whatsapp_v2(boolean, timestamptz) from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp_v2(boolean, timestamptz) to service_role;

create or replace function public.resultado_whatsapp_v2(
  p_id uuid, p_lease_token uuid, p_outcome text, p_code text,
  p_lembrete_ativo boolean, p_inicio_em timestamptz
)
returns text
language sql security invoker
set search_path = pg_catalog
as $$ select public.resultado_whatsapp_v3(p_id, p_lease_token, p_outcome, p_code, false, null); $$;
revoke execute on function public.resultado_whatsapp_v2(uuid, uuid, text, text, boolean, timestamptz)
  from anon, authenticated, public;
grant execute on function public.resultado_whatsapp_v2(uuid, uuid, text, text, boolean, timestamptz) to service_role;

-- Sem overload/defaults novos: backend antigo nunca reivindica/inicia lembrete.
create or replace function public.reivindicar_whatsapp()
returns setof public.whatsapp_outbox
language sql security invoker
set search_path = pg_catalog
as $$ select * from public.reivindicar_whatsapp_v3(false, null); $$;
revoke execute on function public.reivindicar_whatsapp() from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp() to service_role;

create or replace function public.resultado_whatsapp(
  p_id uuid, p_lease_token uuid, p_outcome text, p_code text default null
)
returns text
language sql security invoker
set search_path = pg_catalog
as $$ select public.resultado_whatsapp_v3(p_id, p_lease_token, p_outcome, p_code, false, null); $$;
revoke execute on function public.resultado_whatsapp(uuid, uuid, text, text) from anon, authenticated, public;
grant execute on function public.resultado_whatsapp(uuid, uuid, text, text) to service_role;


-- Historico WhatsApp ao vivo no Kanban. Aplicar DEPOIS de quadro-tempo-real.sql
-- e whatsapp-outbox.sql, em transacao. O mesmo bloco encerra schema.sql.
-- Reutiliza a campainha privada e vazia: nenhum dado da outbox/lead vai ao canal,
-- nenhuma policy muda, e uma falha do Broadcast nao desfaz o ACK do WhatsApp.
-- ACK repetido, etapas intermediarias e simples correcao de carimbo nao avisam.
drop trigger if exists whatsapp_outbox_avisar_quadro on public.whatsapp_outbox;
create trigger whatsapp_outbox_avisar_quadro
  after update of estado, enviado_em on public.whatsapp_outbox
  for each row
  when (old.estado is distinct from 'enviado'
    and new.estado = 'enviado' and new.enviado_em is not null)
  execute function public.avisar_quadro();

-- Única automação aos leads autorizada em 15/10/2026: lembrete do formulário.
-- Aplicar manualmente, em transação, depois de whatsapp-lembrete-formulario.sql.
-- Não ativa flags, não envia mensagens e preserva o histórico já finalizado.

-- Clientes antigos deixam de conseguir criar confirmações, mesmo após rollback.
create or replace function public.registrar_confirmacao_whatsapp(
  p_lead_id uuid, p_destinatario text, p_mensagem text, p_ocorrido_em timestamptz
)
returns uuid language sql security invoker set search_path = pg_catalog
as $$ select null::uuid; $$;
revoke execute on function public.registrar_confirmacao_whatsapp(uuid, text, text, timestamptz)
  from anon, authenticated, public;
grant execute on function public.registrar_confirmacao_whatsapp(uuid, text, text, timestamptz)
  to service_role;

update public.whatsapp_outbox set estado = 'cancelado',
  lease_token = null, lease_ate = null, ultimo_codigo = 'tipo_nao_autorizado'
  where tipo <> 'lembrete_formulario_24h' and estado in ('pendente', 'reservado');

-- Nenhum outro tipo pode entrar ou voltar ao circuito de envio. Registros
-- históricos enviados/indeterminados/cancelados/expirados continuam válidos.
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_somente_lembrete_ativo;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_somente_lembrete_ativo
  check (tipo = 'lembrete_formulario_24h'
    or estado not in ('pendente', 'reservado', 'enviando'));
