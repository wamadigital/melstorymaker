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

-- Revalidar a CHECK depois de trocar a funcao; historico terminal fica intacto.
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_sequencia_check;

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
    jsonb_build_object('message', 'Suas respostas estão salvas, acesse o link:', 'delayBeforeSeconds', 3));
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

-- Snapshots antigos nao voltam ao circuito de envio. Nao reescrever texto,
-- sequencia ou carimbos historicos. Um envio antigo iniciado fica indeterminado
-- com o MESMO token, para aceitar apenas o ACK tardio, sem continuar a sequencia.
update public.whatsapp_outbox set estado = 'cancelado',
  lease_token = null, lease_ate = null, ultimo_codigo = 'copy_lembrete_substituida'
  where tipo = 'lembrete_formulario_24h' and estado in ('pendente', 'reservado')
    and not public.sequencia_lembrete_formulario_valida(sequencia, lead_id, mensagem);
update public.whatsapp_outbox set estado = 'indeterminado',
  ultimo_codigo = 'copy_lembrete_substituida'
  where tipo = 'lembrete_formulario_24h' and estado = 'enviando'
    and not public.sequencia_lembrete_formulario_valida(sequencia, lead_id, mensagem);
-- Somente a copy atual e aceita em qualquer estado ativo. A excecao e apenas
-- historica/terminal: nao torna a copy antiga valida para INSERT/claim/started.
alter table public.whatsapp_outbox add constraint whatsapp_outbox_sequencia_check check (
  (tipo = 'confirmacao_recebimento' and sequencia is null)
  or (tipo = 'lembrete_formulario_24h' and (
    estado not in ('pendente', 'reservado', 'enviando')
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
  on conflict (lead_id, tipo) where tipo in ('confirmacao_recebimento', 'lembrete_formulario_24h') do nothing;
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
-- ACK repetido, heartbeat entre partes e simples correcao de carimbo nao avisam.
-- Propostas tambem avisam mudancas de estado para a UI encerrar fila/bloqueios.
drop trigger if exists whatsapp_outbox_avisar_quadro on public.whatsapp_outbox;
create trigger whatsapp_outbox_avisar_quadro
  after update of estado, enviado_em on public.whatsapp_outbox
  for each row
  when ((old.estado is distinct from 'enviado'
    and new.estado = 'enviado' and new.enviado_em is not null)
    or (new.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
      and old.estado is distinct from new.estado))
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


-- Lembretes da proposta SOMENTE por clique autenticado da Mel.
-- Aplicar manualmente depois de whatsapp-lembrete-copy.sql. Nao ativa flags,
-- nao consulta conversas, nao envia mensagens e nao enfileira por cron/lote.
begin;
lock table public.whatsapp_outbox in share row exclusive mode;

alter table public.whatsapp_outbox add column if not exists proposta_enviado_em timestamptz;
alter table public.whatsapp_outbox add column if not exists proposta_pdf_url text;
alter table public.whatsapp_outbox add column if not exists solicitado_em timestamptz;
alter table public.whatsapp_outbox add column if not exists solicitado_por uuid;
alter table public.whatsapp_outbox add column if not exists historico_verificado_em timestamptz;
alter table public.whatsapp_outbox add column if not exists historico_cobertura_inicio_em timestamptz;
alter table public.whatsapp_outbox add column if not exists ultima_interacao_em timestamptz;

alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_tipo_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_tipo_check check (tipo in (
  'confirmacao_recebimento','lembrete_formulario_24h','lembrete_proposta_7d','lembrete_proposta_30d'));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_somente_lembrete_ativo;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_somente_lembrete_ativo check (
  tipo in ('lembrete_formulario_24h','lembrete_proposta_7d','lembrete_proposta_30d')
  or estado not in ('pendente','reservado','enviando'));

-- Quatro/cinco partes fechadas; o link e o snapshot HTTPS da proposta atual.
create or replace function public.sequencia_lembrete_proposta(
  p_tipo text, p_pdf_url text
)
returns jsonb language sql immutable security invoker set search_path = pg_catalog
as $$
  select case when p_pdf_url ~ '^https://[^[:space:]/?#@]+(/[^[:space:]?#@]*)?$'
    and strpos(p_pdf_url,chr(92))=0 then
    case p_tipo
      when 'lembrete_proposta_7d' then jsonb_build_array(
        jsonb_build_object('message','Olá, como vai?!','delayBeforeSeconds',0),
        jsonb_build_object('message','Passando só para saber se você conseguiu dar uma olhadinha na proposta que te enviei.','delayBeforeSeconds',2),
        jsonb_build_object('message',p_pdf_url,'delayBeforeSeconds',3),
        jsonb_build_object('message','Se ficou alguma dúvida, me chama que eu te explico. ✨','delayBeforeSeconds',2))
      when 'lembrete_proposta_30d' then jsonb_build_array(
        jsonb_build_object('message','Oi! Passando só para saber se você conseguiu dar uma olhadinha na proposta que te enviei. 🤍','delayBeforeSeconds',0),
        jsonb_build_object('message',p_pdf_url,'delayBeforeSeconds',4),
        jsonb_build_object('message','Se ainda fizer sentido, é só me chamar que a gente conversa.','delayBeforeSeconds',4),
        jsonb_build_object('message','Se não for o momento, me avise por gentileza, para que eu possa me organizar por aqui 🙏','delayBeforeSeconds',3),
        jsonb_build_object('message','Desde já, agradeço ✨','delayBeforeSeconds',5))
    end
  end;
$$;
revoke execute on function public.sequencia_lembrete_proposta(text,text) from anon, authenticated, public;
grant execute on function public.sequencia_lembrete_proposta(text,text) to service_role;

create or replace function public.sequencia_lembrete_proposta_valida(
  p_sequencia jsonb, p_tipo text, p_pdf_url text, p_mensagem text
)
returns boolean language sql immutable security invoker set search_path = pg_catalog
as $$
  select coalesce(p_sequencia=public.sequencia_lembrete_proposta(p_tipo,p_pdf_url)
    and p_mensagem=(select string_agg(p.value->>'message',E'\n\n' order by p.n)
      from jsonb_array_elements(public.sequencia_lembrete_proposta(p_tipo,p_pdf_url)) with ordinality p(value,n))
    and length(p_mensagem) between 1 and 2000,false);
$$;
revoke execute on function public.sequencia_lembrete_proposta_valida(jsonb,text,text,text) from anon, authenticated, public;
grant execute on function public.sequencia_lembrete_proposta_valida(jsonb,text,text,text) to service_role;

alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_proposta_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_proposta_check check (
  (tipo not in ('lembrete_proposta_7d','lembrete_proposta_30d')
    and proposta_enviado_em is null and proposta_pdf_url is null
    and solicitado_em is null and solicitado_por is null)
  or (tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
    and proposta_enviado_em is not null and isfinite(proposta_enviado_em)
    and proposta_enviado_em<=ocorrido_em and proposta_pdf_url is not null
    and solicitado_em is not null and solicitado_em=ocorrido_em and solicitado_por is not null
    and public.sequencia_lembrete_proposta_valida(sequencia,tipo,proposta_pdf_url,mensagem)));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_sequencia_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_sequencia_check check (
  (tipo='confirmacao_recebimento' and sequencia is null)
  or (tipo='lembrete_formulario_24h' and (estado not in ('pendente','reservado','enviando')
    or public.sequencia_lembrete_formulario_valida(sequencia,lead_id,mensagem)))
  or (tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
    and public.sequencia_lembrete_proposta_valida(sequencia,tipo,proposta_pdf_url,mensagem)));

-- Historicos de varias revisoes coexistem; formulario continua unico por lead.
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_lead_id_tipo_key;
create unique index if not exists whatsapp_outbox_formulario_unico_idx
  on public.whatsapp_outbox(lead_id,tipo)
  where tipo in ('confirmacao_recebimento','lembrete_formulario_24h');
create unique index if not exists whatsapp_outbox_proposta_unica_idx
  on public.whatsapp_outbox(lead_id,tipo,proposta_enviado_em)
  where tipo in ('lembrete_proposta_7d','lembrete_proposta_30d');

-- Retorna codigo, nao dados pessoais. Executada com o lead ja travado pelo chamador.
create or replace function public.recusa_lembrete_proposta_whatsapp(
  p_lead_id uuid, p_tipo text, p_proposta_enviado_em timestamptz,
  p_pdf_url text, p_destinatario text, p_agora timestamptz
)
returns text language plpgsql stable security invoker set search_path = pg_catalog
as $$
declare v_lead public.leads%rowtype; v_sete timestamptz;
begin
  select * into v_lead from public.leads where id=p_lead_id;
  if not found then return 'lead_nao_encontrado'; end if;
  if v_lead.status::text not in ('enviado','esfriou') then return 'coluna_invalida'; end if;
  if p_proposta_enviado_em is null or v_lead.enviado_em is distinct from p_proposta_enviado_em
    then return 'proposta_alterada'; end if;
  if public.sequencia_lembrete_proposta(p_tipo,v_lead.pdf_url) is null then return 'proposta_ausente'; end if;
  if v_lead.pdf_url is distinct from p_pdf_url then return 'proposta_alterada'; end if;
  if public.destinatario_whatsapp_br(v_lead.whatsapp) is null then return 'telefone_invalido'; end if;
  if public.destinatario_whatsapp_br(v_lead.whatsapp) is distinct from p_destinatario then return 'proposta_alterada'; end if;
  if p_agora<p_proposta_enviado_em+(case when p_tipo='lembrete_proposta_7d'
    then interval '7 days' else interval '30 days' end) then return 'prazo_nao_atingido'; end if;
  if p_tipo='lembrete_proposta_30d' then
    select o.enviado_em into v_sete from public.whatsapp_outbox o
      where o.lead_id=p_lead_id and o.tipo='lembrete_proposta_7d'
        and o.proposta_enviado_em=p_proposta_enviado_em and o.proposta_pdf_url=p_pdf_url
        and o.destinatario=p_destinatario and o.estado='enviado'
        and o.iniciado_em is not null and o.enviado_em is not null
        and public.sequencia_lembrete_proposta_valida(o.sequencia,o.tipo,o.proposta_pdf_url,o.mensagem);
    if not found then return 'lembrete_7_nao_enviado'; end if;
    if v_sete>p_agora-interval '15 days' then return 'lembrete_7_recente'; end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.recusa_lembrete_proposta_whatsapp(uuid,text,timestamptz,text,text,timestamptz)
  from anon, authenticated, public;
grant execute on function public.recusa_lembrete_proposta_whatsapp(uuid,text,timestamptz,text,text,timestamptz) to service_role;

create or replace function public.enfileirar_lembrete_proposta_whatsapp(
  p_lead_id uuid, p_marco integer, p_proposta_enviado_em timestamptz, p_solicitado_por uuid
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp(); v_lead public.leads%rowtype;
  v_job public.whatsapp_outbox%rowtype; v_tipo text; v_recusa text; v_seq jsonb; v_texto text;
begin
  if p_marco not in (7,30) or p_marco is null or p_solicitado_por is null then
    return jsonb_build_object('erro','payload_invalido'); end if;
  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then return jsonb_build_object('erro','lead_nao_encontrado'); end if;
  v_tipo:=case when p_marco=7 then 'lembrete_proposta_7d' else 'lembrete_proposta_30d' end;
  v_recusa:=public.recusa_lembrete_proposta_whatsapp(p_lead_id,v_tipo,p_proposta_enviado_em,
    v_lead.pdf_url,public.destinatario_whatsapp_br(v_lead.whatsapp),v_agora);
  if v_recusa is not null then return jsonb_build_object('erro',v_recusa); end if;
  select * into v_job from public.whatsapp_outbox where lead_id=p_lead_id and tipo=v_tipo
    and proposta_enviado_em=p_proposta_enviado_em for update;
  if found then
    if v_job.estado='enviado' then return jsonb_build_object('erro','ja_enviado'); end if;
    if v_job.estado in ('pendente','reservado','enviando') then
      return jsonb_build_object('id',v_job.id,'estado',v_job.estado,'reutilizado',true); end if;
    if v_job.estado='indeterminado' or v_job.iniciado_em is not null then
      return jsonb_build_object('erro','envio_indeterminado'); end if;
    if v_job.proposta_pdf_url is distinct from v_lead.pdf_url
      or v_job.destinatario is distinct from public.destinatario_whatsapp_br(v_lead.whatsapp) then
      return jsonb_build_object('erro','proposta_alterada'); end if;
    if v_job.estado<>'cancelado' or v_job.ultimo_codigo is null or v_job.ultimo_codigo not in
      ('inactivity_recent','inactivity_unverified','proposta_condicao_alterada') then
      return jsonb_build_object('erro','tentativa_encerrada'); end if;
    -- Outro clique pode refazer apenas o que NUNCA recebeu started/MCP.
    -- Mantem o ID para evitar qualquer colisao com recibos/ledger ja existentes.
    update public.whatsapp_outbox set estado='pendente',ocorrido_em=v_agora,expira_em=v_agora+interval '24 hours',
      solicitado_em=v_agora,solicitado_por=p_solicitado_por,proxima_tentativa_em=v_agora,
      lease_token=null,lease_ate=null,tentativas=0,ultimo_codigo=null,
      historico_verificado_em=null,historico_cobertura_inicio_em=null,ultima_interacao_em=null
      where id=v_job.id;
    return jsonb_build_object('id',v_job.id,'estado','pendente','reutilizado',true);
  end if;
  v_seq:=public.sequencia_lembrete_proposta(v_tipo,v_lead.pdf_url);
  select string_agg(p.value->>'message',E'\n\n' order by p.n) into v_texto
    from jsonb_array_elements(v_seq) with ordinality p(value,n);
  insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,
    proposta_enviado_em,proposta_pdf_url,solicitado_em,solicitado_por)
  values(p_lead_id,v_tipo,v_agora,v_agora+interval '24 hours',public.destinatario_whatsapp_br(v_lead.whatsapp),
    v_texto,v_seq,p_proposta_enviado_em,v_lead.pdf_url,v_agora,p_solicitado_por) returning * into v_job;
  return jsonb_build_object('id',v_job.id,'estado',v_job.estado,'reutilizado',false);
end;
$$;
revoke execute on function public.enfileirar_lembrete_proposta_whatsapp(uuid,integer,timestamptz,uuid) from anon, authenticated, public;
grant execute on function public.enfileirar_lembrete_proposta_whatsapp(uuid,integer,timestamptz,uuid) to service_role;

create or replace function public.reivindicar_whatsapp_v4(
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean
)
returns setof public.whatsapp_outbox language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp(); v_leads uuid[];
  v_formulario boolean:=p_formulario_ativo is true and p_inicio_em is not null
    and isfinite(p_inicio_em) and p_inicio_em<=statement_timestamp();
begin
  select coalesce(array_agg(p.id),array[]::uuid[]) into v_leads from (
    select l.id from public.leads l where exists(select 1 from public.whatsapp_outbox o
      where o.lead_id=l.id and o.estado in ('pendente','reservado','enviando'))
    order by l.id for update of l skip locked) p;
  update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio'
    where lead_id=any(v_leads) and estado='enviando' and lease_ate<=v_agora;
  update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,ultimo_codigo='lease_expirado_antes_envio'
    where lead_id=any(v_leads) and estado='reservado' and lease_ate<=v_agora;
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='proposta_condicao_alterada'
    where o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
      and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is not null;
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='lead_ou_contato_alterado'
    from public.leads l where o.lead_id=l.id and l.id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.tipo='lembrete_formulario_24h' and (l.status::text<>'incompleto'
        or o.destinatario is distinct from public.destinatario_whatsapp_br(l.whatsapp));
  update public.whatsapp_outbox set estado='expirado',lease_token=null,lease_ate=null,
    ultimo_codigo=case when tentativas>=5 then 'limite_tentativas' else 'prazo_expirado' end
    where lead_id=any(v_leads) and estado in ('pendente','reservado')
      and (expira_em<=v_agora or (estado='pendente' and tentativas>=5));
  return query with candidato as (
    select o.id from public.whatsapp_outbox o join public.leads l on l.id=o.lead_id
    where l.id=any(v_leads) and o.estado='pendente' and o.expira_em>v_agora
      and o.proxima_tentativa_em<=v_agora and o.tentativas<5
      and ((o.tipo='lembrete_formulario_24h' and v_formulario
        and public.sequencia_lembrete_formulario_valida(o.sequencia,o.lead_id,o.mensagem)
        and l.created_at>=p_inicio_em and l.created_at<v_agora-interval '24 hours')
      or (o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and p_propostas_ativo is true
        and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is null))
    order by o.ocorrido_em,o.id limit 1 for update of o skip locked
  ) update public.whatsapp_outbox o set estado='reservado',lease_token=gen_random_uuid(),
    lease_ate=v_agora+interval '90 seconds',tentativas=o.tentativas+1,proxima_tentativa_em=v_agora+interval '5 minutes'
    from candidato c where o.id=c.id returning o.*;
end;
$$;
revoke execute on function public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean) from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean) to service_role;

create or replace function public.resultado_whatsapp_v4(
  p_id uuid,p_lease_token uuid,p_outcome text,p_code text,
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,
  p_historico_verificado_em timestamptz,p_historico_cobertura_inicio_em timestamptz,
  p_ultima_interacao_em timestamptz,p_historico_completo boolean
)
returns text language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v public.whatsapp_outbox%rowtype; v_lead_id uuid; v_tipo text; v_agora timestamptz:=statement_timestamp();
  v_janela interval; v_recusa text; v_enviado timestamptz;
begin
  select o.lead_id,o.tipo into v_lead_id,v_tipo from public.whatsapp_outbox o
    where o.id=p_id and o.lease_token=p_lease_token;
  if not found then return null; end if;
  if v_tipo not in ('lembrete_proposta_7d','lembrete_proposta_30d') then
    return public.resultado_whatsapp_v3(p_id,p_lease_token,p_outcome,p_code,p_formulario_ativo,p_inicio_em);
  end if;
  -- Mesma ordem de locks do enqueue/claim, inclusive no ACK que carimba o lead.
  perform 1 from public.leads where id=v_lead_id for update;
  if not found then return null; end if;
  select * into v from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token for update;
  if not found then return null; end if;
  if p_outcome='started' then
    if v.estado not in ('reservado','enviando') or p_propostas_ativo is not true then return null; end if;
    v_recusa:=public.recusa_lembrete_proposta_whatsapp(v.lead_id,v.tipo,v.proposta_enviado_em,v.proposta_pdf_url,v.destinatario,v_agora);
    if v_recusa is not null then v_recusa:='proposta_condicao_alterada'; end if;
    if v.lease_ate<=v_agora or v.expira_em<=v_agora then v_recusa:='prazo_expirado'; end if;
    v_janela:=case when v.tipo='lembrete_proposta_7d' then interval '5 days' else interval '15 days' end;
    if p_historico_completo is not true or p_historico_verificado_em is null
      or not isfinite(p_historico_verificado_em) or p_historico_cobertura_inicio_em is null
      or not isfinite(p_historico_cobertura_inicio_em)
      or p_historico_verificado_em<v_agora-interval '30 seconds'
      or p_historico_verificado_em>v_agora+interval '5 seconds'
      or p_historico_cobertura_inicio_em>v_agora-v_janela
      or (p_ultima_interacao_em is not null and not isfinite(p_ultima_interacao_em)) then
      v_recusa:='inactivity_unverified';
    elsif p_ultima_interacao_em>v_agora-v_janela then v_recusa:='inactivity_recent'; end if;
    if v_recusa is not null then
      update public.whatsapp_outbox set estado=case when iniciado_em is not null then 'indeterminado' else 'cancelado' end,
        ultimo_codigo=v_recusa where id=p_id;
      return null;
    end if;
    update public.whatsapp_outbox set estado='enviando',iniciado_em=coalesce(iniciado_em,v_agora),
      lease_ate=coalesce(iniciado_em,v_agora)+interval '240 seconds',
      historico_verificado_em=p_historico_verificado_em,historico_cobertura_inicio_em=p_historico_cobertura_inicio_em,
      ultima_interacao_em=p_ultima_interacao_em where id=p_id;
    return 'enviando';
  end if;
  if p_outcome='sent' and v.estado in ('enviando','indeterminado','enviado') then
    v_enviado:=coalesce(v.enviado_em,v_agora);
    update public.whatsapp_outbox set estado='enviado',enviado_em=v_enviado,ultimo_codigo=null where id=p_id;
    if v.tipo='lembrete_proposta_7d' then
      update public.leads set lembrete_7_em=v_enviado where id=v.lead_id and enviado_em=v.proposta_enviado_em
        and lembrete_7_em is distinct from v_enviado;
    else
      update public.leads set lembrete_30_em=v_enviado where id=v.lead_id and enviado_em=v.proposta_enviado_em
        and lembrete_30_em is distinct from v_enviado;
    end if;
    return 'enviado';
  end if;
  if p_outcome in ('failed','indeterminate') and v.estado in ('enviando','indeterminado') then
    update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo=coalesce(p_code,'resultado_indeterminado') where id=p_id;
    return 'indeterminado';
  end if;
  if p_outcome='failed' and v.estado='reservado' then
    if p_code in ('inactivity_recent','inactivity_unverified') then
      update public.whatsapp_outbox set estado='cancelado',ultimo_codigo=p_code where id=p_id;
      return 'cancelado';
    end if;
    update public.whatsapp_outbox set estado=case when expira_em<=v_agora or tentativas>=5 then 'expirado' else 'pendente' end,
      lease_token=null,lease_ate=null,proxima_tentativa_em=v_agora+interval '5 minutes',ultimo_codigo=coalesce(p_code,'falha_antes_envio') where id=p_id;
    return case when v.expira_em<=v_agora or v.tentativas>=5 then 'expirado' else 'pendente' end;
  end if;
  return null;
end;
$$;
revoke execute on function public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean)
  from anon, authenticated, public;
