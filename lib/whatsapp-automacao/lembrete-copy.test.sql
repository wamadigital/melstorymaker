-- SOMENTE Postgres isolado, depois dos tres SQLs de WhatsApp.
-- Simula a copy anterior, aplica o delta real e valida preservacao + bloqueios.
-- psql -v ON_ERROR_STOP=1 -f este_arquivo. O delta inclui COMMIT: destruir
-- o banco/container isolado ao terminar. NUNCA executar em projeto Supabase.
set timezone = 'UTC';

-- Reconstrucao do contrato antigo somente dentro deste fixture isolado.
alter table public.whatsapp_outbox drop constraint whatsapp_outbox_sequencia_check;
select replace(pg_get_functiondef(
  'public.sequencia_lembrete_formulario_valida(jsonb,uuid,text)'::regprocedure),
  'Suas respostas estão salvas, acesse o link:',
  'Suas respostas estão salvas. Para continuar de onde parou:')
\gexec
alter table public.whatsapp_outbox add constraint whatsapp_outbox_sequencia_check check (
  (tipo = 'confirmacao_recebimento' and sequencia is null)
  or (tipo = 'lembrete_formulario_24h' and (sequencia is null
    or public.sequencia_lembrete_formulario_valida(sequencia, lead_id, mensagem))));

