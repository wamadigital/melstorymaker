-- SOMENTE Postgres isolado com dados ficticios; nunca aplicar em producao.
-- Requer leads(id,status,whatsapp,created_at), roles anon/authenticated/service_role,
-- whatsapp-outbox.sql, whatsapp-lembrete-formulario.sql, quadro-tempo-real.sql
-- e quadro-whatsapp.sql aplicados.
-- O schema realtime pode ser um stub; realtime.send REAL nao pode existir.
-- psql -v ON_ERROR_STOP=1 -f este_arquivo. Tudo termina em ROLLBACK.
begin;

do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    raise exception 'Fixture exige Postgres isolado SEM realtime.send real';
  end if;
  if (select count(*) from pg_trigger where tgrelid='public.whatsapp_outbox'::regclass
    and tgname='whatsapp_outbox_avisar_quadro' and not tgisinternal) is distinct from 1 then
    raise exception 'Trigger ausente ou duplicado';
  end if;
end;
$$;

create schema if not exists realtime;
create temporary table avisos_quadro (
  payload jsonb, evento text, topico text, privado boolean
) on commit drop;
grant select, insert, delete, truncate on pg_temp.avisos_quadro to service_role;
grant usage on schema realtime to service_role;
create function realtime.send(p_payload jsonb,p_event text,p_topic text,p_private boolean)
returns void language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if current_setting('mel.teste_broadcast_falha',true)='true' then
    raise exception 'broadcast ficticio indisponivel';
  end if;
  insert into pg_temp.avisos_quadro values(p_payload,p_event,p_topic,p_private);
end;
$$;
revoke execute on function realtime.send(jsonb,text,text,boolean) from public;
grant execute on function realtime.send(jsonb,text,text,boolean) to service_role;

set local role service_role;
do $$
declare
  v_lead uuid := 'af555555-0000-4000-8000-000000000001';
  v_job public.whatsapp_outbox%rowtype;
  v_lead_antes jsonb;
  v_estado text;
  v_retorno text;
  v_agora timestamptz := statement_timestamp();
begin
  insert into public.leads(id,status,whatsapp,created_at)
    values(v_lead,'aguardando_revisao','19988887777',v_agora);
  select to_jsonb(l) into v_lead_antes from public.leads l where id=v_lead;
  -- O INSERT do lead usa a campainha antiga; daqui em diante so a outbox muda.
  truncate pg_temp.avisos_quadro;
  insert into public.whatsapp_outbox(lead_id,ocorrido_em,expira_em,destinatario,mensagem)
    values(v_lead,v_agora,v_agora+interval '24 hours','5519988887777','Mensagem ficticia')
    returning * into v_job;
  if exists(select 1 from pg_temp.avisos_quadro) then raise exception 'INSERT da outbox avisou'; end if;

  foreach v_estado in array array['reservado','enviando','indeterminado','cancelado','expirado'] loop
    update public.whatsapp_outbox set estado=v_estado where id=v_job.id;
  end loop;
  if exists(select 1 from pg_temp.avisos_quadro) then raise exception 'Etapa sem envio avisou'; end if;

  update public.whatsapp_outbox set estado='indeterminado',lease_token=gen_random_uuid(),
    lease_ate=v_agora-interval '1 second',iniciado_em=v_agora where id=v_job.id returning * into v_job;
  -- ACK tardio verdadeiro: deve atualizar o quadro mesmo sem tocar o lead.
  v_retorno := public.resultado_whatsapp(v_job.id,v_job.lease_token,'sent');
  if v_retorno is distinct from 'enviado'
    or (select count(*) from pg_temp.avisos_quadro) is distinct from 1
    or exists(select 1 from pg_temp.avisos_quadro where payload is distinct from '{}'::jsonb
      or evento is distinct from 'mudou' or topico is distinct from 'quadro-leads' or privado is distinct from true) then
    raise exception 'ACK nao publicou exatamente uma campainha privada e vazia';
  end if;

  v_retorno := public.resultado_whatsapp(v_job.id,v_job.lease_token,'sent');
  update public.whatsapp_outbox set ultimo_codigo=null,tentativas=tentativas+1 where id=v_job.id;
  update public.whatsapp_outbox set enviado_em=v_agora+interval '1 second' where id=v_job.id;
  if v_retorno is distinct from 'enviado'
    or (select count(*) from pg_temp.avisos_quadro) is distinct from 1 then
    raise exception 'ACK duplicado, metadados ou correcao de carimbo avisaram';
  end if;

  update public.whatsapp_outbox set estado='enviando',enviado_em=null where id=v_job.id;
  update public.whatsapp_outbox set estado='enviado' where id=v_job.id;
  update public.whatsapp_outbox set enviado_em=v_agora where id=v_job.id;
  if (select count(*) from pg_temp.avisos_quadro) is distinct from 1 then
    raise exception 'Sem carimbo ou sem transicao para enviado houve aviso';
  end if;

  update public.whatsapp_outbox set estado='enviando',enviado_em=null where id=v_job.id;
  perform set_config('mel.teste_broadcast_falha','true',true);
  v_retorno := public.resultado_whatsapp(v_job.id,v_job.lease_token,'sent');
  if v_retorno is distinct from 'enviado'
    or (select estado from public.whatsapp_outbox where id=v_job.id) is distinct from 'enviado'
    or (select enviado_em from public.whatsapp_outbox where id=v_job.id) is null
    or (select count(*) from pg_temp.avisos_quadro) is distinct from 1 then
    raise exception 'Falha no Broadcast desfez ACK ou inventou aviso';
  end if;
  if (select to_jsonb(l) from public.leads l where id=v_lead) is distinct from v_lead_antes then
    raise exception 'Trigger alterou dados/carimbos do lead';
  end if;