grant execute on function public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean) to service_role;

-- A revisao do enfileirador de formulario com ON CONFLICT parcial vem abaixo.
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
  on conflict (lead_id, tipo) where tipo in ('confirmacao_recebimento', 'lembrete_formulario_24h') do nothing;
  get diagnostics v_quantidade = row_count;
  return v_quantidade;
end;
$$;
revoke execute on function public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz, jsonb, text)
  from anon, authenticated, public;
grant execute on function public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz, jsonb, text) to service_role;


-- Historico WhatsApp ao vivo no Kanban. Aplicar DEPOIS de quadro-tempo-real.sql
-- e whatsapp-outbox.sql, em transacao. O mesmo bloco encerra schema.sql.
-- Reutiliza a campainha privada e vazia: nenhum dado da outbox/lead vai ao canal,
-- nenhuma policy muda, e uma falha do Broadcast nao desfaz o ACK do WhatsApp.
-- ACK repetido, heartbeat entre partes e simples correcao de carimbo nao avisam.
-- Propostas tambem avisam mudancas de estado para a UI encerrar fila/bloqueios.
drop trigger if exists whatsapp_outbox_avisar_quadro on public.whatsapp_outbox;
create trigger whatsapp_outbox_avisar_quadro
  after update of estado, enviado_em on public.whatsapp_outbox
  for each row
  when ((old.estado is distinct from 'enviado'
    and new.estado = 'enviado' and new.enviado_em is not null)
    or (new.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
      and old.estado is distinct from new.estado))
  execute function public.avisar_quadro();

