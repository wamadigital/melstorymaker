-- SOMENTE Postgres descartavel com schema.sql + eventos-passados.sql.
-- Sem cron, rede, realtime.send real, APIs ou mensagens. Tudo termina em ROLLBACK.
begin;
set local client_min_messages=error;
create function pg_temp.verificar(ok boolean,motivo text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FALHOU: %',motivo; end if; end; $$;
create function pg_temp.agora() returns timestamptz language sql volatile as $$
  select current_setting('test.eventos_clock')::timestamptz;
$$;
select set_config('test.eventos_clock','2026-10-23 12:00:00-03',true);
do $$
declare f regprocedure;
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    raise exception 'Fixture exige Postgres isolado SEM realtime.send real';
  end if;
  if exists(select 1 from public.leads) or exists(select 1 from public.whatsapp_outbox) then
    raise exception 'Fixture exige banco vazio e descartavel';
  end if;
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace='public'::regnamespace
    and p.proname in ('evento_ja_passou','preservar_encerramento_evento','sincronizar_assinatura_encerramento_evento','encerrar_eventos_passados',
      'recusa_lembrete_proposta_whatsapp','reivindicar_preparo_proposta_whatsapp',
      'concluir_preparo_proposta_whatsapp','recusa_proposta_inicial_whatsapp',
      'enfileirar_lembretes_formulario_whatsapp_v6','reivindicar_whatsapp_v6','resultado_whatsapp_v6') loop
    perform pg_temp.verificar(not has_function_privilege('anon',f,'EXECUTE')
      and not has_function_privilege('authenticated',f,'EXECUTE')
      and has_function_privilege('service_role',f,'EXECUTE'),'RPCs somente service_role: '||f);
    perform pg_temp.verificar((select not prosecdef and proconfig=array['search_path=pg_catalog'] from pg_proc where oid=f),
      'invoker com search_path fechado: '||f);
  end loop;
  -- Congela o relogio SOMENTE dentro desta transacao, inclusive nas delegacoes.
  for f in select p.oid::regprocedure from pg_proc p where p.pronamespace='public'::regnamespace
    and p.prokind='f' and (p.prosrc like '%statement_timestamp()%' or p.prosrc like '%clock_timestamp()%') loop
    execute replace(replace(pg_get_functiondef(f),'statement_timestamp()','pg_temp.agora()'),'clock_timestamp()','pg_temp.agora()');
  end loop;
end;
$$;
-- O default da fila usa now(); a fixture o congela junto com os RPCs.
alter table public.whatsapp_outbox alter column proxima_tentativa_em set default pg_temp.agora();
select pg_temp.verificar(public.evento_ja_passou('2026-10-22','2026-10-23 00:00-03'),'ontem expira a meia-noite de SP');
select pg_temp.verificar(not public.evento_ja_passou('2026-10-22','2026-10-23 02:59:59+00'),'02h59UTC ainda e dia22 em SP');
select pg_temp.verificar(public.evento_ja_passou('2026-10-22','2026-10-23 03:00:00+00'),'03hUTC inicia dia23 em SP');
select pg_temp.verificar(not public.evento_ja_passou('2026-10-23','2026-10-23 23:59:59-03'),'hoje nao expira antes da meia-noite');
select pg_temp.verificar(not public.evento_ja_passou('2026-10-24','2026-10-23 12:00-03'),'futuro nao expira');
select pg_temp.verificar(not public.evento_ja_passou(null,pg_temp.agora()),'sem data permanece');
select pg_temp.verificar(not public.evento_ja_passou('2026-10-22',null),'sem relogio nao inventa hoje');

-- Simula cards legados ainda ativos: desliga somente o trigger novo na fixture.
alter table public.leads disable trigger leads_preservar_encerramento_evento;
insert into public.leads(id,categoria,status,data_evento,respostas,nome_display,enviado_em)
select ('ea000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
  (array['casamento','aniversario','debutante','corporativo']::public.lead_categoria[])[1+(n-1)%4],
  (case n when 1 then 'incompleto' when 2 then 'aguardando_revisao' when 3 then 'enviado'
    when 4 then 'esfriou' when 5 then 'virou_cliente' when 9 then 'perdido' else 'enviado' end)::public.lead_status,
  case n when 10 then date '2026-10-23' when 11 then date '2026-10-24' when 12 then null else date '2026-10-22' end,
  jsonb_build_object('nome','TESTE SQL '||n),'TESTE SQL '||n,
  case when n=3 then timestamptz '2026-10-01 12:00-03' else null end
  from generate_series(1,12) n;
insert into public.contratos(lead_id,status,assinatura_status,assinado_em) values
  ('ea000000-0000-4000-8000-000000000006','assinado',null,null),
  ('ea000000-0000-4000-8000-000000000007','enviado','concluido',null),
  ('ea000000-0000-4000-8000-000000000008','enviado','enviado','2026-10-01 12:00-03');
alter table public.leads enable trigger leads_preservar_encerramento_evento;
create temp table antes as select id,to_jsonb(l)-'status'-'updated_at' dados from public.leads l;
-- Outbox ficticia valida: uma nunca iniciada e outra parcialmente iniciada.
create temp table config as select jsonb_build_array(
  jsonb_build_object('message','Olá! Aqui é a Mel Storymaker 👋','delayBeforeSeconds',0),
  jsonb_build_object('message','Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊','delayBeforeSeconds',2),
  jsonb_build_object('message','Suas respostas estão salvas, acesse o link:','delayBeforeSeconds',3)) mensagens;
insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,
  estado,iniciado_em,lease_token,lease_ate)
select l.id,'lembrete_formulario_24h',pg_temp.agora(),pg_temp.agora()+interval '24 hours','5519912345678',
  (c.mensagens#>>'{0,message}')||E'\n\n'||(c.mensagens#>>'{1,message}')||E'\n\n'||(c.mensagens#>>'{2,message}')||E'\n\nhttps://melstorymaker.com.br/continuar/'||l.id,
  c.mensagens||jsonb_build_array(jsonb_build_object('message','https://melstorymaker.com.br/continuar/'||l.id,'delayBeforeSeconds',2)),
  case when l.id::text like '%0001' then 'reservado' else 'enviando' end,
  case when l.id::text like '%0001' then null else pg_temp.agora() end,
  gen_random_uuid(),pg_temp.agora()+interval '180 seconds'
  from public.leads l cross join config c where l.id in
    ('ea000000-0000-4000-8000-000000000001','ea000000-0000-4000-8000-000000000003');
create temp table job_iniciado as select * from public.whatsapp_outbox where iniciado_em is not null;
create temp table encerrados as select * from public.encerrar_eventos_passados();
select pg_temp.verificar((select count(*)=4 from encerrados),'encerra quatro status ativos nas quatro categorias');
select pg_temp.verificar((select bool_and(status='perdido') from public.leads where id in(select id from encerrados)),'todos movidos a perdido');
select pg_temp.verificar((select status='virou_cliente' from public.leads where id='ea000000-0000-4000-8000-000000000005'),'cliente preservado');
select pg_temp.verificar((select bool_and(status<>'perdido') from public.leads where id in
  ('ea000000-0000-4000-8000-000000000006','ea000000-0000-4000-8000-000000000007','ea000000-0000-4000-8000-000000000008')),'tres provas independentes de assinatura preservadas');
select pg_temp.verificar((select bool_and(status<>'perdido') from public.leads where id in
  ('ea000000-0000-4000-8000-000000000010','ea000000-0000-4000-8000-000000000011','ea000000-0000-4000-8000-000000000012')),'hoje futuro e sem data preservados');
select pg_temp.verificar(not exists(select 1 from public.leads l join antes a using(id) where to_jsonb(l)-'status'-'updated_at' is distinct from a.dados),'nenhuma resposta, envio real ou metadado apagado');
select pg_temp.verificar((select estado='cancelado' and lease_token is null and lease_ate is null and iniciado_em is null
  from public.whatsapp_outbox where lead_id='ea000000-0000-4000-8000-000000000001'),'reserva nao iniciada cancelada');
select pg_temp.verificar((select estado='cancelada' from public.whatsapp_propostas_automaticas where lead_id='ea000000-0000-4000-8000-000000000002'),'preparo ainda nao enviado cancelado');
select pg_temp.verificar((select to_jsonb(o)=to_jsonb(j) from public.whatsapp_outbox o join job_iniciado j using(id)),'envio iniciado preserva estado token e lease');
select pg_temp.verificar(not exists(select 1 from public.encerrar_eventos_passados()),'segunda rodada idempotente');
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'sent',null,false,null,false,false,null,null,null,false)='enviado',
  'ACK tardio real aceito apos encerramento e flags desligadas') from job_iniciado j;
