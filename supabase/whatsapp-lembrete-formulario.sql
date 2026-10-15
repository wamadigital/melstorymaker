-- Lembrete unico para formulario em Novo ha MAIS de 24 horas.
-- Aplicar DEPOIS de whatsapp-outbox.sql, em transacao. Nao ativa flags,
-- nao importa leads anteriores ao corte e nao altera status/carimbos do lead.
-- O mesmo bloco encerra schema.sql. RPCs antigos continuam confirmacao-only.

alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_tipo_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_tipo_check
  check (tipo in ('confirmacao_recebimento', 'lembrete_formulario_24h'));

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

create or replace function public.enfileirar_lembretes_formulario_whatsapp(
  p_inicio_em timestamptz, p_mensagem_prefixo text, p_app_url text
)
returns integer
language plpgsql security invoker
set search_path = pg_catalog
as $$
declare
  v_agora timestamptz := statement_timestamp();
  v_base text := regexp_replace(p_app_url, '/+$', '');
  v_quantidade integer;
begin
  if p_inicio_em is null or not isfinite(p_inicio_em) or p_inicio_em > v_agora
    or p_mensagem_prefixo is null or btrim(p_mensagem_prefixo) = ''
    or p_app_url is null or p_app_url !~ '^https://[^[:space:]/?#@]+/*$'
    or length(p_mensagem_prefixo) + length(v_base) + 11 + 36 > 2000 then
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
    (lead_id, tipo, ocorrido_em, expira_em, destinatario, mensagem)
  select c.id, 'lembrete_formulario_24h', v_agora, v_agora + interval '24 hours',
    c.destinatario, p_mensagem_prefixo || v_base || '/continuar/' || c.id::text
  from candidatos c
  on conflict (lead_id, tipo) do nothing;
  get diagnostics v_quantidade = row_count;
  return v_quantidade;
end;
$$;
revoke execute on function public.enfileirar_lembretes_formulario_whatsapp(timestamptz, text, text)
  from anon, authenticated, public;
grant execute on function public.enfileirar_lembretes_formulario_whatsapp(timestamptz, text, text) to service_role;

create or replace function public.reivindicar_whatsapp_v2(
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
        or (o.tipo = 'lembrete_formulario_24h' and v_ativo and l.status::text = 'incompleto'
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
revoke execute on function public.reivindicar_whatsapp_v2(boolean, timestamptz) from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp_v2(boolean, timestamptz) to service_role;

create or replace function public.resultado_whatsapp_v2(
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
    if v.tipo = 'lembrete_formulario_24h' and not v_ativo then return null; end if;
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
      iniciado_em = coalesce(iniciado_em, v_agora) where id = p_id;
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
revoke execute on function public.resultado_whatsapp_v2(uuid, uuid, text, text, boolean, timestamptz)
  from anon, authenticated, public;
grant execute on function public.resultado_whatsapp_v2(uuid, uuid, text, text, boolean, timestamptz) to service_role;

-- Sem overload/defaults novos: backend antigo nunca reivindica/inicia lembrete.
create or replace function public.reivindicar_whatsapp()
returns setof public.whatsapp_outbox
language sql security invoker
set search_path = pg_catalog
as $$ select * from public.reivindicar_whatsapp_v2(false, null); $$;
revoke execute on function public.reivindicar_whatsapp() from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp() to service_role;

create or replace function public.resultado_whatsapp(
  p_id uuid, p_lease_token uuid, p_outcome text, p_code text default null
)
returns text
language sql security invoker
set search_path = pg_catalog
as $$ select public.resultado_whatsapp_v2(p_id, p_lease_token, p_outcome, p_code, false, null); $$;
revoke execute on function public.resultado_whatsapp(uuid, uuid, text, text) from anon, authenticated, public;
grant execute on function public.resultado_whatsapp(uuid, uuid, text, text) to service_role;
