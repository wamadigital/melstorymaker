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