commit;


-- Excecao temporaria de testes do owner (15/10/2026)
-- Excecao TEMPORARIA pedida pelo owner em 15/10/2026 para cinco cards de teste.
-- Aplicar depois de whatsapp-lembretes-proposta.sql. Nao cria leads, nao enfileira,
-- nao envia, nao altera historicos e nao ativa automacao de formulario.
-- A allowlist e preenchida separadamente com a revisao exata de cada proposta.
-- Expira em 17/10/2026 as 15h de Sao Paulo, sem renovacao implicita.
begin;
lock table public.whatsapp_outbox in share row exclusive mode;

create table if not exists public.whatsapp_testes_owner (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  marco integer not null,
  proposta_enviado_em timestamptz not null check(isfinite(proposta_enviado_em)),
  proposta_pdf_url text not null,
  expira_em timestamptz not null default '2026-10-17T18:00:00Z',
  constraint whatsapp_testes_owner_escopo_check check (
    expira_em=timestamptz '2026-10-17T18:00:00Z' and
    ((marco=7 and lead_id in ('01b985e2-6bff-4e9c-bb5e-2f1cc280edf7',
      'd459193f-9e7c-4b2c-995d-7f829a0936bd','13e49741-9d35-404c-ae54-42fe93e55c66'))
     or (marco=30 and lead_id in ('abf88ff2-ea34-4e32-994d-f7dc75df599b',
      '9263d823-d059-4e0a-b759-9184035dec89'))))
);
alter table public.whatsapp_testes_owner enable row level security;
revoke all on table public.whatsapp_testes_owner from anon,authenticated,public;
grant select,insert,update,delete on table public.whatsapp_testes_owner to service_role;

alter table public.whatsapp_outbox add column if not exists teste_owner_expira_em timestamptz;
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_teste_owner_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_teste_owner_check check (
  teste_owner_expira_em is null or (teste_owner_expira_em=timestamptz '2026-10-17T18:00:00Z'
    and destinatario='5519988763916' and proposta_enviado_em is not null
    and ((tipo='lembrete_proposta_7d' and lead_id in ('01b985e2-6bff-4e9c-bb5e-2f1cc280edf7',
      'd459193f-9e7c-4b2c-995d-7f829a0936bd','13e49741-9d35-404c-ae54-42fe93e55c66'))
     or (tipo='lembrete_proposta_30d' and lead_id in ('abf88ff2-ea34-4e32-994d-f7dc75df599b',
      '9263d823-d059-4e0a-b759-9184035dec89')))));

-- Sem parametro controlado pelo navegador. O banco confere todos os snapshots.
create or replace function public.teste_proposta_whatsapp_valido(
  p_lead_id uuid,p_tipo text,p_proposta_enviado_em timestamptz,
  p_pdf_url text,p_destinatario text,p_agora timestamptz
)
returns boolean language sql stable security invoker set search_path=pg_catalog
as $$
  select coalesce(p_agora is not null and isfinite(p_agora)
    and p_agora<timestamptz '2026-10-17T18:00:00Z'
    and p_destinatario='5519988763916' and exists (
      select 1 from public.whatsapp_testes_owner t join public.leads l on l.id=t.lead_id
      where t.lead_id=p_lead_id and t.expira_em=timestamptz '2026-10-17T18:00:00Z'
        and t.expira_em>p_agora
        and ((t.marco=7 and p_tipo='lembrete_proposta_7d')
          or (t.marco=30 and p_tipo='lembrete_proposta_30d'))
        and t.proposta_enviado_em=p_proposta_enviado_em and l.enviado_em=p_proposta_enviado_em
        and t.proposta_pdf_url=p_pdf_url and l.pdf_url=p_pdf_url
        and l.nome_display='TESTE HENRIQUE'
        and public.destinatario_whatsapp_br(l.whatsapp)=p_destinatario
        and l.status::text in ('enviado','esfriou')
        and p_agora>=p_proposta_enviado_em+case when t.marco=7 then interval '7 days' else interval '30 days' end
        and public.sequencia_lembrete_proposta(p_tipo,p_pdf_url) is not null),false);
$$;
revoke execute on function public.teste_proposta_whatsapp_valido(uuid,text,timestamptz,text,text,timestamptz)
  from anon,authenticated,public;
grant execute on function public.teste_proposta_whatsapp_valido(uuid,text,timestamptz,text,text,timestamptz) to service_role;

-- Marca somente novo clique/reclique anterior ao MCP. Nunca reescreve ACK real.
create or replace function public.marcar_teste_owner_whatsapp()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  if new.estado='pendente' and new.iniciado_em is null then
    if tg_op='INSERT' or (old.estado='cancelado' and old.iniciado_em is null) then
      new.teste_owner_expira_em:=case when public.teste_proposta_whatsapp_valido(
        new.lead_id,new.tipo,new.proposta_enviado_em,new.proposta_pdf_url,new.destinatario,statement_timestamp())
        then timestamptz '2026-10-17T18:00:00Z' else null end;
      return new;
    end if;
  end if;
  if tg_op='UPDATE' then new.teste_owner_expira_em:=old.teste_owner_expira_em; end if;
  return new;
end;
$$;
revoke execute on function public.marcar_teste_owner_whatsapp() from anon,authenticated,public;
grant execute on function public.marcar_teste_owner_whatsapp() to service_role;
drop trigger if exists whatsapp_outbox_marcar_teste_owner on public.whatsapp_outbox;
create trigger whatsapp_outbox_marcar_teste_owner before insert or update on public.whatsapp_outbox
  for each row execute function public.marcar_teste_owner_whatsapp();

