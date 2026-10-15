-- SOMENTE Postgres 17 isolado, apos os quatro SQLs atuais de WhatsApp e
-- whatsapp-lembretes-proposta.sql. Nunca executar no Supabase de producao.
-- Requer leads com enviado_em/pdf_url/lembrete_7_em/lembrete_30_em.
begin;
set local timezone='UTC';

do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    raise exception 'Fixture exige Postgres isolado SEM realtime.send real';
  end if;
  if has_function_privilege('anon','public.enfileirar_lembrete_proposta_whatsapp(uuid,integer,timestamptz,uuid)','EXECUTE')
    or has_function_privilege('authenticated','public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean)','EXECUTE')
    or has_function_privilege('anon','public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean)','EXECUTE')
    or has_table_privilege('authenticated','public.whatsapp_outbox','SELECT')
    or exists(select 1 from pg_policy where polrelid='public.whatsapp_outbox'::regclass)
    or not (select relrowsecurity from pg_class where oid='public.whatsapp_outbox'::regclass) then
    raise exception 'RPC/outbox de proposta ficou publica';
  end if;
  if exists(select 1 from pg_proc where pronamespace='public'::regnamespace
    and proname in ('enfileirar_lembrete_proposta_whatsapp','reivindicar_whatsapp_v4','resultado_whatsapp_v4',
      'sequencia_lembrete_proposta','sequencia_lembrete_proposta_valida','recusa_lembrete_proposta_whatsapp')
    and (prosecdef or proconfig is distinct from array['search_path=pg_catalog'])) then
    raise exception 'RPC de proposta nao e invoker com search_path fechado';
  end if;
end;
$$;

create temporary table avisos_proposta_teste(tipo text,estado text) on commit drop;
grant select,insert on pg_temp.avisos_proposta_teste to service_role;
create or replace function public.avisar_quadro()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$ begin insert into pg_temp.avisos_proposta_teste values(new.tipo,new.estado); return new; end; $$;

set local role service_role;
do $$
declare
  v_agora timestamptz:=statement_timestamp();
  v_admin uuid:='ad000000-0000-4000-8000-000000000001';
  v_id uuid; v_job public.whatsapp_outbox%rowtype; v_outro public.whatsapp_outbox%rowtype;
  v_json jsonb; v_novo jsonb; v_seq jsonb; v_texto text; v_i integer; v_primeiro uuid;
  v_retorno text; v_carimbo timestamptz; v_avisos integer;