select pg_temp.verificar((select status='perdido' and enviado_em='2026-10-01 12:00-03' from public.leads where id='ea000000-0000-4000-8000-000000000003'),'ACK preserva perdido e o carimbo original');

-- Trigger nao deixa insert/reabertura/ACK recolocar passado numa coluna ativa.
insert into public.leads(id,categoria,status,data_evento,respostas) values
  ('ea000000-0000-4000-8000-000000000013','casamento','aguardando_revisao','2026-10-22','{"nome":"TESTE SQL"}');
select pg_temp.verificar((select status='perdido' from public.leads where id='ea000000-0000-4000-8000-000000000013'),'insert passado ja nasce perdido');
select pg_temp.verificar(not exists(select 1 from public.whatsapp_propostas_automaticas where lead_id='ea000000-0000-4000-8000-000000000013'),'insert passado nao agenda proposta');
update public.leads set status='enviado' where id='ea000000-0000-4000-8000-000000000013';
select pg_temp.verificar((select status='perdido' from public.leads where id='ea000000-0000-4000-8000-000000000013'),'reabertura de passado bloqueada');
update public.leads set data_evento='2026-10-24',status='aguardando_revisao' where id='ea000000-0000-4000-8000-000000000013';
select pg_temp.verificar((select status='aguardando_revisao' from public.leads where id='ea000000-0000-4000-8000-000000000013'),'corrigir data futura permite reabrir');
update public.leads set data_evento='2026-10-22',status='virou_cliente' where id='ea000000-0000-4000-8000-000000000013';
select pg_temp.verificar((select status='virou_cliente' from public.leads where id='ea000000-0000-4000-8000-000000000013'),'marcar cliente preservado mesmo passado');
update public.leads set status='aguardando_revisao' where id='ea000000-0000-4000-8000-000000000006';
select pg_temp.verificar((select status='aguardando_revisao' from public.leads where id='ea000000-0000-4000-8000-000000000006'),'contrato assinado preservado no trigger');
select pg_temp.verificar(public.recusa_lembrete_proposta_whatsapp('ea000000-0000-4000-8000-000000000006',
  'lembrete_proposta_7d',null,null,null,pg_temp.agora())='evento_passado','assinatura preserva card mas passado nao autoriza mensagem');