create or replace function public.recusa_lembrete_proposta_whatsapp(
  p_lead_id uuid, p_tipo text, p_proposta_enviado_em timestamptz,
  p_pdf_url text, p_destinatario text, p_agora timestamptz
)
returns text language plpgsql stable security invoker set search_path = pg_catalog
as $$
declare v_lead public.leads%rowtype; v_sete timestamptz;
begin
  select * into v_lead from public.leads where id=p_lead_id;
  if not found then return 'lead_nao_encontrado'; end if;
  if v_lead.status::text not in ('enviado','esfriou') then return 'coluna_invalida'; end if;
  if p_proposta_enviado_em is null or v_lead.enviado_em is distinct from p_proposta_enviado_em
    then return 'proposta_alterada'; end if;
  if public.sequencia_lembrete_proposta(p_tipo,v_lead.pdf_url) is null then return 'proposta_ausente'; end if;
  if v_lead.pdf_url is distinct from p_pdf_url then return 'proposta_alterada'; end if;
  if public.destinatario_whatsapp_br(v_lead.whatsapp) is null then return 'telefone_invalido'; end if;
  if public.destinatario_whatsapp_br(v_lead.whatsapp) is distinct from p_destinatario then return 'proposta_alterada'; end if;
  if p_agora<p_proposta_enviado_em+(case when p_tipo='lembrete_proposta_7d'
    then interval '7 days' else interval '30 days' end) then return 'prazo_nao_atingido'; end if;
  if p_tipo='lembrete_proposta_30d' and not public.teste_proposta_whatsapp_valido(
    p_lead_id,p_tipo,p_proposta_enviado_em,p_pdf_url,p_destinatario,p_agora) then
    select o.enviado_em into v_sete from public.whatsapp_outbox o
      where o.lead_id=p_lead_id and o.tipo='lembrete_proposta_7d'
        and o.proposta_enviado_em=p_proposta_enviado_em and o.proposta_pdf_url=p_pdf_url
        and o.destinatario=p_destinatario and o.estado='enviado'
        and o.iniciado_em is not null and o.enviado_em is not null
        and public.sequencia_lembrete_proposta_valida(o.sequencia,o.tipo,o.proposta_pdf_url,o.mensagem);
    if not found then return 'lembrete_7_nao_enviado'; end if;
    if v_sete>p_agora-interval '15 days' then return 'lembrete_7_recente'; end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.recusa_lembrete_proposta_whatsapp(uuid,text,timestamptz,text,text,timestamptz)
  from anon, authenticated, public;
grant execute on function public.recusa_lembrete_proposta_whatsapp(uuid,text,timestamptz,text,text,timestamptz) to service_role;

create or replace function public.reivindicar_whatsapp_v4(
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean
)
returns setof public.whatsapp_outbox language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp(); v_leads uuid[];
  v_formulario boolean:=p_formulario_ativo is true and p_inicio_em is not null
    and isfinite(p_inicio_em) and p_inicio_em<=statement_timestamp();
begin
  select coalesce(array_agg(p.id),array[]::uuid[]) into v_leads from (
    select l.id from public.leads l where exists(select 1 from public.whatsapp_outbox o
      where o.lead_id=l.id and o.estado in ('pendente','reservado','enviando'))
    order by l.id for update of l skip locked) p;
  update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio'
    where lead_id=any(v_leads) and estado='enviando' and lease_ate<=v_agora;
  update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,ultimo_codigo='lease_expirado_antes_envio'
    where lead_id=any(v_leads) and estado='reservado' and lease_ate<=v_agora;
  -- Um job marcado para teste nunca perde silenciosamente a validade temporaria.
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='teste_owner_expirado'
    where o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.teste_owner_expira_em is not null
      and (o.teste_owner_expira_em<>timestamptz '2026-10-17T18:00:00Z'
        or not public.teste_proposta_whatsapp_valido(o.lead_id,o.tipo,o.proposta_enviado_em,
          o.proposta_pdf_url,o.destinatario,v_agora));
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='proposta_condicao_alterada'
    where o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
      and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is not null;
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='lead_ou_contato_alterado'
    from public.leads l where o.lead_id=l.id and l.id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.tipo='lembrete_formulario_24h' and (l.status::text<>'incompleto'
        or o.destinatario is distinct from public.destinatario_whatsapp_br(l.whatsapp));
  update public.whatsapp_outbox set estado='expirado',lease_token=null,lease_ate=null,
    ultimo_codigo=case when tentativas>=5 then 'limite_tentativas' else 'prazo_expirado' end
    where lead_id=any(v_leads) and estado in ('pendente','reservado')
      and (expira_em<=v_agora or (estado='pendente' and tentativas>=5));
  return query with candidato as (
    select o.id from public.whatsapp_outbox o join public.leads l on l.id=o.lead_id
    where l.id=any(v_leads) and o.estado='pendente' and o.expira_em>v_agora
      and o.proxima_tentativa_em<=v_agora and o.tentativas<5
      and ((o.tipo='lembrete_formulario_24h' and v_formulario
        and public.sequencia_lembrete_formulario_valida(o.sequencia,o.lead_id,o.mensagem)
        and l.created_at>=p_inicio_em and l.created_at<v_agora-interval '24 hours')
      or (o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and p_propostas_ativo is true
        and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is null))
    order by o.ocorrido_em,o.id limit 1 for update of o skip locked
  ) update public.whatsapp_outbox o set estado='reservado',lease_token=gen_random_uuid(),
    lease_ate=v_agora+interval '90 seconds',tentativas=o.tentativas+1,proxima_tentativa_em=v_agora+interval '5 minutes'
    from candidato c where o.id=c.id returning o.*;
end;
$$;
revoke execute on function public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean) from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean) to service_role;

create or replace function public.resultado_whatsapp_v4(
  p_id uuid,p_lease_token uuid,p_outcome text,p_code text,
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,
  p_historico_verificado_em timestamptz,p_historico_cobertura_inicio_em timestamptz,
  p_ultima_interacao_em timestamptz,p_historico_completo boolean
)
returns text language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v public.whatsapp_outbox%rowtype; v_lead_id uuid; v_tipo text; v_agora timestamptz:=statement_timestamp();
  v_janela interval; v_recusa text; v_enviado timestamptz;
begin
  select o.lead_id,o.tipo into v_lead_id,v_tipo from public.whatsapp_outbox o
    where o.id=p_id and o.lease_token=p_lease_token;
  if not found then return null; end if;
  if v_tipo not in ('lembrete_proposta_7d','lembrete_proposta_30d') then
    return public.resultado_whatsapp_v3(p_id,p_lease_token,p_outcome,p_code,p_formulario_ativo,p_inicio_em);
  end if;
  -- Mesma ordem de locks do enqueue/claim, inclusive no ACK que carimba o lead.
  perform 1 from public.leads where id=v_lead_id for update;
  if not found then return null; end if;
  select * into v from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token for update;
  if not found then return null; end if;
  if p_outcome='started' then
    if v.estado not in ('reservado','enviando') or p_propostas_ativo is not true then return null; end if;
    v_recusa:=public.recusa_lembrete_proposta_whatsapp(v.lead_id,v.tipo,v.proposta_enviado_em,v.proposta_pdf_url,v.destinatario,v_agora);
    if v_recusa is not null then v_recusa:='proposta_condicao_alterada'; end if;
    if v.lease_ate<=v_agora or v.expira_em<=v_agora then v_recusa:='prazo_expirado'; end if;
    v_janela:=case when v.tipo='lembrete_proposta_7d' then interval '5 days' else interval '15 days' end;
    if v.teste_owner_expira_em is not null then
      if v.teste_owner_expira_em<>timestamptz '2026-10-17T18:00:00Z'
        or not public.teste_proposta_whatsapp_valido(v.lead_id,v.tipo,v.proposta_enviado_em,
          v.proposta_pdf_url,v.destinatario,v_agora) then v_recusa:='teste_owner_expirado'; end if;
    elsif p_historico_completo is not true or p_historico_verificado_em is null
      or not isfinite(p_historico_verificado_em) or p_historico_cobertura_inicio_em is null
      or not isfinite(p_historico_cobertura_inicio_em)
      or p_historico_verificado_em<v_agora-interval '30 seconds'
      or p_historico_verificado_em>v_agora+interval '5 seconds'
      or p_historico_cobertura_inicio_em>v_agora-v_janela
      or (p_ultima_interacao_em is not null and not isfinite(p_ultima_interacao_em)) then
      v_recusa:='inactivity_unverified';
    elsif p_ultima_interacao_em>v_agora-v_janela then v_recusa:='inactivity_recent'; end if;
    if v_recusa is not null then
      update public.whatsapp_outbox set estado=case when iniciado_em is not null then 'indeterminado' else 'cancelado' end,
        ultimo_codigo=v_recusa where id=p_id;
      return null;
    end if;
    update public.whatsapp_outbox set estado='enviando',iniciado_em=coalesce(iniciado_em,v_agora),
      lease_ate=coalesce(iniciado_em,v_agora)+interval '240 seconds',
      historico_verificado_em=case when v.teste_owner_expira_em is null then p_historico_verificado_em else null end,
      historico_cobertura_inicio_em=case when v.teste_owner_expira_em is null then p_historico_cobertura_inicio_em else null end,
      ultima_interacao_em=case when v.teste_owner_expira_em is null then p_ultima_interacao_em else null end where id=p_id;
    return 'enviando';
  end if;
  if p_outcome='sent' and v.estado in ('enviando','indeterminado','enviado') then
    v_enviado:=coalesce(v.enviado_em,v_agora);
    update public.whatsapp_outbox set estado='enviado',enviado_em=v_enviado,ultimo_codigo=null where id=p_id;
    if v.tipo='lembrete_proposta_7d' then
      update public.leads set lembrete_7_em=v_enviado where id=v.lead_id and enviado_em=v.proposta_enviado_em
        and lembrete_7_em is distinct from v_enviado;
    else
      update public.leads set lembrete_30_em=v_enviado where id=v.lead_id and enviado_em=v.proposta_enviado_em
        and lembrete_30_em is distinct from v_enviado;
    end if;
    return 'enviado';
  end if;
  if p_outcome in ('failed','indeterminate') and v.estado in ('enviando','indeterminado') then
    update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo=coalesce(p_code,'resultado_indeterminado') where id=p_id;
    return 'indeterminado';
  end if;
  if p_outcome='failed' and v.estado='reservado' then
    if p_code in ('inactivity_recent','inactivity_unverified') then
      update public.whatsapp_outbox set estado='cancelado',ultimo_codigo=p_code where id=p_id;
      return 'cancelado';
    end if;
    update public.whatsapp_outbox set estado=case when expira_em<=v_agora or tentativas>=5 then 'expirado' else 'pendente' end,
      lease_token=null,lease_ate=null,proxima_tentativa_em=v_agora+interval '5 minutes',ultimo_codigo=coalesce(p_code,'falha_antes_envio') where id=p_id;
    return case when v.expira_em<=v_agora or v.tentativas>=5 then 'expirado' else 'pendente' end;
  end if;
  return null;
end;
$$;
revoke execute on function public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean)
  from anon, authenticated, public;
