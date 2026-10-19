-- SOMENTE Postgres descartavel, com os SQLs WhatsApp V1..V7 e formulario-orcar.sql.
-- Fixtures ficticias; nao chama APIs, bridge, worker ou WhatsApp. Tudo termina em ROLLBACK.
begin;
create function pg_temp.verificar(ok boolean,motivo text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FALHOU: %',motivo; end if; end; $$;
do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    raise exception 'Fixture exige Postgres isolado SEM realtime.send real';
  end if;
  if has_function_privilege('anon','public.preservar_origem_formulario()','EXECUTE')
    or has_function_privilege('authenticated','public.preservar_origem_formulario()','EXECUTE')
    or exists(select 1 from pg_proc where pronamespace='public'::regnamespace
      and proname in ('preservar_origem_formulario','registrar_entrada_proposta_automatica',
        'reivindicar_preparo_proposta_whatsapp','concluir_preparo_proposta_whatsapp','recusa_proposta_inicial_whatsapp')
      and (prosecdef or proconfig is distinct from array['search_path=pg_catalog'])) then
    raise exception 'Funcoes de origem devem ser privadas, invoker e com search_path fechado';
  end if;
end;
$$;

-- A origem nao depende de categoria, resposta ou rastreio.
insert into public.leads(id,status,categoria,respostas,whatsapp,origem_formulario)
values
  ('70000000-0000-4000-8000-000000000001','aguardando_revisao','casamento','{"nome":"Ana","contato_whatsapp":"19912345678"}','19912345678','orcar'),
  ('70000000-0000-4000-8000-000000000002','aguardando_revisao','aniversario','{"nome":"Ana"}','19912345678','orcar'),
  ('70000000-0000-4000-8000-000000000003','aguardando_revisao','debutante','{"nome":"Ana"}','19912345678','orcar'),
  ('70000000-0000-4000-8000-000000000004','aguardando_revisao','corporativo','{"nome":"Ana"}','19912345678','orcar');
select pg_temp.verificar(not exists(select 1 from public.whatsapp_propostas_automaticas),'/orcar nas quatro categorias nao agenda proposta');

-- Uma fila antiga/forjada nao supera o filtro na reserva nem o CAS de conclusao.
insert into public.whatsapp_propostas_automaticas(lead_id,entrada_em)
values('70000000-0000-4000-8000-000000000001',statement_timestamp()-interval '16 minutes');
select pg_temp.verificar(not exists(select 1 from public.reivindicar_preparo_proposta_whatsapp(true)),'/orcar excluido mesmo com agendamento existente');
update public.whatsapp_propostas_automaticas set estado='gerando',lease_token='71000000-0000-4000-8000-000000000001',
  lease_ate=statement_timestamp()+interval '90 seconds',categoria='casamento',
  respostas='{"nome":"Ana","contato_whatsapp":"19912345678"}',destinatario='5519912345678';
update public.leads set slug='f001' where id='70000000-0000-4000-8000-000000000001';
select pg_temp.verificar(not public.concluir_preparo_proposta_whatsapp('70000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001','Ana','https://melstorymaker.com.br/p/f001',
  'automaticas/70000000-0000-4000-8000-000000000001/71000000-0000-4000-8000-000000000001.pdf'),'/orcar recusa conclusao de preparo stale');
select pg_temp.verificar(not exists(select 1 from public.whatsapp_outbox) and
  (select pdf_url is null from public.leads where id='70000000-0000-4000-8000-000000000001'),'CAS recusado nao publica nem enfileira');

-- O formulario tradicional continua gerando e reservando a proposta apos 15 minutos.
insert into public.leads(id,status,categoria,respostas,whatsapp,slug)
values('70000000-0000-4000-8000-000000000005','aguardando_revisao','casamento','{"nome":"Ana"}','19912345678','f005');
select pg_temp.verificar((select origem_formulario='formulario' from public.leads where id='70000000-0000-4000-8000-000000000005'),'cliente antigo usa origem padrao');
update public.whatsapp_propostas_automaticas set entrada_em=statement_timestamp()-interval '16 minutes'
  where lead_id='70000000-0000-4000-8000-000000000005';
create temp table preparo_orcar as select * from public.reivindicar_preparo_proposta_whatsapp(true);
select pg_temp.verificar((select count(*)=1 and min(lead_id::text)='70000000-0000-4000-8000-000000000005' from preparo_orcar),'reserva somente o formulario tradicional');
select pg_temp.verificar(public.concluir_preparo_proposta_whatsapp(p.lead_id,p.lease_token,'Ana',
  'https://melstorymaker.com.br/p/f005','automaticas/'||p.lead_id||'/'||p.lease_token||'.pdf'),'formulario padrao publica proposta') from preparo_orcar p;
create temp table job_orcar as select * from public.reivindicar_whatsapp_v7(false,null,false,true);
select pg_temp.verificar((select count(*)=1 from job_orcar),'worker V7 recebe proposta tradicional');

-- Retomada pelo link da Mel antes de enviar: origem sticky e token reservado recusado.
update public.leads set status='incompleto' where id='70000000-0000-4000-8000-000000000005';
update public.leads set origem_formulario='orcar' where id='70000000-0000-4000-8000-000000000005';
update public.leads set origem_formulario='formulario',status='aguardando_revisao'
  where id='70000000-0000-4000-8000-000000000005';
select pg_temp.verificar((select origem_formulario='orcar' from public.leads where id='70000000-0000-4000-8000-000000000005'),'outro link nao reativa origem padrao');
select pg_temp.verificar(public.recusa_proposta_inicial_whatsapp(j.id,statement_timestamp())='origem_formulario_manual','gate central recusa nova origem') from job_orcar j;
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false) is null,
  'token reservado antigo nao inicia disparo /orcar') from job_orcar j;