-- Gates tambem impedem envio ANTES do proximo cron atualizar os cards.
-- Preserva ativo legada de proposito para provar a defesa sem depender de status.
alter table public.leads disable trigger leads_preservar_encerramento_evento;
insert into public.leads(id,categoria,status,data_evento,respostas,whatsapp,slug,created_at) values
  ('eb000000-0000-4000-8000-000000000001','casamento','aguardando_revisao','2026-10-22','{"nome":"Ana"}','19912345678','e001','2026-10-23 00:00-03'),
  ('eb000000-0000-4000-8000-000000000002','casamento','incompleto','2026-10-22','{"nome":"Ana"}','19912345678',null,'2026-10-23 00:00-03');
alter table public.leads enable trigger leads_preservar_encerramento_evento;
-- Isola os candidatos desta secao sem apagar nenhum recibo iniciado.
update public.whatsapp_propostas_automaticas set estado='cancelada';
update public.whatsapp_propostas_automaticas set estado='agendada',entrada_em=pg_temp.agora()-interval '16 minutes',
  proxima_tentativa_em=pg_temp.agora() where lead_id='eb000000-0000-4000-8000-000000000001';
select pg_temp.verificar(not exists(select 1 from public.reivindicar_preparo_proposta_whatsapp(true)),'preparo claim recusa passado ainda ativo');
update public.whatsapp_propostas_automaticas set estado='gerando',lease_token='ec000000-0000-4000-8000-000000000001',
  lease_ate=pg_temp.agora()+interval '90 seconds',categoria='casamento',respostas='{"nome":"Ana"}',destinatario='5519912345678'
  where lead_id='eb000000-0000-4000-8000-000000000001';