grant execute on function public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean) to service_role;

commit;


-- Primeiro envio da proposta após 15 minutos em Aguardando revisão.
-- Aplicar manualmente depois de whatsapp-testes-owner.sql. Não ativa flags.
-- A fila existente, sessão e recibos permanecem preservados.
begin;

alter table public.leads add column if not exists pdf_storage_path text;

create table if not exists public.whatsapp_propostas_automaticas (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  entrada_em timestamptz not null,
  estado text not null default 'agendada' check (estado in
    ('agendada','gerando','enfileirada','enviado','cancelada','falha','indeterminado')),
  tentativas integer not null default 0 check (tentativas between 0 and 5),
  proxima_tentativa_em timestamptz not null default now(),
  lease_token uuid, lease_ate timestamptz,
  categoria text, respostas jsonb, destinatario text,
  pdf_anterior_em timestamptz, pdf_gerado_em timestamptz,
  arquivo text, nome_contato text, ultimo_codigo text
);
alter table public.whatsapp_propostas_automaticas enable row level security;
revoke all on table public.whatsapp_propostas_automaticas from public,anon,authenticated;
grant select,insert,update,delete on table public.whatsapp_propostas_automaticas to service_role;
create index if not exists whatsapp_propostas_automaticas_agendadas_idx
  on public.whatsapp_propostas_automaticas(proxima_tentativa_em,entrada_em)
  where estado in ('agendada','gerando');

create or replace function public.registrar_entrada_proposta_automatica()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  if new.status::text='aguardando_revisao'
    and (tg_op='INSERT' or old.status is distinct from new.status)
    and new.enviado_em is null
    and not exists(select 1 from public.whatsapp_outbox o where o.lead_id=new.id
      and o.tipo='proposta_inicial_15m' and o.iniciado_em is not null) then
    insert into public.whatsapp_propostas_automaticas(lead_id,entrada_em)
      values(new.id,statement_timestamp())
    on conflict(lead_id) do update set entrada_em=excluded.entrada_em,estado='agendada',
      tentativas=0,proxima_tentativa_em=statement_timestamp(),lease_token=null,lease_ate=null,
      ultimo_codigo=null;
  end if;
  return new;
end;
$$;
revoke execute on function public.registrar_entrada_proposta_automatica() from public,anon,authenticated;
grant execute on function public.registrar_entrada_proposta_automatica() to service_role;
drop trigger if exists leads_agendar_proposta_automatica on public.leads;
create trigger leads_agendar_proposta_automatica after insert or update of status on public.leads
  for each row execute function public.registrar_entrada_proposta_automatica();

-- Para os cards atuais, updated_at é um limite conservador: nunca antecipa
-- os 15 minutos. Novas entradas usam o instante exato do trigger acima.
insert into public.whatsapp_propostas_automaticas(lead_id,entrada_em)
  select id,greatest(created_at,updated_at) from public.leads
  where status::text='aguardando_revisao' and enviado_em is null
  on conflict(lead_id) do nothing;

create or replace function public.sequencia_proposta_inicial(p_nome text,p_link text)
returns jsonb language sql immutable security invoker set search_path=pg_catalog
as $$
  select case when p_nome=btrim(p_nome) and length(p_nome) between 1 and 120
    and p_nome !~ '[[:cntrl:]{}<>]' and p_link ~ '^https://[^[:space:]/?#@]+/p/[a-z0-9]{4}$'
    and strpos(p_link,chr(92))=0 then jsonb_build_array(
      jsonb_build_object('message','Oi, '||p_nome||' tudo bem? Aqui é a Mel Storymaker ✨','delayBeforeSeconds',0),
      jsonb_build_object('message','Você solicitou um orçamento através do meu site.','delayBeforeSeconds',3),
      jsonb_build_object('message',E'Segue a sua proposta:\n🤍 '||p_link,'delayBeforeSeconds',2),
      jsonb_build_object('message',E'Qualquer dúvida, é só me chamar. Ok?\nFico à disposição para te ajudar no que precisar!','delayBeforeSeconds',4)) end;
$$;
create or replace function public.sequencia_proposta_inicial_valida(p_seq jsonb,p_nome text,p_link text,p_texto text)
returns boolean language sql immutable security invoker set search_path=pg_catalog
as $$
  select coalesce(p_seq=public.sequencia_proposta_inicial(p_nome,p_link)
    and p_texto=(select string_agg(p.value->>'message',E'\n\n' order by p.n)
      from jsonb_array_elements(public.sequencia_proposta_inicial(p_nome,p_link)) with ordinality p(value,n)),false);
$$;
revoke execute on function public.sequencia_proposta_inicial(text,text),public.sequencia_proposta_inicial_valida(jsonb,text,text,text)
  from public,anon,authenticated;
grant execute on function public.sequencia_proposta_inicial(text,text),public.sequencia_proposta_inicial_valida(jsonb,text,text,text) to service_role;

alter table public.whatsapp_outbox add column if not exists proposta_automatica_id uuid;
alter table public.whatsapp_outbox add column if not exists proposta_nome text;
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_tipo_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_tipo_check check(tipo in
  ('confirmacao_recebimento','lembrete_formulario_24h','lembrete_proposta_7d','lembrete_proposta_30d','proposta_inicial_15m'));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_somente_lembrete_ativo;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_somente_lembrete_ativo check(
  tipo in ('lembrete_formulario_24h','lembrete_proposta_7d','lembrete_proposta_30d','proposta_inicial_15m')
  or estado not in ('pendente','reservado','enviando'));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_proposta_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_proposta_check check(
  (tipo not in ('lembrete_proposta_7d','lembrete_proposta_30d','proposta_inicial_15m')
    and proposta_enviado_em is null and proposta_pdf_url is null and solicitado_em is null and solicitado_por is null)
  or (tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and proposta_enviado_em is not null
    and isfinite(proposta_enviado_em) and proposta_enviado_em<=ocorrido_em and proposta_pdf_url is not null
    and solicitado_em is not null and solicitado_em=ocorrido_em and solicitado_por is not null
    and public.sequencia_lembrete_proposta_valida(sequencia,tipo,proposta_pdf_url,mensagem))
  or (tipo='proposta_inicial_15m' and proposta_enviado_em is null and solicitado_em is null and solicitado_por is null
    and proposta_automatica_id is not null and proposta_nome is not null and proposta_pdf_url is not null
    and public.sequencia_proposta_inicial_valida(sequencia,proposta_nome,proposta_pdf_url,mensagem)));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_sequencia_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_sequencia_check check(
  (tipo='confirmacao_recebimento' and sequencia is null)
  or (tipo='lembrete_formulario_24h' and (estado not in ('pendente','reservado','enviando')
    or public.sequencia_lembrete_formulario_valida(sequencia,lead_id,mensagem)))
  or (tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
    and public.sequencia_lembrete_proposta_valida(sequencia,tipo,proposta_pdf_url,mensagem))
  or (tipo='proposta_inicial_15m' and public.sequencia_proposta_inicial_valida(sequencia,proposta_nome,proposta_pdf_url,mensagem)));
create unique index if not exists whatsapp_outbox_inicial_unica_idx
  on public.whatsapp_outbox(lead_id,tipo) where tipo='proposta_inicial_15m';

create or replace function public.reivindicar_preparo_proposta_whatsapp(p_ativo boolean)
returns setof public.whatsapp_propostas_automaticas language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_agora timestamptz:=statement_timestamp(); v_lead public.leads%rowtype;
begin
  if p_ativo is not true then return; end if;
  select l.* into v_lead from public.leads l join public.whatsapp_propostas_automaticas p on p.lead_id=l.id
    where l.status::text='aguardando_revisao' and l.enviado_em is null
      and p.entrada_em<=v_agora-interval '15 minutes' and p.tentativas<5 and p.proxima_tentativa_em<=v_agora
      and (p.estado='agendada' or (p.estado='gerando' and p.lease_ate<=v_agora))
      and not exists(select 1 from public.whatsapp_outbox o where o.lead_id=l.id
        and o.tipo='proposta_inicial_15m' and o.iniciado_em is not null)
    order by p.entrada_em,l.id limit 1 for update of l skip locked;
  if not found then return; end if;
  return query update public.whatsapp_propostas_automaticas p set estado='gerando',
    lease_token=gen_random_uuid(),lease_ate=v_agora+interval '90 seconds',tentativas=p.tentativas+1,
    categoria=v_lead.categoria::text,respostas=v_lead.respostas,
    destinatario=public.destinatario_whatsapp_br(v_lead.whatsapp),pdf_anterior_em=v_lead.pdf_gerado_em,
    ultimo_codigo=null where p.lead_id=v_lead.id returning p.*;
end;
$$;

create or replace function public.falhar_preparo_proposta_whatsapp(p_lead_id uuid,p_token uuid,p_codigo text,p_definitivo boolean)
returns boolean language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  perform 1 from public.leads where id=p_lead_id for update;
  update public.whatsapp_propostas_automaticas set estado=case when p_definitivo or tentativas>=5 then 'falha' else 'agendada' end,
    lease_token=null,lease_ate=null,proxima_tentativa_em=statement_timestamp()+interval '5 minutes',ultimo_codigo=p_codigo
    where lead_id=p_lead_id and lease_token=p_token and estado='gerando';
  return found;
end;
$$;

create or replace function public.concluir_preparo_proposta_whatsapp(
  p_lead_id uuid,p_token uuid,p_nome text,p_link text,p_arquivo text
)
returns boolean language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_lead public.leads%rowtype; v public.whatsapp_propostas_automaticas%rowtype;
  v_agora timestamptz:=statement_timestamp(); v_seq jsonb; v_texto text;