insert into public.leads(id,status,whatsapp,created_at)
select ('ac444444-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
  'incompleto','19988887777',now()-interval '25 hours'
from generate_series(1,12) g;

with partes as (
  select id, jsonb_build_array(
    jsonb_build_object('message','Olá! Aqui é a Mel Storymaker 👋','delayBeforeSeconds',0),
    jsonb_build_object('message','Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊','delayBeforeSeconds',2),
    jsonb_build_object('message','Suas respostas estão salvas. Para continuar de onde parou:','delayBeforeSeconds',3),
    jsonb_build_object('message','https://crm.invalid/continuar/'||id::text,'delayBeforeSeconds',2)) as seq,
    row_number() over(order by id)::integer as n
  from public.leads where id::text like 'ac444444%'
), dados as (
  select *, (array['pendente','reservado','enviando','enviado','indeterminado','expirado','cancelado',
    'pendente','reservado','enviando'])[n] as estado from partes where n<=10
)
insert into public.whatsapp_outbox
  (lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,estado,
   lease_token,lease_ate,iniciado_em,enviado_em,tentativas)
select id,'lembrete_formulario_24h',now(),now()+interval '24 hours','5519988887777',
  case when n<=7 then (seq#>>'{0,message}')||E'\n\n'||(seq#>>'{1,message}')
    ||E'\n\n'||(seq#>>'{2,message}')||E'\n\n'||(seq#>>'{3,message}') else 'Legado NULL' end,
  case when n<=7 then seq else null end,estado,gen_random_uuid(),now()+interval '180 seconds',
  case when estado in ('enviando','enviado','indeterminado') then now()-interval '1 second' end,
  case when estado='enviado' then now() end,1
from dados;

create temp table snapshots_anteriores as
  select id,lead_id,estado,to_jsonb(o) as linha from public.whatsapp_outbox o;

\ir ../../supabase/whatsapp-lembrete-copy.sql

do $$
declare
  v_antigo jsonb := jsonb_build_array(
    jsonb_build_object('message','Olá! Aqui é a Mel Storymaker 👋','delayBeforeSeconds',0),
    jsonb_build_object('message','Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊','delayBeforeSeconds',2),
    jsonb_build_object('message','Suas respostas estão salvas. Para continuar de onde parou:','delayBeforeSeconds',3));
  v_novo jsonb := jsonb_set(v_antigo,'{2,message}',to_jsonb('Suas respostas estão salvas, acesse o link:'::text));
  v_job public.whatsapp_outbox%rowtype;
  v_anterior record;
  v_estado text;
  v_seq jsonb;
  v_texto text;
begin
  -- Inclui o equivalente ao Teste 1 ja enviado: nem o carimbo muda.
  if exists(select 1 from snapshots_anteriores a join public.whatsapp_outbox o using(id)
    where a.estado in ('enviado','indeterminado','expirado','cancelado')
      and to_jsonb(o) is distinct from a.linha) then
    raise exception 'Delta alterou algum fato historico terminal';
  end if;
  if exists(select 1 from snapshots_anteriores a join public.whatsapp_outbox o using(id)
    where o.mensagem is distinct from a.linha->>'mensagem'
      or to_jsonb(o)->'sequencia' is distinct from a.linha->'sequencia') then
    raise exception 'Delta reescreveu snapshot anterior';
  end if;
  if exists(select 1 from snapshots_anteriores a join public.whatsapp_outbox o using(id)
    where a.estado in ('pendente','reservado')
      and (o.estado<>'cancelado' or o.lease_token is not null or o.lease_ate is not null)) then
    raise exception 'Copy anterior/NULL ainda pode ser reivindicada';
  end if;
  for v_anterior in select * from snapshots_anteriores where estado='enviando' loop
    select * into v_job from public.whatsapp_outbox where id=v_anterior.id;
    if v_job.estado<>'indeterminado' or v_job.lease_token::text is distinct from v_anterior.linha->>'lease_token'
      or public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'started',null,true,now()-interval '2 days') is not null then
      raise exception 'Copy antiga/NULL continuou enviavel ou perdeu seu token';
    end if;
    if public.resultado_whatsapp(v_job.id,gen_random_uuid(),'sent') is not null
      or public.resultado_whatsapp(v_job.id,v_job.lease_token,'sent') is distinct from 'enviado' then
      raise exception 'Reconciliacao tardia nao respeitou token/snapshot antigo';
    end if;
  end loop;

  if public.enfileirar_lembretes_formulario_whatsapp_v3(now()-interval '2 days',v_antigo,'https://crm.invalid')<>0
    or exists(select 1 from public.reivindicar_whatsapp_v3(true,now()-interval '2 days')) then
    raise exception 'Copy antiga voltou ao preparo ou claim';
  end if;
  v_seq := v_antigo||jsonb_build_array(jsonb_build_object('message',
    'https://crm.invalid/continuar/ac444444-0000-4000-8000-000000000012','delayBeforeSeconds',2));
  v_texto := (v_seq#>>'{0,message}')||E'\n\n'||(v_seq#>>'{1,message}')||E'\n\n'
    ||(v_seq#>>'{2,message}')||E'\n\n'||(v_seq#>>'{3,message}');
  foreach v_estado in array array['pendente','reservado','enviando'] loop
    begin
      insert into public.whatsapp_outbox
        (lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,estado)
      values('ac444444-0000-4000-8000-000000000012','lembrete_formulario_24h',now(),now()+interval '24 hours',
        '5519988887777',v_texto,v_seq,v_estado);
      raise exception 'CHECK aceitou copy antiga ativa: %',v_estado;
    exception when check_violation then null;
    end;
    begin
      update public.whatsapp_outbox set estado=v_estado
        where lead_id='ac444444-0000-4000-8000-000000000004';
      raise exception 'Historico antigo foi rearmado: %',v_estado;
    exception when check_violation then null;
    end;
  end loop;
  if public.enfileirar_lembretes_formulario_whatsapp_v3(now()-interval '2 days',v_novo,'https://crm.invalid')<>2 then
    raise exception 'Copy nova nao enfileirou exclusivamente os dois leads sem historico';
  end if;
  select * into v_job from public.reivindicar_whatsapp_v3(true,now()-interval '2 days');
  if not found or v_job.sequencia#>>'{2,message}'<>'Suas respostas estão salvas, acesse o link:'
    or public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'started',null,true,now()-interval '2 days')<>'enviando'
    or public.resultado_whatsapp(v_job.id,v_job.lease_token,'sent')<>'enviado' then
    raise exception 'Copy nova perdeu claim/started/ACK';
  end if;
end;
$$;

-- Reaplicar e inofensivo: nada reenfileira nem muda estados ou carimbos.
create temp table snapshots_reaplicacao as select id,to_jsonb(o) as linha from public.whatsapp_outbox o;
\ir ../../supabase/whatsapp-lembrete-copy.sql
do $$
begin
  if exists(select 1 from snapshots_reaplicacao a full join public.whatsapp_outbox o using(id)
    where to_jsonb(o) is distinct from a.linha) then
    raise exception 'Reaplicacao do delta alterou algum snapshot';
  end if;
  if not (select convalidated from pg_constraint
    where conrelid='public.whatsapp_outbox'::regclass and conname='whatsapp_outbox_sequencia_check') then
    raise exception 'CHECK nova nao foi validada';
  end if;
end;
$$;