select pg_temp.verificar(not public.concluir_preparo_proposta_whatsapp('eb000000-0000-4000-8000-000000000001',
  'ec000000-0000-4000-8000-000000000001','Ana','https://melstorymaker.com.br/p/e001',
  'automaticas/eb000000-0000-4000-8000-000000000001/ec000000-0000-4000-8000-000000000001.pdf'),'CAS preparo recusa token antigo com evento passado');
select pg_temp.verificar(not exists(select 1 from public.whatsapp_outbox where lead_id='eb000000-0000-4000-8000-000000000001'),'CAS recusado nao enfileira proposta');
alter table public.leads disable trigger leads_registrar_atividade_formulario;
update public.leads set formulario_ultima_atividade_em=pg_temp.agora()-interval '8 hours' where id='eb000000-0000-4000-8000-000000000002';
alter table public.leads enable trigger leads_registrar_atividade_formulario;
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6('2026-10-23 00:00-03',c.mensagens,'https://melstorymaker.com.br')=0,
  'formulario passado nao enfileira') from config c;

-- Proposta inicial: primeira parte antes da meia-noite; parte seguinte depois
-- deve parar. ACK tardio segue registrado sem retornar card para Enviado.
select set_config('test.eventos_clock','2026-10-23 23:59:58-03',true);
insert into public.leads(id,categoria,status,data_evento,respostas,whatsapp,slug,created_at) values
  ('ed000000-0000-4000-8000-000000000001','casamento','aguardando_revisao','2026-10-23','{"nome":"Ana"}','19912345678','e101','2026-10-23 00:00-03');
update public.whatsapp_propostas_automaticas set entrada_em=pg_temp.agora()-interval '16 minutes',proxima_tentativa_em=pg_temp.agora()
  where lead_id='ed000000-0000-4000-8000-000000000001';
create temp table preparo as select * from public.reivindicar_preparo_proposta_whatsapp(true);
select pg_temp.verificar((select count(*)=1 from preparo),'hoje continua permitido no preparo');
select pg_temp.verificar(public.concluir_preparo_proposta_whatsapp(p.lead_id,p.lease_token,'Ana','https://melstorymaker.com.br/p/e101',
  'automaticas/'||p.lead_id||'/'||p.lease_token||'.pdf'),'hoje conclui preparo') from preparo p;
create temp table job as select * from public.reivindicar_whatsapp_v7(false,null,false,true);
select pg_temp.verificar((select count(*)=1 from job),'hoje reserva proposta inicial');
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false)='enviando',
  'primeira parte antes da meia-noite permitida') from job j;
select set_config('test.eventos_clock','2026-10-24 00:00:01-03',true);
select pg_temp.verificar(public.recusa_proposta_inicial_whatsapp(j.id,pg_temp.agora())='evento_passado','gate detecta virada de data sem cron') from job j;
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false) is null,
  'parte seguinte depois da meia-noite bloqueada') from job j;
select pg_temp.verificar((select o.estado='indeterminado' and o.iniciado_em is not null and o.lease_token=j.lease_token
  from public.whatsapp_outbox o join job j using(id)),'parcial conserva token para reconciliar');
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'sent',null,false,null,false,false,null,null,null,false)='enviado',
  'ACK inicial tardio real aceito') from job j;
select pg_temp.verificar((select status='perdido' and enviado_em is not null from public.leads
  where id='ed000000-0000-4000-8000-000000000001'),'ACK tardio guarda envio real e trigger impede voltar a Enviado');

-- Formulario: fila preexistente nao passa claim e token reservado nao passa STARTED.
select set_config('test.eventos_clock','2026-10-23 12:00:00-03',true);
insert into public.leads(id,categoria,status,data_evento,respostas,whatsapp,created_at) values
  ('ee000000-0000-4000-8000-000000000001','casamento','incompleto','2026-10-23','{"nome":"Ana"}','19912345678','2026-10-23 00:00-03');
alter table public.leads disable trigger leads_registrar_atividade_formulario;
update public.leads set formulario_ultima_atividade_em=pg_temp.agora()-interval '8 hours' where id='ee000000-0000-4000-8000-000000000001';
alter table public.leads enable trigger leads_registrar_atividade_formulario;
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6('2026-10-23 00:00-03',c.mensagens,'https://melstorymaker.com.br')=1,
  'hoje enfileira formulario normalmente') from config c;