begin
  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then return false; end if;
  select * into v from public.whatsapp_propostas_automaticas where lead_id=p_lead_id for update;
  if not found or v.estado<>'gerando' or v.lease_token is distinct from p_token or v.lease_ate<=v_agora then return false; end if;
  if v_lead.status::text<>'aguardando_revisao' or v_lead.enviado_em is not null
    or v.entrada_em>v_agora-interval '15 minutes' or v_lead.categoria::text is distinct from v.categoria
    or v_lead.respostas is distinct from v.respostas or v_lead.pdf_gerado_em is distinct from v.pdf_anterior_em
    or v.destinatario is null or public.destinatario_whatsapp_br(v_lead.whatsapp) is distinct from v.destinatario
    or p_nome is distinct from btrim(v_lead.respostas->>'nome')
    or v_lead.slug is null or right(p_link,7) is distinct from '/p/'||v_lead.slug
    or p_arquivo is distinct from 'automaticas/'||p_lead_id::text||'/'||p_token::text||'.pdf'
    or exists(select 1 from public.whatsapp_outbox o where o.lead_id=p_lead_id and o.tipo='proposta_inicial_15m' and o.iniciado_em is not null)
  then
    update public.whatsapp_propostas_automaticas set estado='cancelada',ultimo_codigo='proposta_condicao_alterada',lease_token=null,lease_ate=null
      where lead_id=p_lead_id;
    return false;
  end if;
  v_seq:=public.sequencia_proposta_inicial(p_nome,p_link);
  if v_seq is null then return false; end if;
  select string_agg(p.value->>'message',E'\n\n' order by p.n) into v_texto from jsonb_array_elements(v_seq) with ordinality p(value,n);
  insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,
    proposta_automatica_id,proposta_nome,proposta_pdf_url)
    values(p_lead_id,'proposta_inicial_15m',v_agora,v_agora+interval '24 hours',v.destinatario,v_texto,v_seq,v.id,p_nome,p_link)
    on conflict(lead_id,tipo) where tipo='proposta_inicial_15m' do update
      set estado='pendente',ocorrido_em=excluded.ocorrido_em,expira_em=excluded.expira_em,
      destinatario=excluded.destinatario,mensagem=excluded.mensagem,sequencia=excluded.sequencia,
      proposta_automatica_id=excluded.proposta_automatica_id,proposta_nome=excluded.proposta_nome,
      proposta_pdf_url=excluded.proposta_pdf_url,tentativas=0,proxima_tentativa_em=v_agora,
      lease_token=null,lease_ate=null,ultimo_codigo=null
      where whatsapp_outbox.iniciado_em is null;
  update public.leads set pdf_url=p_link,pdf_gerado_em=v_agora,pdf_storage_path=p_arquivo where id=p_lead_id;
  update public.whatsapp_propostas_automaticas set estado='enfileirada',nome_contato=p_nome,
    arquivo=p_arquivo,pdf_gerado_em=v_agora,lease_token=null,lease_ate=null where lead_id=p_lead_id;
  return true;
end;
$$;

create or replace function public.recusa_proposta_inicial_whatsapp(p_id uuid,p_agora timestamptz)
returns text language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare v public.whatsapp_outbox%rowtype; p public.whatsapp_propostas_automaticas%rowtype; l public.leads%rowtype;
begin
  select * into v from public.whatsapp_outbox where id=p_id and tipo='proposta_inicial_15m';
  if not found then return 'job_invalido'; end if;
  select * into l from public.leads where id=v.lead_id;
  if not found or l.status::text<>'aguardando_revisao' or l.enviado_em is not null then return 'coluna_invalida'; end if;
  select * into p from public.whatsapp_propostas_automaticas where lead_id=v.lead_id and id=v.proposta_automatica_id;
  if not found or p.estado<>'enfileirada' or p.entrada_em>p_agora-interval '15 minutes'
    or l.categoria::text is distinct from p.categoria or l.respostas is distinct from p.respostas
    or l.pdf_url is distinct from v.proposta_pdf_url or l.pdf_storage_path is distinct from p.arquivo
    or l.pdf_gerado_em is distinct from p.pdf_gerado_em
    or public.destinatario_whatsapp_br(l.whatsapp) is distinct from v.destinatario
    or btrim(l.respostas->>'nome') is distinct from v.proposta_nome
    or not public.sequencia_proposta_inicial_valida(v.sequencia,v.proposta_nome,v.proposta_pdf_url,v.mensagem)
    then return 'proposta_condicao_alterada'; end if;
  return null;
end;
$$;

-- V4 permanece restrito aos tipos anteriores. Só o worker protocolo 4 usa V5.
create or replace function public.reivindicar_whatsapp_v5(
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,p_inicial_ativo boolean
)
returns setof public.whatsapp_outbox language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_agora timestamptz:=statement_timestamp(); v_leads uuid[]; v_id uuid;
begin
  if p_inicial_ativo is true then
    select coalesce(array_agg(c.id),array[]::uuid[]) into v_leads from(
      select l.id from public.leads l where exists(select 1 from public.whatsapp_outbox o
        where o.lead_id=l.id and o.tipo='proposta_inicial_15m' and o.estado in ('pendente','reservado','enviando'))
      order by l.id for update of l skip locked)c;
    update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio'
      where lead_id=any(v_leads) and tipo='proposta_inicial_15m' and estado='enviando' and lease_ate<=v_agora;
    update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null
      where lead_id=any(v_leads) and tipo='proposta_inicial_15m' and estado='reservado' and lease_ate<=v_agora;
    update public.whatsapp_outbox o set estado='cancelado',ultimo_codigo='proposta_condicao_alterada',lease_token=null,lease_ate=null
      where o.lead_id=any(v_leads) and o.tipo='proposta_inicial_15m' and o.estado in ('pendente','reservado')
      and public.recusa_proposta_inicial_whatsapp(o.id,v_agora) is not null;
    update public.whatsapp_outbox set estado='expirado',ultimo_codigo='prazo_expirado',lease_token=null,lease_ate=null
      where lead_id=any(v_leads) and tipo='proposta_inicial_15m' and estado in ('pendente','reservado')
      and (expira_em<=v_agora or tentativas>=5);
    select o.id into v_id from public.whatsapp_outbox o where o.lead_id=any(v_leads) and o.tipo='proposta_inicial_15m'
      and o.estado='pendente' and o.proxima_tentativa_em<=v_agora and o.expira_em>v_agora and o.tentativas<5
      order by o.ocorrido_em,o.id limit 1 for update of o skip locked;
    if found then
      return query update public.whatsapp_outbox set estado='reservado',lease_token=gen_random_uuid(),
        lease_ate=v_agora+interval '90 seconds',tentativas=tentativas+1,
        proxima_tentativa_em=v_agora+interval '5 minutes' where id=v_id returning *;
      return;
    end if;
  end if;
  return query select * from public.reivindicar_whatsapp_v4(p_formulario_ativo,p_inicio_em,p_propostas_ativo);
end;
$$;

create or replace function public.resultado_whatsapp_v5(
  p_id uuid,p_lease_token uuid,p_outcome text,p_code text,
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,p_inicial_ativo boolean,
  p_historico_verificado_em timestamptz,p_historico_cobertura_inicio_em timestamptz,
  p_ultima_interacao_em timestamptz,p_historico_completo boolean
)
returns text language plpgsql security invoker set search_path=pg_catalog
as $$
declare v public.whatsapp_outbox%rowtype; v_lead uuid; v_tipo text; v_agora timestamptz:=statement_timestamp(); v_recusa text; v_sent timestamptz;
begin
  select lead_id,tipo into v_lead,v_tipo from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token;
  if not found then return null; end if;
  if v_tipo<>'proposta_inicial_15m' then return public.resultado_whatsapp_v4(p_id,p_lease_token,p_outcome,p_code,
    p_formulario_ativo,p_inicio_em,p_propostas_ativo,p_historico_verificado_em,p_historico_cobertura_inicio_em,p_ultima_interacao_em,p_historico_completo); end if;
  perform 1 from public.leads where id=v_lead for update;
  if not found then return null; end if;
  perform 1 from public.whatsapp_propostas_automaticas where lead_id=v_lead for update;
  select * into v from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token for update;
  if not found then return null; end if;
  if p_outcome='started' then
    if v.estado not in ('reservado','enviando') or p_inicial_ativo is not true then return null; end if;
    v_recusa:=public.recusa_proposta_inicial_whatsapp(p_id,v_agora);
    if v.lease_ate<=v_agora or v.expira_em<=v_agora then v_recusa:='prazo_expirado'; end if;
    if v_recusa is not null then
      update public.whatsapp_outbox set estado=case when iniciado_em is null then 'cancelado' else 'indeterminado' end,
        ultimo_codigo=v_recusa where id=p_id;
      update public.whatsapp_propostas_automaticas set estado=case when v.iniciado_em is null then 'cancelada' else 'indeterminado' end,
        ultimo_codigo=v_recusa where lead_id=v_lead;
      return null;
    end if;
    update public.whatsapp_outbox set estado='enviando',iniciado_em=coalesce(iniciado_em,v_agora),
      lease_ate=coalesce(iniciado_em,v_agora)+interval '240 seconds' where id=p_id;
    return 'enviando';
  end if;
  if p_outcome='sent' and v.iniciado_em is not null and v.estado in ('enviando','indeterminado','enviado') then
    v_sent:=coalesce(v.enviado_em,v_agora);
    update public.whatsapp_outbox set estado='enviado',enviado_em=v_sent,ultimo_codigo=null where id=p_id;
    update public.leads l set enviado_em=coalesce(l.enviado_em,v_sent),
      status=case when l.status::text='aguardando_revisao' and l.respostas=p.respostas
        and l.categoria::text=p.categoria then 'enviado' else l.status end
      from public.whatsapp_propostas_automaticas p where l.id=v_lead and p.lead_id=l.id;
    update public.whatsapp_propostas_automaticas set estado='enviado',ultimo_codigo=null where lead_id=v_lead;
    return 'enviado';
  end if;
  if p_outcome in ('failed','indeterminate') and v.estado in ('enviando','indeterminado') then
    update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo=coalesce(p_code,'resultado_indeterminado') where id=p_id;
    update public.whatsapp_propostas_automaticas set estado='indeterminado',ultimo_codigo='resultado_indeterminado' where lead_id=v_lead;
    return 'indeterminado';
  end if;
  if p_outcome='failed' and v.estado='reservado' then
    v_recusa:=case when v.expira_em<=v_agora or v.tentativas>=5 then 'expirado' else 'pendente' end;
    update public.whatsapp_outbox set estado=v_recusa,lease_token=null,lease_ate=null,
      proxima_tentativa_em=v_agora+interval '5 minutes',ultimo_codigo=coalesce(p_code,'falha_antes_envio') where id=p_id;
    return v_recusa;
  end if;
  return null;