end;
$$;

-- O ACK da sequencia V3 completa usa a mesma campainha, inclusive quando chega
-- atrasado. Nenhuma parte intermediaria do lembrete atualiza o historico.
do $$
declare
  v_agora timestamptz := statement_timestamp();
  v_corte timestamptz := statement_timestamp()-interval '7 days';
  v_lead uuid := 'af555555-0000-4000-8000-000000000002';
  v_job public.whatsapp_outbox%rowtype;
  v_retorno text;
  v_lead_antes jsonb;
  v_mensagens jsonb := '[
    {"message":"Olá! Aqui é a Mel Storymaker 👋","delayBeforeSeconds":0},
    {"message":"Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊","delayBeforeSeconds":2},
    {"message":"Suas respostas estão salvas, acesse o link:","delayBeforeSeconds":3}
  ]';
begin
  perform set_config('mel.teste_broadcast_falha','false',true);
  insert into public.leads(id,status,whatsapp,created_at)
    values(v_lead,'incompleto','19988887777',v_agora-interval '25 hours');
  select to_jsonb(l) into v_lead_antes from public.leads l where id=v_lead;
  truncate pg_temp.avisos_quadro;
  perform public.enfileirar_lembretes_formulario_whatsapp_v3(v_corte,v_mensagens,'https://crm.invalid');
  select * into v_job from public.reivindicar_whatsapp_v3(true,v_corte);
  if v_job.lead_id is distinct from v_lead then raise exception 'Lembrete ficticio nao reivindicado'; end if;
  for v_i in 1..4 loop
    v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'started',null,true,v_corte);
    if v_retorno is distinct from 'enviando' then raise exception 'Parte ficticia nao autorizada'; end if;
  end loop;
  if exists(select 1 from pg_temp.avisos_quadro) then raise exception 'Parte intermediaria avisou'; end if;
  v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'sent',null,true,v_corte);
  if v_retorno is distinct from 'enviado'
    or (select count(*) from pg_temp.avisos_quadro) is distinct from 1 then
    raise exception 'ACK da sequencia nao publicou uma vez';
  end if;
  v_retorno := public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'sent',null,true,v_corte);
  if v_retorno is distinct from 'enviado'
    or (select count(*) from pg_temp.avisos_quadro) is distinct from 1
    or (select to_jsonb(l) from public.leads l where id=v_lead) is distinct from v_lead_antes then
    raise exception 'ACK repetido da sequencia avisou ou alterou lead';
  end if;
end;
$$;
reset role;
rollback;