truncate job;
insert into job select * from public.reivindicar_whatsapp_v7(true,'2026-10-23 00:00-03',false,false);
select pg_temp.verificar((select count(*)=1 from job),'hoje reserva formulario');
alter table public.leads disable trigger leads_preservar_encerramento_evento;
update public.leads set data_evento='2026-10-22' where id='ee000000-0000-4000-8000-000000000001';
alter table public.leads enable trigger leads_preservar_encerramento_evento;
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'started',null,true,'2026-10-23 00:00-03',false,false,null,null,null,false) is null,
  'token reservado formulario passado nao inicia') from job j;
select pg_temp.verificar((select estado='cancelado' and iniciado_em is null and ultimo_codigo='evento_passado' from public.whatsapp_outbox
  where lead_id='ee000000-0000-4000-8000-000000000001'),'formulario recusado cancela antes primeira parte');
-- Volta o mesmo job nao iniciado a pendente SOMENTE na fixture para provar claim.
update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,proxima_tentativa_em=pg_temp.agora()
  where lead_id='ee000000-0000-4000-8000-000000000001';
select pg_temp.verificar(not exists(select 1 from public.reivindicar_whatsapp_v7(true,'2026-10-23 00:00-03',false,false)),
  'claim formulario rejeita fila legada passada mesmo status ainda incompleto');
select pg_temp.verificar((select estado='cancelado' from public.whatsapp_outbox where lead_id='ee000000-0000-4000-8000-000000000001'),
  'claim cancela fila passada');

-- Lembretes 7/30 usam o mesmo gate em cada parte, sem dispensar historico
-- fresco, dependencia do primeiro lembrete ou o periodo de silencio aprovado.
do $$
declare dias integer; l uuid; a timestamptz:=pg_temp.agora(); r jsonb; o public.whatsapp_outbox%rowtype;
  s jsonb; m text; envio timestamptz;
begin
  foreach dias in array array[7,30] loop
    l:=('ef000000-0000-4000-8000-'||lpad(dias::text,12,'0'))::uuid;
    envio:=a-make_interval(days=>dias+1);
    insert into public.leads(id,categoria,status,data_evento,respostas,whatsapp,enviado_em,pdf_url)
      values(l,'casamento','esfriou','2026-10-23','{"nome":"Ana"}','19912345678',envio,'https://melstorymaker.com.br/p/e107');
    if dias=30 then
      s:=public.sequencia_lembrete_proposta('lembrete_proposta_7d','https://melstorymaker.com.br/p/e107');
      select string_agg(p.value->>'message',E'\n\n' order by p.n) into m from jsonb_array_elements(s) with ordinality p(value,n);
      insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,proposta_enviado_em,
        proposta_pdf_url,solicitado_em,solicitado_por,estado,iniciado_em,enviado_em)
      values(l,'lembrete_proposta_7d',a-interval '16 days',a-interval '15 days','5519912345678',m,s,envio,
        'https://melstorymaker.com.br/p/e107',a-interval '16 days','ad000000-0000-4000-8000-000000000001','enviado',a-interval '16 days',a-interval '16 days');
    end if;
    r:=public.enfileirar_lembrete_proposta_whatsapp(l,dias,envio,'ad000000-0000-4000-8000-000000000001');
    perform pg_temp.verificar(r->>'erro' is null,'hoje enfileira lembrete '||dias);
    select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
    perform pg_temp.verificar(o.lead_id=l,'hoje reserva lembrete '||dias);
    perform pg_temp.verificar(public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,
      a,a-interval '20 days',null,true)='enviando','hoje inicia lembrete '||dias||' com historico valido');
    update public.leads set data_evento='2026-10-22' where id=l;
    perform pg_temp.verificar(public.recusa_lembrete_proposta_whatsapp(l,o.tipo,envio,o.proposta_pdf_url,o.destinatario,a)='evento_passado',
      'gate central identifica passado para lembrete '||dias);
    perform pg_temp.verificar(public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,
      a,a-interval '20 days',null,true) is null,'parte seguinte bloqueada lembrete '||dias);
    perform pg_temp.verificar((select estado='indeterminado' and lease_token=o.lease_token and iniciado_em is not null
      from public.whatsapp_outbox where id=o.id),'parcial preserva token lembrete '||dias);
    perform pg_temp.verificar(public.resultado_whatsapp_v7(o.id,o.lease_token,'sent',null,false,null,false,false,null,null,null,false)='enviado',
      'ACK tardio preservado lembrete '||dias);
    perform pg_temp.verificar((select status='perdido' from public.leads where id=l),'ACK nao reabre lembrete '||dias);
  end loop;
