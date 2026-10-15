-- SOMENTE Postgres isolado. Requer roles anon/authenticated/service_role e
-- public.leads(id uuid primary key, status text, whatsapp text, created_at timestamptz).
-- service_role precisa SELECT/INSERT/UPDATE/DELETE em leads no fixture.
-- Aplicar whatsapp-outbox.sql e whatsapp-lembrete-formulario.sql antes.
-- psql -v ON_ERROR_STOP=1 -f este_arquivo. Nenhuma rede; tudo termina em rollback.
-- Fronteiras usam um unico DO: statement_timestamp() fica constante, sem sleeps.
begin;
set local timezone = 'UTC';

do $$
begin
  if has_function_privilege('anon', 'public.enfileirar_lembretes_formulario_whatsapp(timestamptz,text,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.reivindicar_whatsapp_v2(boolean,timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'public.resultado_whatsapp_v2(uuid,uuid,text,text,boolean,timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'public.destinatario_whatsapp_br(text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.enfileirar_lembretes_formulario_whatsapp(timestamptz,text,text)', 'EXECUTE')
    or exists (select 1 from pg_proc where oid in (
      'public.enfileirar_lembretes_formulario_whatsapp(timestamptz,text,text)'::regprocedure,
      'public.reivindicar_whatsapp_v2(boolean,timestamptz)'::regprocedure,
      'public.resultado_whatsapp_v2(uuid,uuid,text,text,boolean,timestamptz)'::regprocedure,
      'public.destinatario_whatsapp_br(text)'::regprocedure,
      'public.reivindicar_whatsapp()'::regprocedure,
      'public.resultado_whatsapp(uuid,uuid,text,text)'::regprocedure)
      and (prosecdef or proconfig is distinct from array['search_path=pg_catalog'])) then
    raise exception 'Grants, invoker ou search_path invalidos';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.whatsapp_outbox'::regclass)
    or exists (select 1 from pg_policy where polrelid = 'public.whatsapp_outbox'::regclass)
    or has_table_privilege('anon', 'public.whatsapp_outbox', 'SELECT')
    or has_table_privilege('authenticated', 'public.whatsapp_outbox', 'SELECT') then
    raise exception 'Outbox ficou exposta';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  v_agora timestamptz := statement_timestamp();
  v_corte timestamptz := statement_timestamp() - interval '7 days';
  v_prefixo text := E'Mensagem ficticia aprovada somente para teste. Continue: ';
  v_job public.whatsapp_outbox%rowtype;
  v_outro public.whatsapp_outbox%rowtype;
  v_terceiro public.whatsapp_outbox%rowtype;
  v_quantidade integer;
  v_anterior uuid;
  v_carimbo timestamptz;
  v_retorno text;
begin
  insert into public.leads (id,status,whatsapp,created_at) values
    ('ae111111-0000-4000-8000-000000000001','incompleto','(19) 98888-7777',v_agora-interval '24 hours 1 second'),
    ('ae111111-0000-4000-8000-000000000002','incompleto','19988887777',v_agora-interval '24 hours'),
    ('ae111111-0000-4000-8000-000000000003','incompleto','19988887777',v_agora-interval '23 hours 59 minutes 59 seconds'),
    ('ae111111-0000-4000-8000-000000000004','incompleto','19988887777',v_agora-interval '8 days'),
    ('ae111111-0000-4000-8000-000000000005','aguardando_revisao','19988887777',v_agora-interval '25 hours'),
    ('ae111111-0000-4000-8000-000000000006','incompleto','00988887777',v_agora-interval '25 hours'),
    ('ae111111-0000-4000-8000-000000000007','incompleto',null,v_agora-interval '25 hours'),
    ('ae111111-0000-4000-8000-000000000008','incompleto','19888887777',v_agora-interval '25 hours'),
    ('ae111111-0000-4000-8000-000000000009','incompleto','(19) 3333-4444',v_agora-interval '25 hours'),
    ('ae111111-0000-4000-8000-000000000010','incompleto','+55 (19) 98888-7777',v_agora-interval '25 hours');

  if public.destinatario_whatsapp_br('(19) 3333-4444') is distinct from '551933334444'
    or public.destinatario_whatsapp_br('+55 (19) 98888-7777') is distinct from '5519988887777'
    or public.destinatario_whatsapp_br('00988887777') is not null
    or public.destinatario_whatsapp_br('19888887777') is not null
    or public.destinatario_whatsapp_br('15519988887777') is not null then
    raise exception 'Normalizacao BR divergente do formulario';
  end if;

  if public.enfileirar_lembretes_formulario_whatsapp(null,v_prefixo,'https://crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp('infinity',v_prefixo,'https://crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp(v_agora+interval '1 second',v_prefixo,'https://crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp(v_corte,'','https://crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp(v_corte,repeat('X',2000),'https://crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp(v_corte,v_prefixo,'http://crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp(v_corte,v_prefixo,'https://x@crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp(v_corte,v_prefixo,'https://crm.invalid/?x=1') is distinct from 0 then
    raise exception 'Configuracao invalida gerou fila';
  end if;
  if exists(select 1 from public.whatsapp_outbox) then
    raise exception 'Configuracao invalida gravou linhas';
  end if;

  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp(v_corte,v_prefixo,'https://crm.invalid///');
  if v_quantidade is distinct from 3 or (select count(*) from public.whatsapp_outbox) is distinct from 3 then
    raise exception 'Fronteiras de idade/corte/status/telefone invalidas: %',v_quantidade;
  end if;
  if exists(select 1 from public.whatsapp_outbox where lead_id in (
      'ae111111-0000-4000-8000-000000000002','ae111111-0000-4000-8000-000000000003',
      'ae111111-0000-4000-8000-000000000004','ae111111-0000-4000-8000-000000000005'))
    or exists(select 1 from public.whatsapp_outbox where tipo is distinct from 'lembrete_formulario_24h'
      or ocorrido_em is distinct from v_agora or expira_em is distinct from v_agora+interval '24 hours'
      or mensagem is distinct from v_prefixo||'https://crm.invalid/continuar/'||lead_id::text) then
    raise exception 'Idade =24h, <24h, corte ou snapshot incorretos';
  end if;
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp(v_corte,'Outra copia: ','https://crm.invalid');
  if v_quantidade is distinct from 0
    or exists(select 1 from public.whatsapp_outbox where mensagem like 'Outra copia:%') then
    raise exception 'Repeticao sobrescreveu mensagem ou duplicou job';
  end if;

  perform public.registrar_confirmacao_whatsapp('ae111111-0000-4000-8000-000000000005',
    '5519988887777','Confirmacao ficticia',v_agora);
  select * into v_job from public.reivindicar_whatsapp_v2(false,null);
  if not found or v_job.tipo is distinct from 'confirmacao_recebimento' then
    raise exception 'Flag desligada prejudicou confirmacao';
  end if;
  v_retorno := public.resultado_whatsapp(v_job.id,v_job.lease_token,'started');
  if v_retorno is distinct from 'enviando' then
    raise exception 'Confirmacao started legado regrediu';
  end if;
  v_retorno := public.resultado_whatsapp(v_job.id,v_job.lease_token,'sent');
  if v_retorno is distinct from 'enviado' then
    raise exception 'Confirmacao RPC legado regrediu';
  end if;
  if exists(select 1 from public.reivindicar_whatsapp())
    or exists(select 1 from public.reivindicar_whatsapp_v2(false,v_corte))
    or exists(select 1 from public.reivindicar_whatsapp_v2(true,null))
    or exists(select 1 from public.reivindicar_whatsapp_v2(true,'infinity'))
    or exists(select 1 from public.reivindicar_whatsapp_v2(true,v_agora+interval '1 second')) then
    raise exception 'Legado/flag/corte invalido reivindicou lembrete';
  end if;

  -- Tres claims distintos, inclusive enquanto o primeiro continua reservado.
  select * into v_job from public.reivindicar_whatsapp_v2(true,v_corte);
  select * into v_outro from public.reivindicar_whatsapp_v2(true,v_corte);
  select * into v_terceiro from public.reivindicar_whatsapp_v2(true,v_corte);
  if v_job.id is null or v_outro.id is null or v_terceiro.id is null
    or v_job.id=v_outro.id or v_outro.id=v_terceiro.id or v_job.id=v_terceiro.id
    or exists(select 1 from public.reivindicar_whatsapp_v2(true,v_corte)) then
    raise exception 'Claim repetiu ou perdeu reserva';
  end if;

  -- Conclusao vencedora DEPOIS do claim, ANTES de started, impede envio.
  update public.leads set status='aguardando_revisao' where id=v_job.lead_id;
  v_retorno := public.resultado_whatsapp_v2(v_job.id,v_job.lease_token,'started',null,true,v_corte);
  if v_retorno is not null
    or (select estado from public.whatsapp_outbox where id=v_job.id) is distinct from 'cancelado' then
    raise exception 'Started autorizou formulario concluido';
  end if;

  -- Contato alterado nao e substituido silenciosamente, nem cria outro job.
  update public.leads set whatsapp='19977776666' where id=v_outro.lead_id;
  v_retorno := public.resultado_whatsapp_v2(v_outro.id,v_outro.lease_token,'started',null,true,v_corte);
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp(v_corte,v_prefixo,'https://crm.invalid');
  if v_retorno is not null
    or (select estado from public.whatsapp_outbox where id=v_outro.id) is distinct from 'cancelado'
    or (select destinatario from public.whatsapp_outbox where id=v_outro.id) is distinct from v_outro.destinatario
    or v_quantidade is distinct from 0 then
    raise exception 'Contato alterado recebeu autorizacao ou novo job';
  end if;

  if public.resultado_whatsapp(v_terceiro.id,v_terceiro.lease_token,'started') is not null
    or public.resultado_whatsapp_v2(v_terceiro.id,v_terceiro.lease_token,'started',null,false,v_corte) is not null
    or public.resultado_whatsapp_v2(v_terceiro.id,v_terceiro.lease_token,'started',null,true,null) is not null
    or public.resultado_whatsapp_v2(v_terceiro.id,v_terceiro.lease_token,'started',null,true,v_agora+interval '1 second') is not null
    or public.resultado_whatsapp_v2(v_terceiro.id,gen_random_uuid(),'started',null,true,v_corte) is not null
    or public.resultado_whatsapp_v2(v_terceiro.id,v_terceiro.lease_token,'sent',null,true,v_corte) is not null then
    raise exception 'Started flag/corte/token ou ordem burlada';
  end if;
  v_retorno := public.resultado_whatsapp_v2(v_terceiro.id,v_terceiro.lease_token,'started',null,true,v_corte);
  if v_retorno is distinct from 'enviando' then
    raise exception 'Started valido recusado';
  end if;
  v_retorno := public.resultado_whatsapp_v2(v_terceiro.id,v_terceiro.lease_token,'started',null,true,v_corte);
  if v_retorno is distinct from 'enviando' then
    raise exception 'Started valido/idempotente recusado';
  end if;
  update public.whatsapp_outbox set lease_ate=v_agora-interval '1 second',
    ocorrido_em=v_agora-interval '24 hours',expira_em=v_agora where id=v_terceiro.id;
  perform public.reivindicar_whatsapp();
  if (select estado from public.whatsapp_outbox where id=v_terceiro.id) is distinct from 'indeterminado' then
    raise exception 'Lease iniciado expirado nao ficou indeterminado';
  end if;
  v_retorno := public.resultado_whatsapp(v_terceiro.id,v_terceiro.lease_token,'sent');
  if v_retorno is distinct from 'enviado' then
    raise exception 'ACK tardio apos TTL/flagoff/legado regrediu';
  end if;
  select enviado_em into v_carimbo from public.whatsapp_outbox where id=v_terceiro.id;
  perform public.resultado_whatsapp_v2(v_terceiro.id,v_terceiro.lease_token,'sent',null,false,null);
  if (select enviado_em from public.whatsapp_outbox where id=v_terceiro.id) is distinct from v_carimbo then
    raise exception 'ACK repetido mudou carimbo';
  end if;

  -- Corte tambem e revalidado antes do inicio, nao apenas no preparo/claim.
  insert into public.leads(id,status,whatsapp,created_at) values
    ('ae111111-0000-4000-8000-000000000011','incompleto','19988887777',v_agora-interval '25 hours');
  perform public.enfileirar_lembretes_formulario_whatsapp(v_corte,v_prefixo,'https://crm.invalid');
  select * into v_job from public.reivindicar_whatsapp_v2(true,v_corte);
  v_retorno := public.resultado_whatsapp_v2(v_job.id,v_job.lease_token,'started',null,true,v_agora-interval '12 hours');
  if v_job.id is null or v_retorno is not null
    or (select estado from public.whatsapp_outbox where id=v_job.id) is distinct from 'cancelado' then
    raise exception 'Corte alterado nao foi revalidado';
  end if;

  -- Lote limitado sem starvation dos primeiros 50 registros ja existentes.
  insert into public.leads(id,status,whatsapp,created_at)
  select ('ae222222-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
    'incompleto','19988887777',v_agora-interval '26 hours'
  from generate_series(1,75) g;
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp(v_corte,v_prefixo,'https://crm.invalid');
  if v_quantidade is distinct from 50 then
    raise exception 'Primeiro lote nao respeitou limite50';
  end if;
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp(v_corte,v_prefixo,'https://crm.invalid');
  if v_quantidade is distinct from 25 then
    raise exception 'Segundo lote nao encontrou os25 restantes';
  end if;
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp(v_corte,v_prefixo,'https://crm.invalid');
  if v_quantidade is distinct from 0 then
    raise exception 'Limite50 ou idempotencia bloqueou proximo lote';
  end if;
  select * into v_job from public.reivindicar_whatsapp_v2(true,v_corte);
  v_retorno := public.resultado_whatsapp_v2(v_job.id,v_job.lease_token,'failed','bridge_disconnected',true,v_corte);
  if v_retorno is distinct from 'pendente' then
    raise exception 'Falha antes de enviar nao permite recuperacao';
  end if;
  v_anterior := v_job.lease_token;
  update public.whatsapp_outbox set proxima_tentativa_em=v_agora where id=v_job.id;
  select * into v_job from public.reivindicar_whatsapp_v2(true,v_corte);
  v_retorno := public.resultado_whatsapp_v2(v_job.id,v_anterior,'started',null,true,v_corte);
  if v_job.lease_token=v_anterior or v_retorno is not null then
    raise exception 'Lease anterior ainda autorizou started';
  end if;
  v_retorno := public.resultado_whatsapp_v2(v_job.id,v_job.lease_token,'started',null,true,v_corte);
  if v_retorno is distinct from 'enviando' then
    raise exception 'Novo lease valido nao autorizou started';
  end if;
  v_retorno := public.resultado_whatsapp_v2(v_job.id,v_job.lease_token,'failed','send_unknown',true,v_corte);
  if v_retorno is distinct from 'indeterminado' then
    raise exception 'Falha apos started perdeu estado indeterminado';
  end if;
end;
$$;
reset role;
rollback;
