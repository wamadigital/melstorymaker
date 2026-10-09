-- Executar SOMENTE em um Postgres isolado com schema.sql aplicado.
-- psql -v ON_ERROR_STOP=1 -f supabase/crm-outbox.test.sql
-- Todas as linhas ficticias abaixo ficam dentro de ROLLBACK.
begin;

do $$
declare
  id_teste uuid := gen_random_uuid();
  id_expirado uuid := gen_random_uuid();
  primeiro public.meta_crm_outbox;
  repetido public.meta_crm_outbox;
  n integer;
  original public.meta_crm_outbox;
begin
  if not (select relrowsecurity from pg_class where oid = 'public.meta_crm_outbox'::regclass) then
    raise exception 'Outbox precisa de RLS';
  end if;
  if has_table_privilege('anon', 'public.meta_crm_outbox', 'SELECT')
    or has_table_privilege('authenticated', 'public.meta_crm_outbox', 'UPDATE')
    or has_function_privilege('anon', 'public.reivindicar_meta_crm(uuid)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.reivindicar_meta_crm(uuid)', 'EXECUTE') then
    raise exception 'Outbox/RPC ficaram publicos';
  end if;

  insert into public.leads(id, categoria, whatsapp, respostas)
    values(id_teste, 'casamento', '11999998888', '{"nome":"Pessoa ficticia","campo_privado":"nao enviar"}');
  select * into original from public.meta_crm_outbox where lead_id = id_teste;
  if original.event_id is null or original.evento <> 'CRMLeadCriado' or original.snapshot ? 'respostas'
    or original.snapshot::text like '%campo_privado%' then
    raise exception 'Nascimento deve registrar somente dados de contato minimos';
  end if;

  -- Um rollback da mudanca do lead desfaz tambem o registro do fato.
  begin
    update public.leads set qualificado_em = statement_timestamp() where id = id_teste;
    raise exception using errcode = 'P0002', message = 'rollback ficticio';
  exception when no_data_found then null;
  end;
  if exists(select 1 from public.meta_crm_outbox where lead_id = id_teste and etapa = 'qualificado')
    or exists(select 1 from public.leads where id = id_teste and qualificado_em is not null) then
    raise exception 'Lead e fato devem reverter na mesma transacao';
  end if;

  update public.leads set rastreio = '{"fbc":"fb.1.1234567890123.clique-ficticio","ua":"lead-ficticio"}' where id = id_teste;
  update public.leads set status = 'aguardando_revisao' where id = id_teste;
  update public.leads set qualificado_em = statement_timestamp() where id = id_teste;
  update public.leads set qualificado_em = null where id = id_teste;
  update public.leads set qualificado_em = statement_timestamp() where id = id_teste;
  update public.leads set status = 'enviado' where id = id_teste;
  update public.leads set status = 'aguardando_revisao' where id = id_teste;
  update public.leads set status = 'enviado' where id = id_teste;
  update public.leads set status = 'esfriou' where id = id_teste;
  update public.leads set status = 'virou_cliente' where id = id_teste;
  update public.leads set status = 'perdido' where id = id_teste;
  select count(*) into n from public.meta_crm_outbox where lead_id = id_teste;
  if n <> 6 then raise exception 'Esperados seis fatos unicos, encontrado %', n; end if;
  if (select count(*) from public.meta_crm_outbox where lead_id = id_teste and etapa = 'qualificado') <> 1 then
    raise exception 'Requalificacao nao deve duplicar a primeira ocorrencia';
  end if;

  -- Apenas service_role pode reivindicar e atualizar a fila.
  set local role service_role;
  select * into primeiro from public.reivindicar_meta_crm(id_teste);
  if primeiro.event_id is null or primeiro.estado <> 'processando' or primeiro.tentativas <> 1 or primeiro.lease_token is null
    or primeiro.snapshot -> 'rastreio' ->> 'ua' <> 'lead-ficticio'
    or primeiro.proxima_tentativa_em <= statement_timestamp() then
    raise exception 'Claim precisa de lease e do rastreio original antes do envio';
  end if;
  -- Ignora demais fatos para testar so o mesmo evento durante a lease.
  update public.meta_crm_outbox set proxima_tentativa_em = statement_timestamp() + interval '2 days'
    where lead_id = id_teste and event_id <> primeiro.event_id;
  update public.meta_crm_outbox set proxima_tentativa_em = statement_timestamp() - interval '1 second'
    where event_id = primeiro.event_id;
  select count(*) into n from public.reivindicar_meta_crm(id_teste);
  if n <> 0 then raise exception 'Lease ativa permitiu outra reivindicacao'; end if;
  update public.leads set rastreio = '{"ua":"outro-navegador"}', whatsapp = '11888887777' where id = id_teste;
  update public.meta_crm_outbox set lease_ate = statement_timestamp() - interval '1 second',
    proxima_tentativa_em = statement_timestamp() + interval '15 minutes'
    where event_id = primeiro.event_id;
  select count(*) into n from public.reivindicar_meta_crm(id_teste);
  if n <> 0 then raise exception 'Lease expirada nao deve ignorar backoff pre-agendado'; end if;
  update public.meta_crm_outbox set proxima_tentativa_em = statement_timestamp() - interval '1 second'
    where event_id = primeiro.event_id;
  select * into repetido from public.reivindicar_meta_crm(id_teste);
  if not found or repetido.event_id is null or repetido.tentativas <> 2 or repetido.lease_token = primeiro.lease_token
    or repetido.snapshot is distinct from primeiro.snapshot
    or repetido.ocorrido_em is distinct from primeiro.ocorrido_em
    or repetido.event_id is distinct from primeiro.event_id then
    raise exception 'Recuperacao da lease alterou identidade, horario ou snapshot';
  end if;
  update public.meta_crm_outbox set estado = 'enviado' where event_id = repetido.event_id and lease_token = primeiro.lease_token;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'Worker antigo confirmou evento de outra lease'; end if;
  update public.meta_crm_outbox set estado = 'pendente', lease_token = null, lease_ate = null,
    proxima_tentativa_em = statement_timestamp() + interval '1 hour' where event_id = repetido.event_id;
  select count(*) into n from public.reivindicar_meta_crm(id_teste);
  if n <> 0 then raise exception 'Backoff foi ignorado'; end if;

  insert into public.leads(id, categoria, whatsapp) values(id_expirado, 'casamento', '11999997777');
  update public.meta_crm_outbox set ocorrido_em = statement_timestamp() - interval '48 hours' where lead_id = id_expirado;
  select count(*) into n from public.reivindicar_meta_crm(id_expirado);
  if n <> 0 or (select estado from public.meta_crm_outbox where lead_id = id_expirado) <> 'encerrado' then
    raise exception 'Evento expirado foi reenviado';
  end if;
  update public.meta_crm_outbox set ocorrido_em = statement_timestamp(), estado = 'pendente', tentativas = 5 where lead_id = id_expirado;
  select count(*) into n from public.reivindicar_meta_crm(id_expirado);
  if n <> 0 or (select ultimo_erro from public.meta_crm_outbox where lead_id = id_expirado) <> 'limite_tentativas' then
    raise exception 'Limite de tentativas foi ignorado';
  end if;
  reset role;
  raise notice 'CRM SQL: atomicidade, seis fatos, RLS, lease, backoff, snapshot, ID/horario e limites validados';
end;
$$;

rollback;