select pg_temp.verificar((select estado='cancelado' and iniciado_em is null from public.whatsapp_outbox where lead_id='70000000-0000-4000-8000-000000000005'),'recusa antes da primeira parte cancela sem envio');
select pg_temp.verificar(not exists(select 1 from public.reivindicar_whatsapp_v7(false,null,false,true)),'/orcar nao volta a ser reclamado');

-- Trocar apenas a origem nao mexe no relogio do formulario, respostas ou coluna.
insert into public.leads(id,status,categoria,respostas,whatsapp)
values('70000000-0000-4000-8000-000000000006','incompleto','casamento','{"nome":"Ana"}','19912345678');
create temp table atividade_orcar as select formulario_ultima_atividade_em,respostas,status from public.leads
  where id='70000000-0000-4000-8000-000000000006';
update public.leads set origem_formulario='orcar' where id='70000000-0000-4000-8000-000000000006';
select pg_temp.verificar((select l.formulario_ultima_atividade_em=a.formulario_ultima_atividade_em and l.respostas=a.respostas and l.status=a.status
  from public.leads l cross join atividade_orcar a where l.id='70000000-0000-4000-8000-000000000006'),'marcador nao muda atividade, respostas ou coluna');

do $$
begin
  begin
    insert into public.leads(id,status,categoria,origem_formulario)
      values('70000000-0000-4000-8000-000000000099','incompleto','casamento','invalida');
    raise exception 'Aceitou origem invalida';
  exception when check_violation then null; end;
  insert into public.leads(id,status,categoria,enviado_em)
    values('70000000-0000-4000-8000-000000000007','enviado','casamento',statement_timestamp());
  begin
    update public.leads set origem_formulario='orcar' where id='70000000-0000-4000-8000-000000000007';
    raise exception 'Aceitou mudar origem depois do envio';
  exception when check_violation then null; end;
  update public.leads set status='incompleto' where id='70000000-0000-4000-8000-000000000007';
  begin
    update public.leads set origem_formulario='orcar' where id='70000000-0000-4000-8000-000000000007';
    raise exception 'Voltar enviado a incompleto permitiu mudar origem';
  exception when check_violation then null; end;
end;
$$;

-- Cada parte revalida origem; o ACK tardio de envio iniciado continua conciliavel.
insert into public.leads(id,status,categoria,respostas,whatsapp,slug)
values('70000000-0000-4000-8000-000000000008','aguardando_revisao','casamento','{"nome":"Ana"}','19912345678','f008');
update public.whatsapp_propostas_automaticas set entrada_em=statement_timestamp()-interval '16 minutes'
  where lead_id='70000000-0000-4000-8000-000000000008';
truncate preparo_orcar;
insert into preparo_orcar select * from public.reivindicar_preparo_proposta_whatsapp(true);
select pg_temp.verificar(public.concluir_preparo_proposta_whatsapp(p.lead_id,p.lease_token,'Ana',
  'https://melstorymaker.com.br/p/f008','automaticas/'||p.lead_id||'/'||p.lease_token||'.pdf'),'prepara caso ACK tardio') from preparo_orcar p;
truncate job_orcar;
insert into job_orcar select * from public.reivindicar_whatsapp_v7(false,null,false,true);
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false)='enviando','parte 1 tradicional autorizada') from job_orcar j;
update public.leads set status='incompleto' where id='70000000-0000-4000-8000-000000000008';
update public.leads set origem_formulario='orcar',status='aguardando_revisao' where id='70000000-0000-4000-8000-000000000008';
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false) is null,
  'origem mudou: parte seguinte bloqueada') from job_orcar j;
select pg_temp.verificar((select estado='indeterminado' from public.whatsapp_outbox where lead_id='70000000-0000-4000-8000-000000000008'),'parcial indeterminado nao e repetido');
select pg_temp.verificar(public.resultado_whatsapp_v7(j.id,j.lease_token,'sent',null,false,null,false,false,null,null,null,false)='enviado',
  'ACK tardio real permanece aceito com flag desligada e origem /orcar') from job_orcar j;