begin
  insert into public.leads(id,status,whatsapp,created_at,enviado_em,pdf_url)
  select ('af666666-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'esfriou','19988887777',
    v_agora-interval '40 days',v_agora-interval '31 days','https://crm.invalid/p/'||g
  from generate_series(1,15) g;
  update public.leads set enviado_em=v_agora-interval '7 days' where id='af666666-0000-4000-8000-000000000001';
  update public.leads set enviado_em=v_agora-interval '7 days'+interval '1 second' where id='af666666-0000-4000-8000-000000000002';
  update public.leads set status='virou_cliente' where id='af666666-0000-4000-8000-000000000003';
  update public.leads set pdf_url=null where id='af666666-0000-4000-8000-000000000004';
  update public.leads set whatsapp='00988887777' where id='af666666-0000-4000-8000-000000000005';
  update public.leads set enviado_em=null where id='af666666-0000-4000-8000-000000000006';
  update public.leads set lembrete_7_em=v_agora-interval '16 days' where id='af666666-0000-4000-8000-000000000008';
  update public.leads set status='incompleto',enviado_em=null,created_at=v_agora-interval '25 hours'
    where id='af666666-0000-4000-8000-000000000013';
  for v_i in 1..9 loop
    v_id:=case when v_i=9 then 'af666666-0000-4000-8000-000000000008'::uuid
      else ('af666666-0000-4000-8000-'||lpad(v_i::text,12,'0'))::uuid end;
    v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_id,case when v_i in (7,8,9) then 30 else 7 end,
      case when v_i=1 then v_agora-interval '7 days' when v_i=2 then v_agora-interval '7 days'+interval '1 second'
        else v_agora-interval '31 days' end,case when v_i=1 then null else v_admin end);
    if v_json->>'erro' is distinct from (array['payload_invalido','prazo_nao_atingido','coluna_invalida',
      'proposta_ausente','telefone_invalido','proposta_alterada','lembrete_7_nao_enviado',
      'lembrete_7_nao_enviado','lembrete_7_nao_enviado'])[v_i] then
      raise exception 'Enqueue recusou incorretamente caso %: %',v_i,v_json;
    end if;
  end loop;
  if exists(select 1 from public.whatsapp_outbox) then raise exception 'Regras invalidas criaram fila'; end if;

  -- Um clique cria snapshot fechado, mas nao carimba nem dispara nada.
  v_id:='af666666-0000-4000-8000-000000000001';
  v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_id,7,v_agora-interval '7 days',v_admin);
  v_primeiro:=(v_json->>'id')::uuid;
  if v_primeiro is null or v_json->>'estado'<>'pendente' then raise exception 'Clique valido nao enfileirou'; end if;
  v_novo:=public.enfileirar_lembrete_proposta_whatsapp(v_id,7,v_agora-interval '7 days',v_admin);
  if v_novo->>'id'<>v_json->>'id' or (select count(*) from public.whatsapp_outbox)<>1
    or (select lembrete_7_em from public.leads where id=v_id) is not null then
    raise exception 'Clique duplo duplicou ou afirmou envio';
  end if;
  if exists(select 1 from public.reivindicar_whatsapp_v4(false,null,false))
    or exists(select 1 from public.reivindicar_whatsapp_v3(true,v_agora-interval '50 days')) then
    raise exception 'Flag desligada ou worker V3 recebeu proposta';
  end if;
  select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
  if v_job.id is distinct from v_primeiro or v_job.solicitado_por<>v_admin
    or v_job.sequencia#>>'{0,message}'<>'Olá, como vai?!'
    or v_job.sequencia#>>'{2,message}'<>'https://crm.invalid/p/1'
    or v_job.sequencia#>>'{3,delayBeforeSeconds}'<>'2' then raise exception 'Claim/snapshot 7d incorreto'; end if;
  if public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'failed','inactivity_unverified',false,null,true,
    null,null,null,false) is distinct from 'cancelado' then raise exception 'Historico desconhecido nao foi terminal antes do MCP'; end if;
  if (select iniciado_em from public.whatsapp_outbox where id=v_job.id) is not null then raise exception 'Falha pre-MCP afirmou inicio'; end if;

  -- Novo clique, nao um timer, pode tentar novamente apenas o que nunca iniciou.
  for v_i in 1..3 loop
    v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_id,7,v_agora-interval '7 days',v_admin);
    if v_json->>'id'<>v_primeiro::text or v_json->>'estado'<>'pendente' then raise exception 'Novo clique pre-MCP perdeu CAS'; end if;
    select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
    v_retorno:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,
      case when v_i=1 then v_agora-interval '31 seconds' else v_agora end,
      case when v_i=2 then v_agora-interval '4 days' else v_agora-interval '6 days' end,
      case when v_i=3 then v_agora-interval '1 day' else null end,true);
    if v_retorno is not null or (select estado from public.whatsapp_outbox where id=v_job.id)<>'cancelado' then
      raise exception 'Historico obsoleto/incompleto/recente permitiu inicio: %',v_i;
    end if;
  end loop;
  perform public.enfileirar_lembrete_proposta_whatsapp(v_id,7,v_agora-interval '7 days',v_admin);
  select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
  for v_i in 1..4 loop
    v_retorno:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,
      v_agora,v_agora-interval '6 days',v_agora-interval '5 days',true);
    if v_retorno is distinct from 'enviando' then raise exception 'Parte7 valida recusada: %',v_i; end if;
    if v_i=1 then select count(*) into v_avisos from pg_temp.avisos_proposta_teste;
    elsif (select count(*) from pg_temp.avisos_proposta_teste)<>v_avisos then raise exception 'Heartbeat entre partes notificou novamente'; end if;
  end loop;
  if (select lembrete_7_em from public.leads where id=v_id) is not null
    or (select enviado_em from public.whatsapp_outbox where id=v_job.id) is not null then
    raise exception 'Parte intermediaria carimbou envio';
  end if;
  v_retorno:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'sent',null,false,null,false,null,null,null,false);
  if v_retorno<>'enviado'
    or (select lembrete_7_em from public.leads where id=v_id) is distinct from v_agora
    or (select count(*) from pg_temp.avisos_proposta_teste)<>v_avisos+1 then
    raise exception 'ACK final7 pausado nao registrou o fato';
  end if;
  select enviado_em into v_carimbo from public.whatsapp_outbox where id=v_job.id;
  perform public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'sent',null,false,null,false,null,null,null,false);
  if (select enviado_em from public.whatsapp_outbox where id=v_job.id) is distinct from v_carimbo
    or public.enfileirar_lembrete_proposta_whatsapp(v_id,7,v_agora-interval '7 days',v_admin)->>'erro'<>'ja_enviado' then
    raise exception 'ACK/click repetido duplicou 7d';
  end if;

  -- Predecessor7 e uma entrega completa da MESMA revisao, nao o carimbo manual.
  for v_i in 9..10 loop
    v_id:=('af666666-0000-4000-8000-'||lpad(v_i::text,12,'0'))::uuid;
    v_seq:=public.sequencia_lembrete_proposta('lembrete_proposta_7d','https://crm.invalid/p/'||v_i);
    select string_agg(p.value->>'message',E'\n\n' order by p.n) into v_texto from jsonb_array_elements(v_seq) with ordinality p(value,n);
    insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,estado,
      proposta_enviado_em,proposta_pdf_url,solicitado_em,solicitado_por,iniciado_em,enviado_em,lease_token)
    values(v_id,'lembrete_proposta_7d',v_agora-interval '16 days',v_agora-interval '15 days','5519988887777',v_texto,v_seq,'enviado',
      v_agora-interval '31 days','https://crm.invalid/p/'||v_i,v_agora-interval '16 days',v_admin,v_agora-interval '16 days',
      case when v_i=9 then v_agora-interval '16 days' else v_agora-interval '14 days' end,gen_random_uuid());
  end loop;
  v_json:=public.enfileirar_lembrete_proposta_whatsapp('af666666-0000-4000-8000-000000000010',30,v_agora-interval '31 days',v_admin);
  if v_json->>'erro'<>'lembrete_7_recente' then raise exception '30d ignorou interacao do proprio 7d'; end if;
  v_json:=public.enfileirar_lembrete_proposta_whatsapp('af666666-0000-4000-8000-000000000009',30,v_agora-interval '31 days',v_admin);
  if v_json->>'id' is null then raise exception '30d elegivel nao enfileirou: %',v_json; end if;
  select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
  if jsonb_array_length(v_job.sequencia)<>5 or v_job.tipo<>'lembrete_proposta_30d'
    or v_job.sequencia#>>'{4,message}'<>'Desde já, agradeço ✨'
    or v_job.sequencia#>>'{4,delayBeforeSeconds}'<>'5' then raise exception 'Snapshot30 incorreto'; end if;
  for v_i in 1..5 loop
    v_retorno:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,
      v_agora,v_agora-interval '16 days',v_agora-interval '16 days',true);
    if v_retorno is distinct from 'enviando' then raise exception 'Parte30 valida recusada'; end if;
  end loop;
  v_retorno:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'sent',null,false,null,false,null,null,null,false);
  if v_retorno<>'enviado'
    or (select lembrete_30_em from public.leads where id=v_job.lead_id) is distinct from v_agora then
    raise exception 'ACK30 nao carimbou';
  end if;

  -- Mudanca entre partes nunca volta a pendente nem pode receber novo clique.
  v_id:='af666666-0000-4000-8000-000000000011';
  perform public.enfileirar_lembrete_proposta_whatsapp(v_id,7,v_agora-interval '31 days',v_admin);
  select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
  perform public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,
    v_agora,v_agora-interval '6 days',null,true);
  update public.leads set status='enviado',pdf_url='https://crm.invalid/p/alterado' where id=v_id;
  v_retorno:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,
    v_agora,v_agora-interval '6 days',null,true);
  if v_retorno is not null
    or (select estado from public.whatsapp_outbox where id=v_job.id)<>'indeterminado'
    or public.enfileirar_lembrete_proposta_whatsapp(v_id,7,v_agora-interval '31 days',v_admin)->>'erro'<>'envio_indeterminado' then
    raise exception 'Proposta alterada continuou ou repetiu a sequencia';
  end if;
  update public.leads set enviado_em=v_agora where id=v_id;
  v_retorno:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'sent',null,false,null,false,null,null,null,false);
  if v_retorno<>'enviado'
    or (select lembrete_7_em from public.leads where id=v_id) is not null then
    raise exception 'ACK tardio alterou a revisao nova';
  end if;
  -- Historico antigo nao impede outro envio de uma NOVA revisao elegivel.
  update public.leads set enviado_em=v_agora-interval '8 days' where id=v_id;
  v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_id,7,v_agora-interval '8 days',v_admin);
  if v_json->>'id' is null or v_json->>'id'=v_job.id::text then raise exception 'Nova revisao perdeu historico/idempotencia'; end if;
  select * into v_outro from public.reivindicar_whatsapp_v4(false,null,true);
  if public.resultado_whatsapp_v4(v_outro.id,v_outro.lease_token,'failed','inactivity_recent',false,null,true,null,null,null,false)<>'cancelado' then
    raise exception 'Interacao recente nao cancelou antes do MCP';
  end if;
  if exists(select 1 from public.reivindicar_whatsapp_v4(false,null,true)) then raise exception 'Timer rearmou cancelado'; end if;

  -- Sem evidencia de clique e copy/pausas aprovadas, INSERT direto tambem falha.
  v_id:='af666666-0000-4000-8000-000000000012';
  v_seq:=public.sequencia_lembrete_proposta('lembrete_proposta_7d','https://crm.invalid/p/12');
  select string_agg(p.value->>'message',E'\n\n' order by p.n) into v_texto from jsonb_array_elements(v_seq) with ordinality p(value,n);
  begin
    insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,proposta_enviado_em,proposta_pdf_url)
    values(v_id,'lembrete_proposta_7d',v_agora,v_agora+interval '24 hours','5519988887777',v_texto,v_seq,v_agora-interval '31 days','https://crm.invalid/p/12');
    raise exception 'INSERT sem clique entrou na fila';
  exception when check_violation then null;
  end;
  if public.sequencia_lembrete_proposta_valida(jsonb_set(v_seq,'{1,delayBeforeSeconds}','0'),'lembrete_proposta_7d','https://crm.invalid/p/12',v_texto)
    or public.sequencia_lembrete_proposta('lembrete_proposta_30d','http://crm.invalid') is not null then
    raise exception 'Copy/pausa/URL nao aprovada foi aceita';
  end if;

  -- Limites de 30d/TTL e falha depois do inicio sao conferidos no servidor.
  v_id:='af666666-0000-4000-8000-000000000015';
  update public.leads set enviado_em=v_agora-interval '30 days'+interval '1 second' where id=v_id;
  if public.enfileirar_lembrete_proposta_whatsapp(v_id,30,v_agora-interval '30 days'+interval '1 second',v_admin)->>'erro'<>'prazo_nao_atingido' then
    raise exception '30d antecipou o prazo';
  end if;
  v_id:='af666666-0000-4000-8000-000000000014';
  perform public.enfileirar_lembrete_proposta_whatsapp(v_id,7,v_agora-interval '31 days',v_admin);
  select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
  perform public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,
    v_agora,v_agora-interval '6 days',null,true);
  if public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'failed','bridge_error',false,null,false,null,null,null,false)<>'indeterminado' then
    raise exception 'Falha depois de started permitiu repetir';
  end if;
  if public.enfileirar_lembrete_proposta_whatsapp(v_id,7,v_agora-interval '31 days',v_admin)->>'erro'<>'envio_indeterminado' then
    raise exception 'Clique repetiu sequencia parcial';
  end if;

  -- A mudanca do indice preserva o formulario4partes e seu limite unico.
  v_seq:='[{"message":"Olá! Aqui é a Mel Storymaker 👋","delayBeforeSeconds":0},
    {"message":"Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊","delayBeforeSeconds":2},
    {"message":"Suas respostas estão salvas, acesse o link:","delayBeforeSeconds":3}]';
  if public.enfileirar_lembretes_formulario_whatsapp_v3(v_agora-interval '2 days',v_seq,'https://crm.invalid')<>1
    or public.enfileirar_lembretes_formulario_whatsapp_v3(v_agora-interval '2 days',v_seq,'https://crm.invalid')<>0 then
    raise exception 'Indice parcial quebrou idempotencia do formulario';
  end if;
  select * into v_job from public.reivindicar_whatsapp_v4(true,v_agora-interval '2 days',false);
  if v_job.tipo<>'lembrete_formulario_24h'
    or public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,true,v_agora-interval '2 days',false,null,null,null,false)<>'enviando'
    or public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'sent',null,false,null,false,null,null,null,false)<>'enviado' then
    raise exception 'V4 regrediu formulario V3';
  end if;
end;
$$;
reset role;
rollback;
