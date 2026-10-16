-- SOMENTE Postgres isolado, apos os scripts atuais e whatsapp-historico-feedback.sql.
-- Nao executar em producao: fixtures sinteticas com rollback, sem bridge/MCP.
begin;
set local timezone='UTC';

do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    raise exception 'Fixture exige Postgres isolado SEM realtime.send real';
  end if;
  if has_function_privilege('anon','public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean)','EXECUTE')
    or has_function_privilege('authenticated','public.enfileirar_lembrete_proposta_whatsapp(uuid,integer,timestamptz,uuid)','EXECUTE')
    or exists(select 1 from pg_proc where pronamespace='public'::regnamespace
      and proname in ('resultado_whatsapp_v4','enfileirar_lembrete_proposta_whatsapp')
      and (prosecdef or proconfig is distinct from array['search_path=pg_catalog'])) then
    raise exception 'RPC de historico perdeu isolamento/permissoes';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  v_agora timestamptz:=statement_timestamp();
  v_admin uuid:='ad000000-0000-4000-8000-000000000001';
  v_lead uuid; v_id uuid; v_json jsonb; v_job public.whatsapp_outbox%rowtype;
  v_outcome text; v_codigo text; v_i integer;
  v_checked timestamptz; v_coverage timestamptz; v_last timestamptz; v_complete boolean;
  v_seq jsonb; v_texto text; v_sent timestamptz;
