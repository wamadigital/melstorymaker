-- Executar apenas em banco isolado com os SQLs da outbox e proposta inicial.
-- Dados fictícios. Não reivindica fila nem envia mensagens de produção.
begin;
create function pg_temp.verificar(ok boolean,motivo text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FALHOU: %',motivo; end if; end; $$;

insert into public.leads(id,status,categoria,respostas,whatsapp,slug)
values('30000000-0000-4000-8000-000000000001','aguardando_revisao','casamento',
  '{"nome":"Maria Eduarda","noivos":"Maria Eduarda & João","contato_whatsapp":"19912345678"}', '19912345678','a3f9');
select pg_temp.verificar((select count(*)=1 from public.whatsapp_propostas_automaticas),'entrada agenda uma vez');
update public.whatsapp_propostas_automaticas set entrada_em=statement_timestamp()-interval '14 minutes 59 seconds';
select pg_temp.verificar((select count(*)=0 from public.reivindicar_preparo_proposta_whatsapp(true)),'não prepara antes dos 15 minutos');
update public.whatsapp_propostas_automaticas set entrada_em=statement_timestamp()-interval '15 minutes';
select pg_temp.verificar((select count(*)=0 from public.reivindicar_preparo_proposta_whatsapp(false)),'flag desativada não prepara');
create temp table reserva as select * from public.reivindicar_preparo_proposta_whatsapp(true);
select pg_temp.verificar((select count(*)=1 from reserva),'prepara aos 15 minutos');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_preparo_proposta_whatsapp(true)),'segunda reserva não duplica geração');
select pg_temp.verificar((select enviado_em is null and status::text='aguardando_revisao' from public.leads),'geração não move card');
select pg_temp.verificar((select count(*)=0 from public.whatsapp_outbox),'preparar ainda não enfileira');

select pg_temp.verificar(public.concluir_preparo_proposta_whatsapp(r.lead_id,r.lease_token,'Maria Eduarda',
  'https://melstorymaker.com.br/p/a3f9','automaticas/'||r.lead_id||'/'||r.lease_token||'.pdf'),'upload concluído publica PDF e enfileira') from reserva r;
select pg_temp.verificar((select count(*)=1 from public.whatsapp_outbox where tipo='proposta_inicial_15m'),'somente a proposta foi enfileirada');
select pg_temp.verificar((select sequencia=public.sequencia_proposta_inicial('Maria Eduarda','https://melstorymaker.com.br/p/a3f9') from public.whatsapp_outbox),'snapshot com copy e pausas exatas');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v4(false,null,false)),'worker antigo não recebe proposta inicial');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v5(false,null,false,false)),'flag inicial desligada não envia');
create temp table job as select * from public.reivindicar_whatsapp_v5(false,null,false,true);
select pg_temp.verificar((select count(*)=1 from job),'worker novo reserva o primeiro envio');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v5(false,null,false,true)),'outro worker não reivindica o mesmo envio');
select pg_temp.verificar(public.resultado_whatsapp_v5(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false)='enviando',
  'primeiro envio autorizado sem a janela de inatividade dos lembretes') from job j;
select pg_temp.verificar((select status::text='aguardando_revisao' and enviado_em is null from public.leads),'started não é entrega');
select pg_temp.verificar(public.resultado_whatsapp_v5(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false)='enviando','revalida parte 2') from job j;
select pg_temp.verificar(public.resultado_whatsapp_v5(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false)='enviando','revalida parte 3') from job j;
select pg_temp.verificar(public.resultado_whatsapp_v5(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false)='enviando','revalida parte 4') from job j;
select pg_temp.verificar(public.resultado_whatsapp_v5(j.id,j.lease_token,'sent',null,false,null,false,true,null,null,null,false)='enviado','ACK move o card') from job j;
select pg_temp.verificar((select status::text='enviado' and enviado_em is not null from public.leads),'coluna e data após envio completo');
create temp table data_envio as select enviado_em from public.leads;
select pg_temp.verificar(public.resultado_whatsapp_v5(j.id,j.lease_token,'sent',null,false,null,false,false,null,null,null,false)='enviado','reconcilia ACK mesmo com flag desligada') from job j;
select pg_temp.verificar((select l.enviado_em=d.enviado_em from public.leads l cross join data_envio d),'ACK repetido preserva primeira data');
update public.leads set status='aguardando_revisao';
select pg_temp.verificar((select count(*)=0 from public.reivindicar_preparo_proposta_whatsapp(true)),'voltar à revisão após envio não reenvia');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v5(false,null,false,true)),'ACK nunca gera repetição');

