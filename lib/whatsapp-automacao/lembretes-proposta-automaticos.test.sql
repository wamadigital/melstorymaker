-- Fixture isolada PostgreSQL: schema integral + whatsapp-lembretes-proposta-automaticos.sql.
begin;
set local timezone='UTC';

do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    raise exception 'Fixture exige Postgres isolado SEM realtime.send real';
  end if;
  if has_function_privilege('anon','public.esfriar_leads_parados_whatsapp(timestamptz)','EXECUTE')
    or has_function_privilege('authenticated','public.enfileirar_lembretes_proposta_automaticos_whatsapp()','EXECUTE')
    or has_table_privilege('authenticated','public.whatsapp_lembretes_proposta_config','SELECT')
    or not (select relrowsecurity from pg_class where oid='public.whatsapp_lembretes_proposta_config'::regclass) then
    raise exception 'Agenda e configuracao precisam ser privadas';
  end if;
end;
$$;

-- Janela de teste que inclui os prazos recentes, sem importar um vencimento de ontem.
update public.whatsapp_lembretes_proposta_config set ativada_em=statement_timestamp()-interval '2 days' where id=1;
set local role service_role;
do $$
declare
  a timestamptz:=statement_timestamp();
  v_primeiro uuid:=gen_random_uuid();
  v_fronteira uuid:=gen_random_uuid();
  v_legado_fora_da_janela uuid:=gen_random_uuid();
  v_entrada_manual uuid:=gen_random_uuid();
  v_ultimo uuid:=gen_random_uuid();
  v_sem_ack uuid:=gen_random_uuid();
  v_evento_passado uuid:=gen_random_uuid();
  v_ator uuid:=gen_random_uuid();
  v_link text:='https://agenda.invalid/p/s123';
  v_ack timestamptz:=a-interval '15 days 20 minutes';
  v_seq jsonb;
  v_msg text;
  v_job public.whatsapp_outbox%rowtype;
  v_json jsonb;
  v_estado text;
