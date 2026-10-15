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
  if has_function_privilege('anon', 'public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz,jsonb,text)', 'EXECUTE')
    or has_function_privilege('authenticated', 'public.reivindicar_whatsapp_v3(boolean,timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'public.resultado_whatsapp_v3(uuid,uuid,text,text,boolean,timestamptz)', 'EXECUTE')
    or has_function_privilege('anon', 'public.destinatario_whatsapp_br(text)', 'EXECUTE')
    or not has_function_privilege('service_role', 'public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz,jsonb,text)', 'EXECUTE')
    or exists (select 1 from pg_proc where oid in (
      'public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz,jsonb,text)'::regprocedure,
      'public.reivindicar_whatsapp_v3(boolean,timestamptz)'::regprocedure,
      'public.resultado_whatsapp_v3(uuid,uuid,text,text,boolean,timestamptz)'::regprocedure,
      'public.destinatario_whatsapp_br(text)'::regprocedure,
      'public.enfileirar_lembretes_formulario_whatsapp(timestamptz,text,text)'::regprocedure,
      'public.sequencia_lembrete_formulario_valida(jsonb,uuid,text)'::regprocedure,
      'public.reivindicar_whatsapp_v2(boolean,timestamptz)'::regprocedure,
      'public.resultado_whatsapp_v2(uuid,uuid,text,text,boolean,timestamptz)'::regprocedure,
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
  v_mensagens jsonb := '[
    {"message":"Olá! Aqui é a Mel Storymaker 👋","delayBeforeSeconds":0},
    {"message":"Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊","delayBeforeSeconds":2},
    {"message":"Suas respostas estão salvas, acesse o link:","delayBeforeSeconds":3}
  ]';
  v_prefixo text := (v_mensagens #>> '{0,message}') || E'\n\n'
    || (v_mensagens #>> '{1,message}') || E'\n\n'
    || (v_mensagens #>> '{2,message}') || E'\n\n';
  v_invalido jsonb;
  v_prazo timestamptz;
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

  if public.enfileirar_lembretes_formulario_whatsapp_v3(null,v_mensagens,'https://crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp_v3('infinity',v_mensagens,'https://crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp_v3(v_agora+interval '1 second',v_mensagens,'https://crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'http://crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://x@crm.invalid') is distinct from 0
    or public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://crm.invalid/?x=1') is distinct from 0 then
    raise exception 'Configuracao invalida gerou fila';
  end if;
  for v_invalido in select x from (values
      (null::jsonb), ('null'::jsonb), ('{}'::jsonb), ('[]'::jsonb),
      ('"texto"'::jsonb), ('123'::jsonb), ('[null,null,null]'::jsonb),
      (v_mensagens || jsonb_build_array(jsonb_build_object('message','extra','delayBeforeSeconds',2))),
      (jsonb_set(v_mensagens,'{0,message}','"texto diferente"')),
      (jsonb_set(v_mensagens,'{0,delayBeforeSeconds}','1')),
      (jsonb_set(v_mensagens,'{1,delayBeforeSeconds}','"2"')),
      (jsonb_set(v_mensagens,'{2,extra}','true')),
      (jsonb_set(v_mensagens,'{2,message}',to_jsonb(repeat('X',2001))))
    ) entradas(x) loop
    v_quantidade := public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_invalido,'https://crm.invalid');
    if v_quantidade is distinct from 0 then
      raise exception 'JSON/copy/pausa invalida gerou fila';
    end if;
  end loop;
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp(v_corte,'Texto legado','https://crm.invalid');
  if v_quantidade is distinct from 0 or exists(select 1 from public.whatsapp_outbox) then
    raise exception 'Configuracao invalida ou RPC textual legada gravou linhas';
  end if;

  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://crm.invalid///');
  if v_quantidade is distinct from 3 or (select count(*) from public.whatsapp_outbox) is distinct from 3 then
    raise exception 'Fronteiras de idade/corte/status/telefone invalidas: %',v_quantidade;
  end if;
  if exists(select 1 from public.whatsapp_outbox where lead_id in (
      'ae111111-0000-4000-8000-000000000002','ae111111-0000-4000-8000-000000000003',
      'ae111111-0000-4000-8000-000000000004','ae111111-0000-4000-8000-000000000005'))
    or exists(select 1 from public.whatsapp_outbox where tipo is distinct from 'lembrete_formulario_24h'
      or ocorrido_em is distinct from v_agora or expira_em is distinct from v_agora+interval '24 hours'
      or mensagem is distinct from v_prefixo||'https://crm.invalid/continuar/'||lead_id::text
      or not public.sequencia_lembrete_formulario_valida(sequencia,lead_id,mensagem)) then
    raise exception 'Idade =24h, <24h, corte ou snapshot incorretos';
  end if;
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,jsonb_set(v_mensagens,'{0,message}','"Outra copia"'),'https://crm.invalid');
  if v_quantidade is distinct from 0
    or exists(select 1 from public.whatsapp_outbox where mensagem like 'Outra copia:%') then
    raise exception 'Repeticao sobrescreveu mensagem ou duplicou job';
  end if;

  perform public.registrar_confirmacao_whatsapp('ae111111-0000-4000-8000-000000000005',
    '5519988887777','Confirmacao ficticia',v_agora);
  select * into v_job from public.reivindicar_whatsapp_v3(false,null);
  if not found or v_job.tipo is distinct from 'confirmacao_recebimento' then
    raise exception 'Flag desligada prejudicou confirmacao';
  end if;
  v_prazo := v_job.lease_ate;
  v_retorno := public.resultado_whatsapp(v_job.id,v_job.lease_token,'started');
  if v_retorno is distinct from 'enviando' then
    raise exception 'Confirmacao started legado regrediu';
  end if;
  if v_job.sequencia is not null
    or (select lease_ate from public.whatsapp_outbox where id=v_job.id) is distinct from v_prazo then
    raise exception 'Confirmacao recebeu sequencia ou lease novo';
  end if;
  v_retorno := public.resultado_whatsapp(v_job.id,v_job.lease_token,'sent');
  if v_retorno is distinct from 'enviado' then
    raise exception 'Confirmacao RPC legado regrediu';
  end if;
  if exists(select 1 from public.reivindicar_whatsapp())
    or exists(select 1 from public.reivindicar_whatsapp_v2(true,v_corte))
    or exists(select 1 from public.reivindicar_whatsapp_v3(false,v_corte))
    or exists(select 1 from public.reivindicar_whatsapp_v3(true,null))
    or exists(select 1 from public.reivindicar_whatsapp_v3(true,'infinity'))
    or exists(select 1 from public.reivindicar_whatsapp_v3(true,v_agora+interval '1 second')) then
    raise exception 'Legado/flag/corte invalido reivindicou lembrete';
  end if;

  -- Tres claims distintos, inclusive enquanto o primeiro continua reservado.
  select * into v_job from public.reivindicar_whatsapp_v3(true,v_corte);
  select * into v_outro from public.reivindicar_whatsapp_v3(true,v_corte);
  select * into v_terceiro from public.reivindicar_whatsapp_v3(true,v_corte);
  if v_job.id is null or v_outro.id is null or v_terceiro.id is null
    or v_job.id=v_outro.id or v_outro.id=v_terceiro.id or v_job.id=v_terceiro.id
    or exists(select 1 from public.reivindicar_whatsapp_v3(true,v_corte)) then
    raise exception 'Claim repetiu ou perdeu reserva';
  end if;

  -- Conclusao vencedora DEPOIS do claim, ANTES de started, impede envio.
  update public.leads set status='aguardando_revisao' where id=v_job.lead_id;
  v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'started',null,true,v_corte);
  if v_retorno is not null
    or (select estado from public.whatsapp_outbox where id=v_job.id) is distinct from 'cancelado' then
    raise exception 'Started autorizou formulario concluido';
  end if;

  -- Contato alterado nao e substituido silenciosamente, nem cria outro job.
  update public.leads set whatsapp='19977776666' where id=v_outro.lead_id;
  v_retorno := public.resultado_whatsapp_v3(v_outro.id,v_outro.lease_token,'started',null,true,v_corte);
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://crm.invalid');
  if v_retorno is not null
    or (select estado from public.whatsapp_outbox where id=v_outro.id) is distinct from 'cancelado'
    or (select destinatario from public.whatsapp_outbox where id=v_outro.id) is distinct from v_outro.destinatario
    or v_quantidade is distinct from 0 then
    raise exception 'Contato alterado recebeu autorizacao ou novo job';
  end if;

  if public.resultado_whatsapp(v_terceiro.id,v_terceiro.lease_token,'started') is not null
    or public.resultado_whatsapp_v2(v_terceiro.id,v_terceiro.lease_token,'started',null,true,v_corte) is not null
    or public.resultado_whatsapp_v3(v_terceiro.id,v_terceiro.lease_token,'started',null,false,v_corte) is not null
    or public.resultado_whatsapp_v3(v_terceiro.id,v_terceiro.lease_token,'started',null,true,null) is not null
    or public.resultado_whatsapp_v3(v_terceiro.id,v_terceiro.lease_token,'started',null,true,v_agora+interval '1 second') is not null
    or public.resultado_whatsapp_v3(v_terceiro.id,gen_random_uuid(),'started',null,true,v_corte) is not null
    or public.resultado_whatsapp_v3(v_terceiro.id,v_terceiro.lease_token,'sent',null,true,v_corte) is not null then
    raise exception 'Started flag/corte/token ou ordem burlada';
  end if;
  v_retorno := public.resultado_whatsapp_v3(v_terceiro.id,v_terceiro.lease_token,'started',null,true,v_corte);
  if v_retorno is distinct from 'enviando' then
    raise exception 'Started valido recusado';
  end if;
  select lease_ate into v_prazo from public.whatsapp_outbox where id=v_terceiro.id;
  if v_prazo is distinct from v_agora+interval '180 seconds' then
    raise exception 'Sequencia nao recebeu lease180 desde primeiro started';
  end if;
  -- Simula primeiro inicio no passado: chamada repetida nao renova lease.
  update public.whatsapp_outbox set iniciado_em=v_agora-interval '10 seconds',
    lease_ate=v_agora+interval '170 seconds' where id=v_terceiro.id;
  v_retorno := public.resultado_whatsapp_v3(v_terceiro.id,v_terceiro.lease_token,'started',null,true,v_corte);
  if v_retorno is distinct from 'enviando'
    or (select lease_ate from public.whatsapp_outbox where id=v_terceiro.id)
      is distinct from v_agora+interval '170 seconds' then
    raise exception 'Started valido/idempotente recusado ou renovou lease';
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
  perform public.resultado_whatsapp_v3(v_terceiro.id,v_terceiro.lease_token,'sent',null,false,null);
  if (select enviado_em from public.whatsapp_outbox where id=v_terceiro.id) is distinct from v_carimbo then
    raise exception 'ACK repetido mudou carimbo';
  end if;

  -- Corte tambem e revalidado antes do inicio, nao apenas no preparo/claim.
  insert into public.leads(id,status,whatsapp,created_at) values
    ('ae111111-0000-4000-8000-000000000011','incompleto','19988887777',v_agora-interval '25 hours');
  perform public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://crm.invalid');
  select * into v_job from public.reivindicar_whatsapp_v3(true,v_corte);
  v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'started',null,true,v_agora-interval '12 hours');
  if v_job.id is null or v_retorno is not null
    or (select estado from public.whatsapp_outbox where id=v_job.id) is distinct from 'cancelado' then
    raise exception 'Corte alterado nao foi revalidado';
  end if;

  -- Lote limitado sem starvation dos primeiros 50 registros ja existentes.
  insert into public.leads(id,status,whatsapp,created_at)
  select ('ae222222-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
    'incompleto','19988887777',v_agora-interval '26 hours'
  from generate_series(1,75) g;
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://crm.invalid');
  if v_quantidade is distinct from 50 then
    raise exception 'Primeiro lote nao respeitou limite50';
  end if;
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://crm.invalid');
  if v_quantidade is distinct from 25 then
    raise exception 'Segundo lote nao encontrou os25 restantes';
  end if;
  v_quantidade := public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://crm.invalid');
  if v_quantidade is distinct from 0 then
    raise exception 'Limite50 ou idempotencia bloqueou proximo lote';
  end if;
  select * into v_job from public.reivindicar_whatsapp_v3(true,v_corte);
  v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'failed','bridge_disconnected',true,v_corte);
  if v_retorno is distinct from 'pendente' then
    raise exception 'Falha antes de enviar nao permite recuperacao';
  end if;
  v_anterior := v_job.lease_token;
  update public.whatsapp_outbox set proxima_tentativa_em=v_agora where id=v_job.id;
  select * into v_job from public.reivindicar_whatsapp_v3(true,v_corte);
  v_retorno := public.resultado_whatsapp_v3(v_job.id,v_anterior,'started',null,true,v_corte);
  if v_job.lease_token=v_anterior or v_retorno is not null then
    raise exception 'Lease anterior ainda autorizou started';
  end if;
  v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'started',null,true,v_corte);
  if v_retorno is distinct from 'enviando' then
    raise exception 'Novo lease valido nao autorizou started';
  end if;
  v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'failed','send_unknown',true,v_corte);
  if v_retorno is distinct from 'indeterminado' then
    raise exception 'Falha apos started perdeu estado indeterminado';
  end if;
