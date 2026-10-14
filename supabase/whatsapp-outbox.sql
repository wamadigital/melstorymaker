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