end;
$$;

revoke execute on function public.reivindicar_preparo_proposta_whatsapp(boolean),
  public.falhar_preparo_proposta_whatsapp(uuid,uuid,text,boolean),
  public.concluir_preparo_proposta_whatsapp(uuid,uuid,text,text,text),
  public.recusa_proposta_inicial_whatsapp(uuid,timestamptz),
  public.reivindicar_whatsapp_v5(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v5(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  from public,anon,authenticated;
grant execute on function public.reivindicar_preparo_proposta_whatsapp(boolean),
  public.falhar_preparo_proposta_whatsapp(uuid,uuid,text,boolean),
  public.concluir_preparo_proposta_whatsapp(uuid,uuid,text,text,text),
  public.recusa_proposta_inicial_whatsapp(uuid,timestamptz),
  public.reivindicar_whatsapp_v5(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v5(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  to service_role;
commit;

-- RF-25: lembrete de formulario em seis horas e nao perturbe (16/10/2026).
-- Finalize o formulario: seis horas desde a ultima resposta salva.
-- Aplicar DEPOIS de whatsapp-testes-owner.sql e whatsapp-proposta-inicial.sql. Nao habilita flags.
-- O identificador historico lembrete_formulario_24h permanece opaco.
-- Somente o protocolo 5/RPC V6 pode iniciar esta sequencia.
begin;

-- Fast default conservador para leads anteriores: instante de instalacao.
-- Sem UPDATE em massa: preserva updated_at e demais triggers/metadados existentes.
-- O corte de ativacao exclui todos esses leads anteriores dos envios novos.
alter table public.leads add column if not exists formulario_ultima_atividade_em timestamptz not null default now();

create or replace function public.registrar_atividade_formulario()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  if tg_op='INSERT' then
    new.formulario_ultima_atividade_em:=clock_timestamp();
  elsif new.status::text='incompleto' and (new.categoria is distinct from old.categoria
    or new.respostas is distinct from old.respostas or new.passo_atual is distinct from old.passo_atual) then
    new.formulario_ultima_atividade_em:=greatest(old.formulario_ultima_atividade_em,clock_timestamp());
  else
    -- Campo controlado pelo servidor: metadados e timestamp recebido nao mudam o prazo.
    new.formulario_ultima_atividade_em:=old.formulario_ultima_atividade_em;
  end if;
  return new;
end;
$$;
drop trigger if exists leads_registrar_atividade_formulario on public.leads;
create trigger leads_registrar_atividade_formulario before insert or update on public.leads
  for each row execute function public.registrar_atividade_formulario();

create or replace function public.horario_lembrete_formulario_permitido(p_agora timestamptz)
returns boolean language sql immutable security invoker set search_path=pg_catalog
as $$
  select coalesce(isfinite(p_agora) and (p_agora at time zone 'America/Sao_Paulo')::time>=time '08:00'
    and (p_agora at time zone 'America/Sao_Paulo')::time<time '21:00',false);
$$;

-- Converte apenas o vencimento que cai em nao perturbe. 08h e permitido, 21h e bloqueado.
create or replace function public.proximo_horario_lembrete_formulario(p_agora timestamptz)
returns timestamptz language sql immutable security invoker set search_path=pg_catalog
as $$
  select case when p_agora is null or not isfinite(p_agora) then null
    when (p_agora at time zone 'America/Sao_Paulo')::time>=time '21:00'
      then (((p_agora at time zone 'America/Sao_Paulo')::date+1)+time '09:00') at time zone 'America/Sao_Paulo'
    when (p_agora at time zone 'America/Sao_Paulo')::time<time '08:00'
      then (((p_agora at time zone 'America/Sao_Paulo')::date)+time '09:00') at time zone 'America/Sao_Paulo'
    else p_agora end;
$$;
create or replace function public.prazo_lembrete_formulario(p_ultima_atividade_em timestamptz)
returns timestamptz language sql immutable security invoker set search_path=pg_catalog
as $$ select public.proximo_horario_lembrete_formulario(p_ultima_atividade_em+interval '6 hours'); $$;

-- Rollback nunca volta a produzir nem iniciar o lembrete de 24 horas.
create or replace function public.enfileirar_lembretes_formulario_whatsapp_v3(
  p_inicio_em timestamptz,p_mensagens jsonb,p_app_url text
)
returns integer language sql security invoker set search_path=pg_catalog
as $$ select 0; $$;
create or replace function public.reivindicar_whatsapp_v3(p_lembrete_ativo boolean,p_inicio_em timestamptz)
returns setof public.whatsapp_outbox language sql security invoker set search_path=pg_catalog
as $$ select o.* from public.whatsapp_outbox o where false; $$;

-- V3 mantem apenas resultados finais historicos; nenhum STARTED legado e aceito.
create or replace function public.resultado_whatsapp_v3(
  p_id uuid,p_lease_token uuid,p_outcome text,p_code text,p_lembrete_ativo boolean,p_inicio_em timestamptz
)
returns text language plpgsql security invoker set search_path=pg_catalog
as $$
declare v public.whatsapp_outbox%rowtype; v_agora timestamptz:=statement_timestamp();
begin
  if p_outcome='started' then return null; end if;
  select o.* into v from public.whatsapp_outbox o where o.id=p_id and o.lease_token=p_lease_token for update;
  if not found then return null; end if;
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


-- V4 preserva os lembretes manuais e nao toca na fila de formulario.
create or replace function public.reivindicar_whatsapp_v4(
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean
)
returns setof public.whatsapp_outbox language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp(); v_leads uuid[];
begin
  select coalesce(array_agg(p.id),array[]::uuid[]) into v_leads from (
    select l.id from public.leads l where exists(select 1 from public.whatsapp_outbox o
      where o.lead_id=l.id and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
        and o.estado in ('pendente','reservado','enviando'))
    order by l.id for update of l skip locked) p;
  update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio'
    where tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and lead_id=any(v_leads) and estado='enviando' and lease_ate<=v_agora;
  update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,ultimo_codigo='lease_expirado_antes_envio'
    where tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and lead_id=any(v_leads) and estado='reservado' and lease_ate<=v_agora;
  -- Um job marcado para teste nunca perde silenciosamente a validade temporaria.
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='teste_owner_expirado'
    where o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.teste_owner_expira_em is not null
      and (o.teste_owner_expira_em<>timestamptz '2026-10-17T18:00:00Z'
        or not public.teste_proposta_whatsapp_valido(o.lead_id,o.tipo,o.proposta_enviado_em,
          o.proposta_pdf_url,o.destinatario,v_agora));
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='proposta_condicao_alterada'
    where o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
      and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is not null;
  update public.whatsapp_outbox set estado='expirado',lease_token=null,lease_ate=null,
    ultimo_codigo=case when tentativas>=5 then 'limite_tentativas' else 'prazo_expirado' end
    where tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and lead_id=any(v_leads) and estado in ('pendente','reservado')
      and (expira_em<=v_agora or (estado='pendente' and tentativas>=5));
  return query with candidato as (
    select o.id from public.whatsapp_outbox o join public.leads l on l.id=o.lead_id
    where l.id=any(v_leads) and o.estado='pendente' and o.expira_em>v_agora
      and o.proxima_tentativa_em<=v_agora and o.tentativas<5
      and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and p_propostas_ativo is true
      and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is null
    order by o.ocorrido_em,o.id limit 1 for update of o skip locked
  ) update public.whatsapp_outbox o set estado='reservado',lease_token=gen_random_uuid(),
    lease_ate=v_agora+interval '90 seconds',tentativas=o.tentativas+1,proxima_tentativa_em=v_agora+interval '5 minutes'
    from candidato c where o.id=c.id returning o.*;
end;
$$;
revoke execute on function public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean) from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean) to service_role;


create or replace function public.enfileirar_lembretes_formulario_whatsapp_v6(
  p_inicio_em timestamptz,p_mensagens jsonb,p_app_url text
)
returns integer language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp();
  v_base text:=regexp_replace(p_app_url,'/+$','');
  v_link text:=v_base||'/continuar/00000000-0000-4000-8000-000000000000';
  v_texto text:=(p_mensagens#>>'{0,message}')||E'\n\n'||(p_mensagens#>>'{1,message}')||E'\n\n'||(p_mensagens#>>'{2,message}')||E'\n\n';
  v_quantidade integer;
begin
  if p_inicio_em is null or not isfinite(p_inicio_em) or p_inicio_em>v_agora
    or p_app_url is null or p_app_url!~'^https://[^[:space:]/?#@]+/*$'
    or not public.sequencia_lembrete_formulario_valida(p_mensagens||jsonb_build_array(
      jsonb_build_object('message',v_link,'delayBeforeSeconds',2)),
      '00000000-0000-4000-8000-000000000000',v_texto||v_link) then return 0; end if;
  -- Pode registrar enquanto aguarda 09h, mas nunca cria fila antes das seis horas.
  with candidatos as materialized(
    select l.id,public.destinatario_whatsapp_br(l.whatsapp) as destinatario,
      public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em) as prazo
      from public.leads l
      where l.status::text='incompleto' and l.created_at>=p_inicio_em
        and l.formulario_ultima_atividade_em<=v_agora-interval '6 hours'
        and isfinite(l.formulario_ultima_atividade_em)
        and public.destinatario_whatsapp_br(l.whatsapp) is not null
        and not exists(select 1 from public.whatsapp_outbox o
          where o.lead_id=l.id and o.tipo='lembrete_formulario_24h')
      order by l.formulario_ultima_atividade_em,l.id limit 50 for update of l skip locked
  )
  insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,proxima_tentativa_em)
    select c.id,'lembrete_formulario_24h',v_agora,v_agora+interval '24 hours',c.destinatario,
      v_texto||v_base||'/continuar/'||c.id::text,
      p_mensagens||jsonb_build_array(jsonb_build_object('message',v_base||'/continuar/'||c.id::text,'delayBeforeSeconds',2)),
      greatest(c.prazo,public.proximo_horario_lembrete_formulario(v_agora))
    from candidatos c on conflict(lead_id,tipo) where tipo in('confirmacao_recebimento','lembrete_formulario_24h') do nothing;
  get diagnostics v_quantidade=row_count;
  return v_quantidade;
end;
$$;

create or replace function public.reivindicar_whatsapp_v6(
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,p_inicial_ativo boolean
)
returns setof public.whatsapp_outbox language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp(); v_anterior public.whatsapp_outbox%rowtype;
  v_leads uuid[]; v_id uuid;
begin
  -- A regra noturna vale para o lembrete de formulario; demais tipos mantem V5.
  select * into v_anterior from public.reivindicar_whatsapp_v5(false,null,p_propostas_ativo,p_inicial_ativo);
  if found then return next v_anterior; return; end if;
  if p_formulario_ativo is not true or p_inicio_em is null or not isfinite(p_inicio_em)
    or p_inicio_em>v_agora then return; end if;
  select coalesce(array_agg(p.id),array[]::uuid[]) into v_leads from(
    select l.id from public.leads l where exists(select 1 from public.whatsapp_outbox o
      where o.lead_id=l.id and o.tipo='lembrete_formulario_24h' and o.estado in('pendente','reservado','enviando'))
      order by l.id for update of l skip locked)p;
  update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio'
    where lead_id=any(v_leads) and tipo='lembrete_formulario_24h' and estado='enviando' and lease_ate<=v_agora;
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='lead_ou_contato_alterado'
    from public.leads l where l.id=o.lead_id and l.id=any(v_leads) and o.tipo='lembrete_formulario_24h'
      and o.estado in('pendente','reservado') and (l.status::text<>'incompleto' or l.created_at<p_inicio_em
        or not isfinite(l.formulario_ultima_atividade_em)
        or o.destinatario is distinct from public.destinatario_whatsapp_br(l.whatsapp)
        or not public.sequencia_lembrete_formulario_valida(o.sequencia,o.lead_id,o.mensagem));
  -- Nova resposta ou nao perturbe antes do envio apenas adia. Nao gasta tentativas,
  -- nem deixa o TTL antigo vencer enquanto o prazo de seis horas estiver correndo.
  update public.whatsapp_outbox o set estado='pendente',lease_token=null,lease_ate=null,
    tentativas=greatest(0,o.tentativas-case when o.estado='reservado' then 1 else 0 end),
    proxima_tentativa_em=greatest(o.proxima_tentativa_em,
      public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em),public.proximo_horario_lembrete_formulario(v_agora)),
    ocorrido_em=v_agora,expira_em=v_agora+interval '24 hours',ultimo_codigo='formulario_aguardando_horario'
    from public.leads l where l.id=o.lead_id and l.id=any(v_leads) and o.tipo='lembrete_formulario_24h'
      and o.estado in('pendente','reservado') and o.iniciado_em is null
      and (public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em)>v_agora
        or not public.horario_lembrete_formulario_permitido(v_agora));
  update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,ultimo_codigo='lease_expirado_antes_envio'
    where lead_id=any(v_leads) and tipo='lembrete_formulario_24h' and estado='reservado' and lease_ate<=v_agora;
  update public.whatsapp_outbox set estado='expirado',lease_token=null,lease_ate=null,
    ultimo_codigo=case when tentativas>=5 then 'limite_tentativas' else 'prazo_expirado' end
    where lead_id=any(v_leads) and tipo='lembrete_formulario_24h' and estado in('pendente','reservado')
      and (expira_em<=v_agora or (estado='pendente' and tentativas>=5));
  if not public.horario_lembrete_formulario_permitido(v_agora) then return; end if;
  select o.id into v_id from public.whatsapp_outbox o join public.leads l on l.id=o.lead_id
    where l.id=any(v_leads) and o.tipo='lembrete_formulario_24h' and o.estado='pendente'
      and o.iniciado_em is null and o.expira_em>v_agora and o.proxima_tentativa_em<=v_agora and o.tentativas<5
      and l.status::text='incompleto' and l.created_at>=p_inicio_em
      and public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em)<=v_agora
      and o.destinatario=public.destinatario_whatsapp_br(l.whatsapp)
      and public.sequencia_lembrete_formulario_valida(o.sequencia,o.lead_id,o.mensagem)
    order by o.ocorrido_em,o.id limit 1 for update of o skip locked;
  if found then
    return query update public.whatsapp_outbox set estado='reservado',lease_token=gen_random_uuid(),
      lease_ate=v_agora+interval '90 seconds',tentativas=tentativas+1,
      proxima_tentativa_em=v_agora+interval '5 minutes' where id=v_id returning *;
  end if;