begin
  insert into public.leads(id,categoria,status,whatsapp,enviado_em,updated_at,pdf_url) values
    (v_primeiro,'casamento','enviado','19988887771',a-interval '169 hours',a-interval '169 hours',v_link),
    (v_fronteira,'casamento','enviado','19988887772',a-interval '169 hours',a-interval '168 hours 14 minutes 59 seconds',v_link),
    (v_legado_fora_da_janela,'casamento','enviado','19988887773',a-interval '8 days 2 hours',a-interval '8 days 2 hours',v_link);
  insert into public.leads(id,categoria,status,whatsapp,enviado_em,esfriou_em,pdf_url) values
    (v_entrada_manual,'casamento','enviado','19988887774',a-interval '8 days',null,v_link),
    (v_ultimo,'casamento','esfriou','19988887775',a-interval '31 days',a-interval '20 days',v_link),
    (v_sem_ack,'casamento','esfriou','19988887776',a-interval '31 days',a-interval '2 days',v_link);
  update public.leads set status='esfriou' where id=v_entrada_manual;
  update public.leads set lembrete_7_em=v_ack where id=v_sem_ack;
  insert into public.leads(id,categoria,status,whatsapp,enviado_em,esfriou_em,pdf_url,data_evento) values
    (v_evento_passado,'casamento','esfriou','19988887777',a-interval '9 days',a-interval '1 hour',v_link,
     (a at time zone 'America/Sao_Paulo')::date-1);

  v_seq:=public.sequencia_lembrete_proposta('lembrete_proposta_7d',v_link);
  select string_agg(p.value->>'message',E'\n\n' order by p.n) into v_msg
    from jsonb_array_elements(v_seq) with ordinality p(value,n);
  insert into public.whatsapp_outbox(lead_id,tipo,estado,ocorrido_em,expira_em,destinatario,mensagem,sequencia,
    proposta_enviado_em,proposta_pdf_url,solicitado_em,solicitado_por,iniciado_em,enviado_em)
  values(v_ultimo,'lembrete_proposta_7d','enviado',v_ack-interval '1 minute',v_ack+interval '23 hours 59 minutes',
    '5519988887775',v_msg,v_seq,a-interval '31 days',v_link,v_ack-interval '1 minute',v_ator,v_ack-interval '10 seconds',v_ack);

  if public.enfileirar_lembretes_proposta_automaticos_whatsapp()<>2 then
    raise exception 'Somente o primeiro elegivel e o ultimo com ACK entram na fila';
  end if;
  if (select esfriou_em from public.leads where id=v_primeiro) is distinct from a-interval '1 hour'
    or (select status from public.leads where id=v_fronteira) is distinct from 'esfriou' then
    raise exception 'A entrada automatica usa o vencimento exato de 7 dias';
  end if;
  if exists(select 1 from public.whatsapp_outbox where lead_id in
    (v_fronteira,v_entrada_manual,v_legado_fora_da_janela,v_evento_passado,v_sem_ack)) then
    raise exception 'Prazo futuro, evento passado ou historico sem ACK nao pode enfileirar';
  end if;
  if not exists(select 1 from public.whatsapp_outbox where lead_id=v_ultimo and tipo='lembrete_proposta_30d'
    and ocorrido_em=a-interval '5 minutes' and expira_em=a+interval '23 hours 55 minutes') then
    raise exception 'Ultima tentativa aguarda 15 min apos o maior marco e expira desde esse prazo';
  end if;

  select * into v_job from public.reivindicar_whatsapp_v7(false,null,true,false);
  if v_job.lead_id is distinct from v_primeiro or v_job.solicitado_por is not null then
    raise exception 'O worker normal precisa reivindicar a solicitacao automatica';
  end if;
  v_estado:=public.resultado_whatsapp_v7(v_job.id,v_job.lease_token,'started',null,false,null,true,false,
    a,a-interval '60 days',a-interval '1 day',true);
  if v_estado is not null or not exists(select 1 from public.whatsapp_outbox
    where id=v_job.id and ultimo_codigo='inactivity_recent' and estado='cancelado') then
    raise exception 'Conversa recente bloqueia o inicio na mesma fila: %, %',v_estado,
      (select ultimo_codigo from public.whatsapp_outbox where id=v_job.id);
  end if;
  if public.enfileirar_lembretes_proposta_automaticos_whatsapp()<>0 then
    raise exception 'Rodada seguinte nao repete o lembrete bloqueado';
  end if;

  select * into v_job from public.reivindicar_whatsapp_v7(false,null,true,false);
  if v_job.lead_id is distinct from v_ultimo then raise exception 'O worker deve reservar a ultima tentativa'; end if;
  update public.whatsapp_lembretes_proposta_config set ativa=false where id=1;
  if public.resultado_whatsapp_v7(v_job.id,v_job.lease_token,'started',null,false,null,true,false,
    a,a-interval '60 days',v_ack,true) is not null then
    raise exception 'Botao desligado precisa recusar o lease automatico ja reservado';
  end if;
  v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_ultimo,30,a-interval '31 days',v_ator);
  if (v_json->>'id')::uuid is distinct from v_job.id or not exists(select 1 from public.whatsapp_outbox
    where id=v_job.id and solicitado_por=v_ator and entrada_esfriou_automatica_em is null) then
    raise exception 'Clique manual com automacao pausada reutiliza o job, agora sem origem automatica';
  end if;
  select * into v_job from public.reivindicar_whatsapp_v7(false,null,true,false);
  if public.resultado_whatsapp_v7(v_job.id,v_job.lease_token,'started',null,false,null,true,false,
    a,a-interval '60 days',v_ack,true) is distinct from 'enviando' then
    raise exception 'Pausar a configuracao nao bloqueia STARTED manual';
  end if;
  if public.resultado_whatsapp_v7(v_job.id,v_job.lease_token,'sent',null,false,null,true,false,
    null,null,null,false) is distinct from 'enviado' then
    raise exception 'O ACK continua passando pelo caminho normal';
  end if;
  update public.whatsapp_lembretes_proposta_config set ativa=true where id=1;
  if (select ativada_em from public.whatsapp_lembretes_proposta_config where id=1) is distinct from a then
    raise exception 'Reativar reinicia o corte pelo relogio do banco';
  end if;
end;
$$;
rollback;