begin
  insert into public.leads(id,status,whatsapp,created_at,enviado_em,pdf_url)
    select ('af888888-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'esfriou','19988887777',
      v_agora-interval '60 days',v_agora-interval '35 days','https://crm.invalid/historico/'||g
    from generate_series(1,12) g;

  -- Os quatro novos diagnosticos e os dois legados cancelam SEM started.
  -- Somente outro clique reabre o MESMO ID; o timer nunca os reivindica sozinho.
  for v_i in 1..6 loop
    v_lead:=('af888888-0000-4000-8000-'||lpad(v_i::text,12,'0'))::uuid;
    v_codigo:=(array['historico_em_sincronizacao','historico_incompleto',
      'historico_indisponivel','identidade_nao_confirmada','inactivity_recent','inactivity_unverified'])[v_i];
    v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_lead,7,v_agora-interval '35 days',v_admin);
    v_id:=(v_json->>'id')::uuid;
    select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
    if v_job.id is distinct from v_id then raise exception 'Nao reivindicou diagnostico %',v_codigo; end if;
    update public.whatsapp_outbox set historico_verificado_em=v_agora-interval '1 day',
      historico_cobertura_inicio_em=v_agora-interval '2 days',ultima_interacao_em=v_agora-interval '3 days'
      where id=v_id;
    v_outcome:=public.resultado_whatsapp_v4(v_id,v_job.lease_token,'failed',v_codigo,false,null,true,
      v_agora,v_agora-interval '1 day',v_agora-interval '2 days',false);
    select * into v_job from public.whatsapp_outbox where id=v_id;
    if v_outcome is distinct from 'cancelado' or v_job.estado<>'cancelado'
      or v_job.iniciado_em is not null or v_job.ultimo_codigo<>v_codigo then
      raise exception 'Diagnostico nao cancelou antes do envio: %',v_codigo;
    end if;
    if v_codigo='historico_incompleto' then
      if v_job.historico_verificado_em is distinct from v_agora
        or v_job.historico_cobertura_inicio_em is distinct from v_agora-interval '1 day'
        or v_job.ultima_interacao_em is distinct from v_agora-interval '2 days' then
        raise exception 'Diagnostico parcial verificavel nao persistiu';
      end if;
    elsif v_job.historico_verificado_em is not null or v_job.historico_cobertura_inicio_em is not null
      or v_job.ultima_interacao_em is not null then
      raise exception 'Diagnostico % manteve datas antigas/indevidas',v_codigo;
    end if;
    if exists(select 1 from public.reivindicar_whatsapp_v4(false,null,true)) then
      raise exception 'Timer reativou cancelamento %',v_codigo;
    end if;
    v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_lead,7,v_agora-interval '35 days',v_admin);
    select * into v_job from public.whatsapp_outbox where id=v_id;
    if v_json->>'id' is distinct from v_id::text or v_json->>'estado'<>'pendente'
      or v_json->>'reutilizado'<>'true'
      or (select count(*) from public.whatsapp_outbox where lead_id=v_lead)<>1
      or v_job.historico_verificado_em is not null or v_job.historico_cobertura_inicio_em is not null
      or v_job.ultima_interacao_em is not null then
      raise exception 'Novo clique duplicou/manteve diagnostico anterior: %',v_codigo;
    end if;
    select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
    perform public.resultado_whatsapp_v4(v_id,v_job.lease_token,'failed',v_codigo,false,null,true,null,null,null,false);
  end loop;

  -- Prova parcial invalida nunca persiste datas que dariam previsao falsa na UI.
  v_lead:='af888888-0000-4000-8000-000000000007';
  for v_i in 1..19 loop
    v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_lead,7,v_agora-interval '35 days',v_admin);
    v_id:=(v_json->>'id')::uuid;
    select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
    v_checked:=v_agora; v_coverage:=v_agora-interval '1 day'; v_last:=null; v_complete:=false;
    case v_i
      when 1 then v_checked:=null;
      when 2 then v_checked:='infinity';
      when 3 then v_checked:='-infinity';
      when 4 then v_checked:=v_agora-interval '31 seconds';
      when 5 then v_checked:=v_agora+interval '6 seconds';
      when 6 then v_coverage:=null;
      when 7 then v_coverage:='infinity';
      when 8 then v_coverage:='-infinity';
      when 9 then v_coverage:='1970-01-01T00:00:00Z';
      when 10 then v_coverage:='1969-12-31T23:59:59Z';
      when 11 then v_coverage:=v_agora+interval '1 second';
      when 12 then v_coverage:=v_agora-interval '6 days';
      when 13 then v_last:='infinity';
      when 14 then v_last:=v_agora+interval '1 second';
      when 15 then v_complete:=true;
      when 16 then v_complete:=null;
      when 17 then v_checked:=v_agora+interval '5 seconds'; v_coverage:=v_agora+interval '6 seconds';
      when 18 then v_last:='1970-01-01T00:00:00Z';
      when 19 then v_last:='-infinity';
    end case;
    update public.whatsapp_outbox set historico_verificado_em=v_agora-interval '1 day',
      historico_cobertura_inicio_em=v_agora-interval '2 days',ultima_interacao_em=v_agora-interval '3 days'
      where id=v_id;
    v_outcome:=public.resultado_whatsapp_v4(v_id,v_job.lease_token,'failed','historico_incompleto',false,null,true,
      v_checked,v_coverage,v_last,v_complete);
    select * into v_job from public.whatsapp_outbox where id=v_id;
    if v_outcome is distinct from 'cancelado' or v_job.historico_verificado_em is not null
      or v_job.historico_cobertura_inicio_em is not null or v_job.ultima_interacao_em is not null
      or v_job.iniciado_em is not null then
      raise exception 'Prova parcial invalida % persistiu/autorizou envio',v_i;
    end if;
  end loop;
  -- Os limites de frescor sao inclusivos e ultima interacao ausente e valida.
  for v_i in 1..2 loop
    perform public.enfileirar_lembrete_proposta_whatsapp(v_lead,7,v_agora-interval '35 days',v_admin);
    select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
    v_checked:=case when v_i=1 then v_agora-interval '30 seconds' else v_agora+interval '5 seconds' end;
    perform public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'failed','historico_incompleto',false,null,true,
      v_checked,v_agora-interval '1 day',null,false);
    if (select historico_verificado_em from public.whatsapp_outbox where id=v_job.id) is distinct from v_checked then
      raise exception 'Limite de frescor valido % rejeitado',v_i;
    end if;
  end loop;

  -- Um codigo desconhecido nao ganha permissao de reabertura por clique.
  v_lead:='af888888-0000-4000-8000-000000000008';
  v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_lead,7,v_agora-interval '35 days',v_admin);
  v_id:=(v_json->>'id')::uuid;
  update public.whatsapp_outbox set estado='cancelado',ultimo_codigo='codigo_desconhecido' where id=v_id;
  v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_lead,7,v_agora-interval '35 days',v_admin);
  if v_json->>'erro' is distinct from 'tentativa_encerrada'
    or (select count(*) from public.whatsapp_outbox where lead_id=v_lead)<>1 then
    raise exception 'Codigo desconhecido reabriu tentativa/criou outro ID';
  end if;

  -- Prova incompleta nao satisfaz started nem mesmo com cobertura temporal longa.
  v_lead:='af888888-0000-4000-8000-000000000009';
  for v_i in 1..6 loop
    perform public.enfileirar_lembrete_proposta_whatsapp(v_lead,7,v_agora-interval '35 days',v_admin);
    select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
    v_checked:=v_agora; v_coverage:=v_agora-interval '16 days'; v_last:=null; v_complete:=true;
    case v_i
      when 1 then v_complete:=false;
      when 2 then v_coverage:='0001-01-01T00:00:00Z';
      when 3 then v_coverage:='1970-01-01T00:00:00Z';
      when 4 then v_last:='1970-01-01T00:00:00Z';
      when 5 then v_last:=v_agora+interval '1 second';
      when 6 then v_coverage:='-infinity';
    end case;
    v_outcome:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,
      v_checked,v_coverage,v_last,v_complete);
    if v_outcome is not null
      or (select estado from public.whatsapp_outbox where id=v_job.id)<>'cancelado'
      or (select iniciado_em from public.whatsapp_outbox where id=v_job.id) is not null then
      raise exception 'started aceitou prova incompleta/data invalida para 7 dias: %',v_i;
    end if;
  end loop;

  -- O gate de 30 dias continua exigindo o ACK7 da mesma revisao + 15 dias reais.
  v_lead:='af888888-0000-4000-8000-000000000010';
  if public.enfileirar_lembrete_proposta_whatsapp(v_lead,30,v_agora-interval '35 days',v_admin)->>'erro'
    is distinct from 'lembrete_7_nao_enviado' then raise exception '30 dias perdeu predecessor obrigatorio'; end if;
  v_seq:=public.sequencia_lembrete_proposta('lembrete_proposta_7d','https://crm.invalid/historico/10');
  select string_agg(p.value->>'message',E'\n\n' order by p.n) into v_texto
    from jsonb_array_elements(v_seq) with ordinality p(value,n);
  insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,estado,
    proposta_enviado_em,proposta_pdf_url,solicitado_em,solicitado_por,iniciado_em,enviado_em,lease_token)
    values(v_lead,'lembrete_proposta_7d',v_agora-interval '16 days',v_agora-interval '15 days','5519988887777',
      v_texto,v_seq,'enviado',v_agora-interval '35 days','https://crm.invalid/historico/10',
      v_agora-interval '16 days',v_admin,v_agora-interval '16 days',v_agora-interval '16 days',gen_random_uuid());
  perform public.enfileirar_lembrete_proposta_whatsapp(v_lead,30,v_agora-interval '35 days',v_admin);
  select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
  perform public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'failed','historico_incompleto',false,null,true,
    v_agora,v_agora-interval '6 days',null,false);
  if (select historico_cobertura_inicio_em from public.whatsapp_outbox where id=v_job.id)
    is distinct from v_agora-interval '6 days' then
    raise exception 'Diagnostico30 usou janela de 5 dias em vez de 15';
  end if;
  for v_i in 1..3 loop
    perform public.enfileirar_lembrete_proposta_whatsapp(v_lead,30,v_agora-interval '35 days',v_admin);
    select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
    v_outcome:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,
      v_agora,case when v_i=2 then v_agora-interval '6 days' else v_agora-interval '16 days' end,
      case when v_i=3 then v_agora-interval '2 days' else null end,v_i<>1);
    if v_outcome is not null or (select estado from public.whatsapp_outbox where id=v_job.id)<>'cancelado'
      or (select iniciado_em from public.whatsapp_outbox where id=v_job.id) is not null then
      raise exception 'Gate 30 dias incompleto/curto/recente liberou envio: %',v_i;
    end if;
  end loop;

  perform public.enfileirar_lembrete_proposta_whatsapp(v_lead,30,v_agora-interval '35 days',v_admin);
  select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
  v_outcome:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,false,
    v_agora,v_agora-interval '16 days',null,true);
  if v_outcome is not null
    or (select estado from public.whatsapp_outbox where id=v_job.id)<>'reservado' then
    raise exception 'Flag desligada permitiu started';
  end if;
  if public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,
    v_agora,v_agora-interval '16 days',v_agora-interval '16 days',true) is distinct from 'enviando' then
    raise exception 'Historico real de 15 dias nao autorizou started';
  end if;
  v_outcome:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'failed','historico_indisponivel',false,null,true,
    null,null,null,false);
  if v_outcome is distinct from 'indeterminado'
    or public.enfileirar_lembrete_proposta_whatsapp(v_lead,30,v_agora-interval '35 days',v_admin)->>'erro'
      is distinct from 'envio_indeterminado' then
    raise exception 'Falha apos started se tornou reativavel';
  end if;
  -- ACK verdadeiro tardio continua factual, inclusive com a flag agora desligada.
  if public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'sent',null,false,null,false,null,null,null,false)
    is distinct from 'enviado' then raise exception 'ACK tardio foi perdido'; end if;
  select enviado_em into v_sent from public.whatsapp_outbox where id=v_job.id;
  perform public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'sent',null,false,null,false,null,null,null,false);
  if (select enviado_em from public.whatsapp_outbox where id=v_job.id) is distinct from v_sent
    or (select lembrete_30_em from public.leads where id=v_lead) is distinct from v_sent
    or public.enfileirar_lembrete_proposta_whatsapp(v_lead,30,v_agora-interval '35 days',v_admin)->>'erro'
      is distinct from 'ja_enviado' then raise exception 'ACK/deduplicacao mudaram'; end if;
end;
$$;
reset role;
rollback;