end;
$$;

-- Formulario parcialmente enviado: corrigir a data para ontem interrompe as
-- partes seguintes, mantendo o recibo conciliavel e sem retorno a pendente.
insert into public.leads(id,categoria,status,data_evento,respostas,whatsapp,created_at) values
  ('ff000000-0000-4000-8000-000000000001','casamento','incompleto','2026-10-23','{"nome":"Ana"}','19912345678','2026-10-23 00:00-03');
alter table public.leads disable trigger leads_registrar_atividade_formulario;
update public.leads set formulario_ultima_atividade_em=pg_temp.agora()-interval '8 hours' where id='ff000000-0000-4000-8000-000000000001';
alter table public.leads enable trigger leads_registrar_atividade_formulario;
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6('2026-10-23 00:00-03',c.mensagens,'https://melstorymaker.com.br')=1,
  'enfileira formulario para teste parcial') from config c;
truncate job;
insert into job select * from public.reivindicar_whatsapp_v7(true,'2026-10-23 00:00-03',false,false);
select pg_temp.verificar((select count(*)=1 from job),'reserva formulario parcial');
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'started',null,true,'2026-10-23 00:00-03',false,false,null,null,null,false)='enviando',
  'formulario primeira parte hoje permitida') from job j;
update public.leads set data_evento='2026-10-22' where id='ff000000-0000-4000-8000-000000000001';
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'started',null,true,'2026-10-23 00:00-03',false,false,null,null,null,false) is null,
  'formulario parcial para antes da parte seguinte') from job j;
select pg_temp.verificar((select o.estado='indeterminado' and o.lease_token=j.lease_token and o.iniciado_em is not null
  from public.whatsapp_outbox o join job j using(id)),'formulario parcial preserva token e iniciado');
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'sent',null,false,null,false,false,null,null,null,false)='enviado',
  'ACK formulario parcial permanece conciliavel') from job j;
select pg_temp.verificar((select status='perdido' from public.leads where id='ff000000-0000-4000-8000-000000000001'),
  'ACK formulario parcial nao reabre card');

-- Prova executada como o papel real do servidor, incluindo o trigger de
-- assinatura, a preservacao na mudanca de data e a RPC. Grants so na fixture.
grant select,insert,update,delete on public.leads,public.contratos to service_role;
set local role service_role;
insert into public.leads(id,categoria,status,data_evento,respostas) values
  ('f1000000-0000-4000-8000-000000000001','casamento','enviado','2026-10-24','{"nome":"TESTE SERVICE ROLE"}');
insert into public.contratos(lead_id,status) values('f1000000-0000-4000-8000-000000000001','enviado');
update public.contratos set assinatura_status='concluido' where lead_id='f1000000-0000-4000-8000-000000000001';
update public.leads set data_evento='2026-10-22' where id='f1000000-0000-4000-8000-000000000001';
select pg_temp.verificar((select l.status='enviado' and c.assinatura_status='concluido' from public.leads l
  join public.contratos c on c.lead_id=l.id where l.id='f1000000-0000-4000-8000-000000000001'),
  'service_role confirma assinatura e trigger preserva lead');
select pg_temp.verificar(not exists(select 1 from public.encerrar_eventos_passados() where id='f1000000-0000-4000-8000-000000000001'),
  'RPC service_role preserva assinatura confirmada pelo mesmo papel');
reset role;
rollback;

-- Um isolamento que reutiliza snapshot antigo falha fechado, sem mover card.
begin isolation level repeatable read;
do $$
declare recusou boolean:=false;
begin
  begin
    perform public.encerrar_eventos_passados();
  exception when sqlstate '25000' then recusou:=true;
  end;
  if not recusou then raise exception 'FALHOU: aceitou isolamento sem snapshot fresco'; end if;
end;
$$;
rollback;