end;
$$;

create or replace function public.resultado_whatsapp_v6(
  p_id uuid,p_lease_token uuid,p_outcome text,p_code text,
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,p_inicial_ativo boolean,
  p_historico_verificado_em timestamptz,p_historico_cobertura_inicio_em timestamptz,
  p_ultima_interacao_em timestamptz,p_historico_completo boolean
)
returns text language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v public.whatsapp_outbox%rowtype; l public.leads%rowtype;
  v_lead uuid; v_tipo text; v_agora timestamptz:=statement_timestamp(); v_prazo timestamptz; v_recusa text;
begin
  select lead_id,tipo into v_lead,v_tipo from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token;
  if not found then return null; end if;
  if v_tipo<>'lembrete_formulario_24h' then
    return public.resultado_whatsapp_v5(p_id,p_lease_token,p_outcome,p_code,false,null,
      p_propostas_ativo,p_inicial_ativo,p_historico_verificado_em,p_historico_cobertura_inicio_em,
      p_ultima_interacao_em,p_historico_completo);
  end if;
  -- O worker tambem pode perceber o nao perturbe ANTES de pedir STARTED.
  -- Persistir09h aqui evita reabrir o envio08h30 apos uma noite sem worker.
  if p_outcome='failed' and p_code='formulario_nao_perturbe' then
    select * into l from public.leads where id=v_lead for update;
    if not found then return null; end if;
    select * into v from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token for update;
    if not found then return null; end if;
    if v.estado='reservado' and v.iniciado_em is null then
      update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,
        tentativas=greatest(0,tentativas-1),
        proxima_tentativa_em=greatest(public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em),
          public.proximo_horario_lembrete_formulario(v_agora)),
        ocorrido_em=v_agora,expira_em=v_agora+interval '24 hours',ultimo_codigo='formulario_aguardando_horario' where id=p_id;
      return 'pendente';
    end if;
  end if;
  -- Resultados terminais preservam a reconciliacao historica/ACK mesmo sem flags.
  if p_outcome<>'started' then
    return public.resultado_whatsapp_v3(p_id,p_lease_token,p_outcome,p_code,false,null);
  end if;
  select * into l from public.leads where id=v_lead for update;
  if not found then return null; end if;
  select * into v from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token for update;
  if not found or v.estado not in('reservado','enviando') then return null; end if;
  if p_formulario_ativo is not true or p_inicio_em is null or not isfinite(p_inicio_em) or p_inicio_em>v_agora then
    v_recusa:='formulario_desativado';
  elsif l.status::text<>'incompleto' or l.created_at<p_inicio_em
    or v.destinatario is distinct from public.destinatario_whatsapp_br(l.whatsapp)
    or not public.sequencia_lembrete_formulario_valida(v.sequencia,v.lead_id,v.mensagem)
    or not isfinite(l.formulario_ultima_atividade_em) then
    v_recusa:='lead_ou_contato_alterado';
  elsif v.lease_ate<=v_agora then v_recusa:='lease_expirado_antes_envio'; end if;
  v_prazo:=greatest(public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em),
    public.proximo_horario_lembrete_formulario(v_agora));
  if v_recusa is null and (v_prazo>v_agora or not public.horario_lembrete_formulario_permitido(v_agora)) then
    if v.iniciado_em is not null then
      update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='formulario_horario_ou_atividade_alterado' where id=p_id;
    else
      update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,
        tentativas=greatest(0,tentativas-1),proxima_tentativa_em=v_prazo,
        ocorrido_em=v_agora,expira_em=v_agora+interval '24 hours',ultimo_codigo='formulario_aguardando_horario' where id=p_id;
    end if;
    return null;
  end if;
  if v_recusa is null and v.expira_em<=v_agora then v_recusa:='prazo_expirado'; end if;
  if v_recusa is not null then
    update public.whatsapp_outbox set estado=case when iniciado_em is not null then 'indeterminado' else 'cancelado' end,
      ultimo_codigo=v_recusa where id=p_id;
    return null;
  end if;
  -- proxima_tentativa_em e o cooldown da reserva; o prazo real foi revalidado acima.
  update public.whatsapp_outbox set estado='enviando',iniciado_em=coalesce(iniciado_em,v_agora),
    lease_ate=coalesce(iniciado_em,v_agora)+interval '180 seconds' where id=p_id;
  return 'enviando';
end;
$$;

revoke execute on function public.registrar_atividade_formulario(),
  public.horario_lembrete_formulario_permitido(timestamptz),public.proximo_horario_lembrete_formulario(timestamptz),
  public.prazo_lembrete_formulario(timestamptz),
  public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz,jsonb,text),
  public.reivindicar_whatsapp_v3(boolean,timestamptz),
  public.enfileirar_lembretes_formulario_whatsapp_v6(timestamptz,jsonb,text),
  public.reivindicar_whatsapp_v6(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v6(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  from public,anon,authenticated;
grant execute on function public.registrar_atividade_formulario(),
  public.horario_lembrete_formulario_permitido(timestamptz),public.proximo_horario_lembrete_formulario(timestamptz),
  public.prazo_lembrete_formulario(timestamptz),
  public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz,jsonb,text),
  public.reivindicar_whatsapp_v3(boolean,timestamptz),
  public.enfileirar_lembretes_formulario_whatsapp_v6(timestamptz,jsonb,text),
  public.reivindicar_whatsapp_v6(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v6(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  to service_role;
commit;