select pg_temp.verificar((select origem_formulario='orcar' and enviado_em is not null and status::text='enviado'
  from public.leads where id='70000000-0000-4000-8000-000000000008'),'ACK guarda envio real sem apagar origem');

-- Gerar uma proposta manual e mover o card continua permitido para /orcar.
update public.leads set pdf_url='https://melstorymaker.com.br/p/f001',pdf_storage_path=null,
  pdf_gerado_em=statement_timestamp(),status='enviado',enviado_em=statement_timestamp()-interval '8 days'
  where id='70000000-0000-4000-8000-000000000001';
select pg_temp.verificar((select origem_formulario='orcar' and status::text='enviado' and pdf_url is not null
  from public.leads where id='70000000-0000-4000-8000-000000000001'),'proposta e envio manuais preservados');
do $$
declare l public.leads%rowtype; o public.whatsapp_outbox%rowtype; resposta jsonb; a timestamptz:=statement_timestamp();
begin
  select * into l from public.leads where id='70000000-0000-4000-8000-000000000001';
  resposta:=public.enfileirar_lembrete_proposta_whatsapp(l.id,7,l.enviado_em,'ad000000-0000-4000-8000-000000000001');
  perform pg_temp.verificar(resposta->>'erro' is null,'/orcar permite CTA 7 dias');
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,true);
  perform pg_temp.verificar(o.lead_id=l.id and o.tipo='lembrete_proposta_7d','/orcar permite claim lembrete 7 dias');
  perform pg_temp.verificar(public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,true,
    a,a-interval '20 days',null,true)='enviando','/orcar preserva gate normal historico 7 dias');
  perform pg_temp.verificar(public.resultado_whatsapp_v7(o.id,o.lease_token,'sent',null,false,null,true,true,
    null,null,null,false)='enviado','/orcar preserva ACK lembrete 7 dias');
end;
$$;

-- Lembrete 30 dias mantem a dependencia de 7 dias e os 15 dias de silencio.
insert into public.leads(id,status,categoria,respostas,whatsapp,origem_formulario,pdf_url,enviado_em)
values('70000000-0000-4000-8000-000000000009','esfriou','casamento','{"nome":"Ana"}','19912345678','orcar',
  'https://melstorymaker.com.br/p/f009',statement_timestamp()-interval '31 days');
do $$
declare l public.leads%rowtype; o public.whatsapp_outbox%rowtype; a timestamptz:=statement_timestamp(); s jsonb; m text; resposta jsonb;
begin
  select * into l from public.leads where id='70000000-0000-4000-8000-000000000009';
  s:=public.sequencia_lembrete_proposta('lembrete_proposta_7d',l.pdf_url);
  select string_agg(p.value->>'message',E'\n\n' order by p.n) into m from jsonb_array_elements(s) with ordinality p(value,n);
  insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,proposta_enviado_em,
    proposta_pdf_url,solicitado_em,solicitado_por,estado,iniciado_em,enviado_em)
  values(l.id,'lembrete_proposta_7d',a-interval '16 days',a-interval '15 days','5519912345678',m,s,l.enviado_em,
    l.pdf_url,a-interval '16 days','ad000000-0000-4000-8000-000000000001','enviado',a-interval '16 days',a-interval '16 days');
  resposta:=public.enfileirar_lembrete_proposta_whatsapp(l.id,30,l.enviado_em,'ad000000-0000-4000-8000-000000000001');
  perform pg_temp.verificar(resposta->>'erro' is null,'/orcar permite CTA 30 dias');
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,true);
  perform pg_temp.verificar(o.lead_id=l.id and o.tipo='lembrete_proposta_30d','/orcar permite claim lembrete 30 dias');
  perform pg_temp.verificar(public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,true,
    a,a-interval '20 days',null,true)='enviando','/orcar preserva gate normal historico 30 dias');
end;
$$;

-- Origem manual nao exclui o lembrete do formulario incompleto.
alter table public.leads disable trigger leads_registrar_atividade_formulario;
update public.leads set formulario_ultima_atividade_em=statement_timestamp()-interval '8 hours'
  where id='70000000-0000-4000-8000-000000000006';
alter table public.leads enable trigger leads_registrar_atividade_formulario;
select public.enfileirar_lembretes_formulario_whatsapp_v6(statement_timestamp()-interval '1 day',
  jsonb_build_array(
    jsonb_build_object('message','Olá! Aqui é a Mel Storymaker 👋','delayBeforeSeconds',0),
    jsonb_build_object('message','Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊','delayBeforeSeconds',2),
    jsonb_build_object('message','Suas respostas estão salvas, acesse o link:','delayBeforeSeconds',3)),
  'https://melstorymaker.com.br');
select pg_temp.verificar(exists(select 1 from public.whatsapp_outbox where lead_id='70000000-0000-4000-8000-000000000006'
  and tipo='lembrete_formulario_24h' and estado='pendente'),'lembrete do formulario /orcar continua agendado');
rollback;