-- Edição entre renderização e publicação recusa o snapshot antigo.
insert into public.leads(id,status,categoria,respostas,whatsapp,slug)
values('30000000-0000-4000-8000-000000000002','aguardando_revisao','casamento','{"nome":"Ana"}','19912345678','a3g9');
update public.whatsapp_propostas_automaticas set entrada_em=statement_timestamp()-interval '16 minutes' where lead_id='30000000-0000-4000-8000-000000000002';
truncate reserva; insert into reserva select * from public.reivindicar_preparo_proposta_whatsapp(true);
update public.leads set respostas='{"nome":"Beatriz"}' where id='30000000-0000-4000-8000-000000000002';
select pg_temp.verificar(not public.concluir_preparo_proposta_whatsapp(r.lead_id,r.lease_token,'Ana',
  'https://melstorymaker.com.br/p/a3g9','automaticas/'||r.lead_id||'/'||r.lease_token||'.pdf'),'edição concorrente não publica PDF antigo') from reserva r;
select pg_temp.verificar((select pdf_url is null from public.leads where id='30000000-0000-4000-8000-000000000002'),'PDF anterior não foi sobrescrito');

-- Mudança de telefone no meio das mensagens interrompe e fica indeterminada.
insert into public.leads(id,status,categoria,respostas,whatsapp,slug)
values('30000000-0000-4000-8000-000000000003','aguardando_revisao','casamento','{"nome":"Ana"}','19912345678','a3h9');
update public.whatsapp_propostas_automaticas set entrada_em=statement_timestamp()-interval '16 minutes' where lead_id='30000000-0000-4000-8000-000000000003';
truncate reserva; insert into reserva select * from public.reivindicar_preparo_proposta_whatsapp(true);
select pg_temp.verificar(public.concluir_preparo_proposta_whatsapp(r.lead_id,r.lease_token,'Ana',
  'https://melstorymaker.com.br/p/a3h9','automaticas/'||r.lead_id||'/'||r.lease_token||'.pdf'),'prepara caso de mudança durante envio') from reserva r;
truncate job; insert into job select * from public.reivindicar_whatsapp_v5(false,null,false,true);
select pg_temp.verificar(public.resultado_whatsapp_v5(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false)='enviando','primeira parte elegível') from job j;
update public.leads set whatsapp='19998765432' where id='30000000-0000-4000-8000-000000000003';
select pg_temp.verificar(public.resultado_whatsapp_v5(j.id,j.lease_token,'started',null,false,null,false,true,null,null,null,false) is null,'telefone mudou: próxima parte bloqueada') from job j;
select pg_temp.verificar((select estado='indeterminado' from public.whatsapp_outbox where lead_id='30000000-0000-4000-8000-000000000003'),'parcial não autoriza nova tentativa');
select pg_temp.verificar((select status::text='aguardando_revisao' and enviado_em is null from public.leads where id='30000000-0000-4000-8000-000000000003'),'falha parcial não move card');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v5(false,null,false,true)),'parcial não é reivindicado novamente');

-- Primeira mensagem não saiu: falha de conexão permite retry controlado.
insert into public.leads(id,status,categoria,respostas,whatsapp,slug)
values('30000000-0000-4000-8000-000000000004','aguardando_revisao','casamento','{"nome":"Ana"}','19912345678','a3i9');
update public.whatsapp_propostas_automaticas set entrada_em=statement_timestamp()-interval '16 minutes' where lead_id='30000000-0000-4000-8000-000000000004';
truncate reserva; insert into reserva select * from public.reivindicar_preparo_proposta_whatsapp(true);
select pg_temp.verificar(public.concluir_preparo_proposta_whatsapp(r.lead_id,r.lease_token,'Ana',
  'https://melstorymaker.com.br/p/a3i9','automaticas/'||r.lead_id||'/'||r.lease_token||'.pdf'),'prepara falha antes do envio') from reserva r;
truncate job; insert into job select * from public.reivindicar_whatsapp_v5(false,null,false,true);
select pg_temp.verificar(public.resultado_whatsapp_v5(j.id,j.lease_token,'failed','bridge_disconnected',false,null,false,true,null,null,null,false)='pendente','sem início pode aguardar nova conexão') from job j;
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v5(false,null,false,true)),'retry respeita cinco minutos');

-- Envio manual anterior nunca passa pela automação inicial.
insert into public.leads(id,status,categoria,respostas,whatsapp,enviado_em)
values('30000000-0000-4000-8000-000000000005','aguardando_revisao','casamento','{"nome":"Ana"}','19912345678',statement_timestamp()-interval '2 days');
select pg_temp.verificar(not exists(select 1 from public.whatsapp_propostas_automaticas where lead_id='30000000-0000-4000-8000-000000000005'),'primeiro envio manual já conta');
select pg_temp.verificar(not has_table_privilege('anon','public.whatsapp_propostas_automaticas','SELECT'),'fila privada não é pública');
select pg_temp.verificar(not has_table_privilege('authenticated','public.whatsapp_propostas_automaticas','SELECT'),'sessão comum não lê a fila');
select pg_temp.verificar(not has_function_privilege('anon','public.reivindicar_whatsapp_v5(boolean,timestamp with time zone,boolean,boolean)','EXECUTE'),'anônimo não reivindica');
select pg_temp.verificar((select relrowsecurity from pg_class where oid='public.whatsapp_propostas_automaticas'::regclass),'RLS habilitado');

rollback;