end;
$$;

-- Revalidacao entre partes: qualquer interrupcao apos started e terminal para
-- novas tentativas; o mesmo lease continua aceitando somente reconciliacao.
do $$
declare
  v_agora timestamptz := statement_timestamp();
  v_corte timestamptz := statement_timestamp()-interval '7 days';
  v_mensagens jsonb := '[
    {"message":"Olá! Aqui é a Mel Storymaker 👋","delayBeforeSeconds":0},
    {"message":"Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊","delayBeforeSeconds":2},
    {"message":"Suas respostas estão salvas, acesse o link:","delayBeforeSeconds":3}
  ]';
  v_job public.whatsapp_outbox%rowtype;
  v_retorno text;
  v_id uuid;
  v_i integer;
  v_seq jsonb;
  v_invalida jsonb;
  v_texto text;
begin
  -- Remove apenas os fixtures anteriores, ainda dentro da mesma transacao.
  delete from public.leads where id::text like 'ae%';
  for v_i in 1..7 loop
    v_id := ('af333333-0000-4000-8000-'||lpad(v_i::text,12,'0'))::uuid;
    insert into public.leads(id,status,whatsapp,created_at)
      values(v_id,'incompleto','19988887777',v_agora-interval '25 hours');
    perform public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://crm.invalid');
    select * into v_job from public.reivindicar_whatsapp_v3(true,v_corte);
    if v_job.lead_id is distinct from v_id then raise exception 'Fixture nao obteve seu job'; end if;
    v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'started',null,true,v_corte);
    if v_retorno is distinct from 'enviando' then raise exception 'Primeira parte recusada'; end if;
    case v_i
      when 1 then update public.leads set status='aguardando_revisao' where id=v_id;
      when 2 then update public.leads set whatsapp='19977776666' where id=v_id;
      when 3 then update public.leads set whatsapp=null where id=v_id;
      when 4 then null; -- Corte passa a excluir o lead.
      when 5 then null; -- Flag e desligada entre as partes.
      when 6 then update public.whatsapp_outbox set ocorrido_em=v_agora-interval '24 hours',expira_em=v_agora where id=v_job.id;
      when 7 then update public.whatsapp_outbox set lease_ate=v_agora where id=v_job.id;
    end case;
    v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'started',null,v_i<>5,
      case when v_i=4 then v_agora-interval '12 hours' else v_corte end);
    if v_retorno is not null then raise exception 'Parte seguinte autorizada apos mudanca %',v_i; end if;
    -- Resultado parcial reportado pelo worker nao libera repetir nenhuma parte.
    v_retorno := public.resultado_whatsapp_v2(v_job.id,v_job.lease_token,'indeterminate','sequence_partial',true,v_corte);
    if v_retorno is distinct from 'indeterminado' then raise exception 'Parcial perdeu reconciliacao %',v_i; end if;
    update public.leads set status='incompleto',whatsapp='19988887777' where id=v_id;
    if exists(select 1 from public.reivindicar_whatsapp_v3(true,v_corte)) then
      raise exception 'Sequencia parcial voltou para claim %',v_i;
    end if;
    v_retorno := public.resultado_whatsapp(v_job.id,v_job.lease_token,'sent');
    if v_retorno is distinct from 'enviado' then raise exception 'ACK tardio parcial rejeitado %',v_i; end if;
  end loop;

  -- CHECK fecha kind, quatro objetos, copy, pausas, link e texto concatenado.
  v_id := 'af333333-0000-4000-8000-000000000099';
  insert into public.leads(id,status,whatsapp,created_at)
    values(v_id,'incompleto','19988887777',v_agora-interval '25 hours');
  perform public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://crm.invalid');
  select sequencia,mensagem into v_seq,v_texto from public.whatsapp_outbox where lead_id=v_id;
  for v_invalida in select x from (values
    (jsonb_set(v_seq,'{3,delayBeforeSeconds}','0')),
    (jsonb_set(v_seq,'{3,message}','"https://crm.invalid/continuar/00000000-0000-4000-8000-000000000000"')),
    (jsonb_set(v_seq,'{3,message}','"https://x@crm.invalid/continuar/af333333-0000-4000-8000-000000000099"')),
    (jsonb_set(v_seq,'{3,message}','"https://crm.invalid/continuar/af333333-0000-4000-8000-000000000099?x=1"')),
    (jsonb_set(v_seq,'{0,extra}','true')),
    ('null'::jsonb)
  ) entradas(x) loop
    begin
      update public.whatsapp_outbox set sequencia=v_invalida where lead_id=v_id;
      raise exception 'CHECK aceitou sequencia invalida';
    exception when check_violation then null;
    end;
  end loop;
  begin
    update public.whatsapp_outbox set mensagem='Copy trocada' where lead_id=v_id;
    raise exception 'CHECK aceitou texto diferente do snapshot';
  exception when check_violation then null;
  end;
  begin
    update public.whatsapp_outbox set tipo='confirmacao_recebimento' where lead_id=v_id;
    raise exception 'CHECK aceitou confirmacao com sequencia';
  exception when check_violation then null;
  end;
  delete from public.whatsapp_outbox where lead_id=v_id;

  -- NULL legado e preservado somente no historico, nunca em um estado ativo.
  begin
    insert into public.whatsapp_outbox
      (lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem)
      values(v_id,'lembrete_formulario_24h',v_agora,v_agora+interval '24 hours',
        '5519988887777','Snapshot textual legado');
    raise exception 'CHECK aceitou snapshot NULL ativo';
  exception when check_violation then null;
  end;
  insert into public.whatsapp_outbox
    (lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,estado,lease_token,iniciado_em)
    values(v_id,'lembrete_formulario_24h',v_agora,v_agora+interval '24 hours',
      '5519988887777','Snapshot textual legado','indeterminado',gen_random_uuid(),v_agora)
    returning * into v_job;
  if exists(select 1 from public.reivindicar_whatsapp_v3(true,v_corte))
    or exists(select 1 from public.reivindicar_whatsapp_v2(true,v_corte)) then
    raise exception 'Worker recebeu lembrete NULL legado';
  end if;
  v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'started',null,true,v_corte);
  if v_retorno is not null
    or (select estado from public.whatsapp_outbox where id=v_job.id) is distinct from 'indeterminado' then
    raise exception 'Started alterou ou autorizou legado NULL iniciado';
  end if;
  v_retorno := public.resultado_whatsapp_v2(v_job.id,v_job.lease_token,'sent',null,true,v_corte);
  if v_retorno is distinct from 'enviado' then raise exception 'ACK legado NULL rejeitado'; end if;
end;
$$;
reset role;
rollback;
