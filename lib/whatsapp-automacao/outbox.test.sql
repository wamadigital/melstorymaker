-- SOMENTE banco isolado com leads(id,status,whatsapp) e roles Supabase.
-- Aplicar whatsapp-outbox.sql antes. psql -v ON_ERROR_STOP=1 -f este_arquivo.
-- Nenhum servico externo. Os dados ficticios e as alteracoes terminam em rollback.
begin;
set local timezone = 'UTC';

insert into public.leads (id, status, whatsapp) values
  ('c350bc94-24f1-4359-9e92-eac5f1a76e44', 'aguardando_revisao', '19988887777'),
  ('d350bc94-24f1-4359-9e92-eac5f1a76e44', 'aguardando_revisao', '19988887777');

do $$
begin
  if not (select relrowsecurity from pg_class where oid = 'public.whatsapp_outbox'::regclass)
    or exists (select 1 from pg_policy where polrelid = 'public.whatsapp_outbox'::regclass)
    or has_table_privilege('anon', 'public.whatsapp_outbox', 'SELECT')
    or has_table_privilege('authenticated', 'public.whatsapp_outbox', 'SELECT')
    or not has_table_privilege('service_role', 'public.whatsapp_outbox', 'SELECT,INSERT,UPDATE,DELETE')
    or has_function_privilege('anon', 'public.reivindicar_whatsapp()', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.resultado_whatsapp(uuid,uuid,text,text)', 'EXECUTE')
    or exists (select 1 from pg_proc where oid in
      ('public.registrar_confirmacao_whatsapp(uuid,text,text,timestamptz)'::regprocedure,
       'public.reivindicar_whatsapp()'::regprocedure,
       'public.resultado_whatsapp(uuid,uuid,text,text)'::regprocedure)
      and (prosecdef or proconfig is distinct from array['search_path=pg_catalog'])) then
    raise exception 'RLS, grants ou funcoes invoker invalidos';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  primeiro uuid;
  repetido uuid;
  job public.whatsapp_outbox%rowtype;
  carimbo timestamptz;
  quantidade integer;
begin
  primeiro := public.registrar_confirmacao_whatsapp(
    'c350bc94-24f1-4359-9e92-eac5f1a76e44', '5519988887777', 'Copia ficticia original', statement_timestamp());
  repetido := public.registrar_confirmacao_whatsapp(
    'c350bc94-24f1-4359-9e92-eac5f1a76e44', '5519988887777', 'Copia nao deve substituir original', statement_timestamp());
  if primeiro is null or repetido is distinct from primeiro or
    (select count(*) from public.whatsapp_outbox) <> 1 or
    (select mensagem from public.whatsapp_outbox where id = primeiro) <> 'Copia ficticia original' then
    raise exception 'Deduplicacao/snapshot invalido';
  end if;
  select * into job from public.reivindicar_whatsapp();
  if not found or job.id is distinct from primeiro or job.tentativas <> 1 or job.lease_token is null then
    raise exception 'Claim invalido';
  end if;
  if exists(select 1 from public.reivindicar_whatsapp()) or
    public.resultado_whatsapp(job.id, gen_random_uuid(), 'started') is not null or
    public.resultado_whatsapp(job.id, job.lease_token, 'sent') is not null then
    raise exception 'Lease ou ordem started burlada';
  end if;
  if public.resultado_whatsapp(job.id, job.lease_token, 'started') is distinct from 'enviando' or
    public.resultado_whatsapp(job.id, job.lease_token, 'started') is distinct from 'enviando' then
    raise exception 'Started/idempotencia invalido';
  end if;
  update public.whatsapp_outbox set lease_ate = statement_timestamp() - interval '1 second' where id = job.id;
  select count(*) into quantidade from public.reivindicar_whatsapp();
  if quantidade <> 0 or
    (select estado from public.whatsapp_outbox where id = job.id) <> 'indeterminado' or
    public.resultado_whatsapp(job.id, job.lease_token, 'started') is not null then
    raise exception 'Envio indeterminado seria repetido';
  end if;
  if public.resultado_whatsapp(job.id, job.lease_token, 'sent') is distinct from 'enviado' then
    raise exception 'ACK tardio foi perdido';
  end if;
  select enviado_em into carimbo from public.whatsapp_outbox where id = job.id;
  perform public.resultado_whatsapp(job.id, job.lease_token, 'sent');
  if carimbo is null or (select enviado_em from public.whatsapp_outbox where id = job.id) is distinct from carimbo then
    raise exception 'ACK repetido alterou o fato';
  end if;
end;
$$;
reset role;

-- Claim revalida status e contato; os seis status reais nao incluem arquivo/cancelamento.
update public.leads set status = 'enviado' where id = 'd350bc94-24f1-4359-9e92-eac5f1a76e44';
do $$
begin
  if public.registrar_confirmacao_whatsapp('d350bc94-24f1-4359-9e92-eac5f1a76e44',
    '5519988887777', 'Ficticia', statement_timestamp()) is not null then raise exception 'Registrou fechado'; end if;
end;
$$;
update public.leads set status = 'aguardando_revisao' where id = 'd350bc94-24f1-4359-9e92-eac5f1a76e44';

do $$
declare
  job public.whatsapp_outbox%rowtype;
  retorno text;
  quantidade integer;
  token_anterior uuid;
begin
  perform public.registrar_confirmacao_whatsapp('d350bc94-24f1-4359-9e92-eac5f1a76e44',
    '5519988887777', 'Ficticia', statement_timestamp());
  select * into job from public.reivindicar_whatsapp();
  if not found then raise exception 'Fixture nao foi reivindicada'; end if;
  update public.leads set status = 'virou_cliente' where id = job.lead_id;
  retorno := public.resultado_whatsapp(job.id, job.lease_token, 'started');
  if retorno is not null or
    (select estado from public.whatsapp_outbox where id = job.id) <> 'cancelado' then
    raise exception 'Started autorizou lead fechado';
  end if;
  update public.leads set status = 'aguardando_revisao' where id = job.lead_id;
  update public.whatsapp_outbox set estado = 'pendente', lease_token = null, lease_ate = null,
    proxima_tentativa_em = statement_timestamp() where id = job.id;
  update public.leads set whatsapp = '19977776666' where id = job.lead_id;
  select count(*) into quantidade from public.reivindicar_whatsapp();
  if quantidade <> 0 or
    (select estado from public.whatsapp_outbox where id = job.id) <> 'cancelado' then
    raise exception 'Claim autorizou contato alterado';
  end if;
  update public.leads set whatsapp = '19988887777' where id = job.lead_id;
  update public.whatsapp_outbox set estado = 'pendente',
    ocorrido_em = statement_timestamp() - interval '24 hours', expira_em = statement_timestamp() where id = job.id;
  select count(*) into quantidade from public.reivindicar_whatsapp();
  if quantidade <> 0 or
    (select estado from public.whatsapp_outbox where id = job.id) <> 'expirado' then
    raise exception 'Claim autorizou mensagem com 24h';
  end if;

  -- Lease anterior ao started pode recuperar, respeitando due e trocando token.
  update public.whatsapp_outbox set estado = 'pendente', tentativas = 0,
    ocorrido_em = statement_timestamp(), expira_em = statement_timestamp() + interval '24 hours',
    proxima_tentativa_em = statement_timestamp() where id = job.id;
  select * into job from public.reivindicar_whatsapp();
  if not found then raise exception 'Fixture pre-start nao foi reivindicada'; end if;
  token_anterior := job.lease_token;
  update public.whatsapp_outbox set lease_ate = statement_timestamp() - interval '1 second' where id = job.id;
  select count(*) into quantidade from public.reivindicar_whatsapp();
  if quantidade <> 0 or (select estado from public.whatsapp_outbox where id = job.id) <> 'pendente' then
    raise exception 'Lease pre-start nao respeitou backoff';
  end if;
  update public.whatsapp_outbox set proxima_tentativa_em = statement_timestamp() where id = job.id;
  select * into job from public.reivindicar_whatsapp();
  if not found or job.tentativas <> 2 or job.lease_token is not distinct from token_anterior or
    public.resultado_whatsapp(job.id, token_anterior, 'started') is not null then
    raise exception 'Claim de recuperacao ou token anterior invalido';
  end if;

  -- A quinta tentativa ainda tem direito ao started; so expira quando abandonada.
  update public.whatsapp_outbox set estado = 'pendente', tentativas = 4,
    ocorrido_em = statement_timestamp(), expira_em = statement_timestamp() + interval '24 hours',
    proxima_tentativa_em = statement_timestamp() where id = job.id;
  select * into job from public.reivindicar_whatsapp();
  if not found or job.tentativas <> 5 then raise exception 'Fixture da quinta tentativa invalida'; end if;
  perform public.reivindicar_whatsapp();
  if public.resultado_whatsapp(job.id, job.lease_token, 'started') is distinct from 'enviando' then
    raise exception 'Quinta tentativa ativa foi cancelada';
  end if;
  if public.resultado_whatsapp(job.id, job.lease_token, 'failed', 'bridge_error') is distinct from 'indeterminado' or
    exists(select 1 from public.reivindicar_whatsapp()) then
    raise exception 'Falha depois started voltou para fila';
  end if;
end;
$$;

rollback;
