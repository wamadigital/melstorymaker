-- Somente Postgres isolado, com SQLs V1..V6 carregados. Fixtures ficticias.
-- O relogio dos RPCs e substituido dentro desta transacao e restaurado por ROLLBACK.
-- Nao chama APIs nem envia WhatsApp. Falha aborta a transacao completa.
begin;
create function pg_temp.verificar(ok boolean,motivo text) returns void language plpgsql as $$
begin if ok is distinct from true then raise exception 'FALHOU: %',motivo; end if; end; $$;

-- Os seis exemplos aprovados e limites exatos no fuso de Brasilia.
select pg_temp.verificar(public.prazo_lembrete_formulario('2026-10-20 08:30:00-03')='2026-10-20 14:30:00-03','08h30 vira14h30');
select pg_temp.verificar(public.prazo_lembrete_formulario('2026-10-20 18:00:00-03')='2026-10-21 09:00:00-03','18h vira09h do outro dia');
select pg_temp.verificar(public.prazo_lembrete_formulario('2026-10-20 15:01:00-03')='2026-10-21 09:00:00-03','15h01 vira09h do outro dia');
select pg_temp.verificar(public.prazo_lembrete_formulario('2026-10-20 23:40:00-03')='2026-10-21 09:00:00-03','23h40 vira09h do outro dia');
select pg_temp.verificar(public.prazo_lembrete_formulario('2026-10-20 09:00:00-03')='2026-10-20 15:00:00-03','09h vira15h');
select pg_temp.verificar(public.prazo_lembrete_formulario('2026-10-20 03:00:00-03')='2026-10-20 09:00:00-03','03h vira09h mesmo dia');
select pg_temp.verificar(public.prazo_lembrete_formulario('2026-10-20 02:00:00-03')='2026-10-20 08:00:00-03','02h vira08h liberado');
select pg_temp.verificar(public.prazo_lembrete_formulario('2026-10-20 15:00:00-03')='2026-10-21 09:00:00-03','21h exato bloqueado');
select pg_temp.verificar(public.prazo_lembrete_formulario('2026-10-20 14:59:59-03')='2026-10-20 20:59:59-03','20h59m59 permitido');
select pg_temp.verificar(public.prazo_lembrete_formulario('2026-12-31 18:00:00-03')='2027-01-01 09:00:00-03','virada do ano preserva09h');
select pg_temp.verificar(not public.horario_lembrete_formulario_permitido('2026-10-20 07:59:59-03'),'07h59m59 bloqueado');
select pg_temp.verificar(public.horario_lembrete_formulario_permitido('2026-10-20 08:00:00-03'),'08h exato permitido');
select pg_temp.verificar(not public.horario_lembrete_formulario_permitido('2026-10-20 21:00:00-03'),'21h exato bloqueado');
select pg_temp.verificar(public.prazo_lembrete_formulario(null) is null,'atividade ausente nao agenda');
select pg_temp.verificar(public.prazo_lembrete_formulario('infinity') is null,'atividade infinita nao agenda');

create function pg_temp.agora() returns timestamptz language sql volatile as $$
  select current_setting('test.formulario_clock')::timestamptz;
$$;
select set_config('test.formulario_clock','2026-10-20 09:00:00-03',true);
do $$
declare v_funcao regprocedure;
begin
  foreach v_funcao in array array[
    'public.registrar_atividade_formulario()'::regprocedure,
    'public.enfileirar_lembretes_formulario_whatsapp_v6(timestamptz,jsonb,text)'::regprocedure,
    'public.reivindicar_whatsapp_v6(boolean,timestamptz,boolean,boolean)'::regprocedure,
    'public.resultado_whatsapp_v6(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)'::regprocedure,
    'public.resultado_whatsapp_v3(uuid,uuid,text,text,boolean,timestamptz)'::regprocedure
  ] loop
    execute replace(replace(pg_get_functiondef(v_funcao),'statement_timestamp()','pg_temp.agora()'),'clock_timestamp()','pg_temp.agora()');
  end loop;
end;
$$;
create temp table config as select '2026-10-20 00:00:00-03'::timestamptz inicio,
  jsonb_build_array(
    jsonb_build_object('message','Olá! Aqui é a Mel Storymaker 👋','delayBeforeSeconds',0),
    jsonb_build_object('message','Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊','delayBeforeSeconds',2),
    jsonb_build_object('message','Suas respostas estão salvas, acesse o link:','delayBeforeSeconds',3)) mensagens;
insert into public.leads(id,categoria,status,respostas,whatsapp,created_at)
  values('60000000-0000-4000-8000-000000000001','casamento','incompleto','{"nome":"TESTE SQL"}','19912345678','2026-10-20 09:00:00-03');
select pg_temp.verificar((select formulario_ultima_atividade_em=pg_temp.agora() from public.leads where id='60000000-0000-4000-8000-000000000001'),'insert usa relogio servidor');
select set_config('test.formulario_clock','2026-10-20 10:00:00-03',true);
update public.leads set nome_display='metadado',formulario_ultima_atividade_em='2000-01-01' where id='60000000-0000-4000-8000-000000000001';
select pg_temp.verificar((select formulario_ultima_atividade_em='2026-10-20 09:00:00-03' from public.leads where id='60000000-0000-4000-8000-000000000001'),'metadado/timestamp cliente nao reinicia nem antecipa');
update public.leads set respostas=respostas||'{"local":"Novo local"}' where id='60000000-0000-4000-8000-000000000001';
select pg_temp.verificar((select formulario_ultima_atividade_em=pg_temp.agora() from public.leads where id='60000000-0000-4000-8000-000000000001'),'resposta nova reinicia seis horas');
select set_config('test.formulario_clock','2026-10-20 10:30:00-03',true);
update public.leads set passo_atual='data_evento' where id='60000000-0000-4000-8000-000000000001';
select pg_temp.verificar((select formulario_ultima_atividade_em=pg_temp.agora() from public.leads where id='60000000-0000-4000-8000-000000000001'),'avancar campo reinicia seis horas');
select set_config('test.formulario_clock','2026-10-20 10:10:00-03',true);
update public.leads set respostas=respostas||'{"observacao":"relogio retrocedeu"}' where id='60000000-0000-4000-8000-000000000001';
select pg_temp.verificar((select formulario_ultima_atividade_em='2026-10-20 10:30:00-03' from public.leads where id='60000000-0000-4000-8000-000000000001'),'relogio da atividade monotono');
select set_config('test.formulario_clock','2026-10-20 16:29:59-03',true);
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6(c.inicio,c.mensagens,'https://melstorymaker.com.br')=0,'nao enfileira antes das seis horas') from config c;
select set_config('test.formulario_clock','2026-10-20 16:30:00-03',true);
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v3(c.inicio,c.mensagens,'https://melstorymaker.com.br')=0,'rollback V3 nao enfileira') from config c;
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6(c.inicio,c.mensagens,'https://melstorymaker.com.br')=1,'enfileira apos seis horas exatas') from config c;
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6(c.inicio,c.mensagens,'https://melstorymaker.com.br')=0,'um lembrete por lead') from config c;
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v3(true,'2026-10-01')),'V3 nao reivindica formulario');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v4(true,'2026-10-01',false)),'V4 nao reivindica formulario');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v5(true,'2026-10-01',false,false)),'V5 nao reivindica formulario');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v6(false,'2026-10-01',false,false)),'flag falsa nao reivindica');
create temp table job as select * from public.reivindicar_whatsapp_v6(true,'2026-10-20 00:00:00-03',false,false);
select pg_temp.verificar((select count(*)=1 from job),'V6 reivindica uma unica reserva');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v6(true,'2026-10-20 00:00:00-03',false,false)),'segunda reserva nao duplica');
select pg_temp.verificar(public.resultado_whatsapp_v3(j.id,j.lease_token,'started',null,true,'2026-10-01') is null,'V3 nao inicia formulario mesmo com flags') from job j;
select pg_temp.verificar(public.resultado_whatsapp_v5(j.id,j.lease_token,'started',null,true,'2026-10-01',false,false,null,null,null,false) is null,'V5 nao inicia formulario') from job j;
-- Voltar a preencher antes da primeira parte apenas remarca, sem gastar tentativas.
update public.leads set respostas=respostas||'{"local":"respondeu antes de enviar"}' where id='60000000-0000-4000-8000-000000000001';
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'started',null,true,'2026-10-20',false,false,null,null,null,false) is null,'nova atividade impede primeira parte') from job j;
select pg_temp.verificar((select estado='pendente' and tentativas=0 and iniciado_em is null and proxima_tentativa_em='2026-10-21 09:00:00-03' from public.whatsapp_outbox where lead_id='60000000-0000-4000-8000-000000000001'),'reagenda09h preservando elegibilidade');
-- V4 nao expira o registro adiado, nem altera o TTL ou estado em manutencao.
select set_config('test.formulario_clock','2026-10-21 08:30:00-03',true);
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v4(true,'2026-10-01',false)),'V4 continua ignorando o registro adiado');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false)),'08h30 nao antecipa vencimento remarcado09h');
select set_config('test.formulario_clock','2026-10-21 09:00:00-03',true);
truncate job; insert into job select * from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false);
select pg_temp.verificar((select count(*)=1 from job),'09h libera o registro adiado');
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'started',null,true,'2026-10-20',false,false,null,null,null,false)='enviando','primeira parte inicia') from job j;
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'started',null,true,'2026-10-20',false,false,null,null,null,false)='enviando','partes seguintes revalidam') from job j;
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'sent',null,false,null,false,false,null,null,null,false)='enviado','ACK aceito com flag desligada') from job j;
select pg_temp.verificar((select status::text='incompleto' from public.leads where id='60000000-0000-4000-8000-000000000001'),'lembrete nao move card');
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6(c.inicio,c.mensagens,'https://melstorymaker.com.br')=0,'ACK nao permite segunda sequencia') from config c;

-- Lead criado antes do corte nunca e importado, mesmo sem historico de envio.
insert into public.leads(id,categoria,status,respostas,whatsapp,created_at)
  values('60000000-0000-4000-8000-000000000002','casamento','incompleto','{}','19912345678','2026-10-19');
select set_config('test.formulario_clock','2026-10-21 15:00:00-03',true);
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6(c.inicio,c.mensagens,'https://melstorymaker.com.br')=0,'lead anterior ao corte excluido') from config c;
-- Vencimento23h → fila09h; worker atrasado na madrugada nao envia.
select set_config('test.formulario_clock','2026-10-21 17:00:00-03',true);
insert into public.leads(id,categoria,status,respostas,whatsapp,created_at)
  values('60000000-0000-4000-8000-000000000003','casamento','incompleto','{}','19912345678','2026-10-21 17:00:00-03');
select set_config('test.formulario_clock','2026-10-21 23:00:00-03',true);
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6(c.inicio,c.mensagens,'https://melstorymaker.com.br')=1,'vencimento noturno registra espera09h') from config c;
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false)),'23h nao reivindica');
select pg_temp.verificar((select proxima_tentativa_em='2026-10-22 09:00:00-03' from public.whatsapp_outbox where lead_id='60000000-0000-4000-8000-000000000003'),'fila noturna conserva09h');
select set_config('test.formulario_clock','2026-10-22 08:30:00-03',true);
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false)),'08h30 nao antecipa09h original');
-- Concluir formulario entre enqueue e claim cancela o envio.
update public.leads set status='aguardando_revisao' where id='60000000-0000-4000-8000-000000000003';
select set_config('test.formulario_clock','2026-10-22 09:00:00-03',true);
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false)),'concluido nao recebe lembrete');
select pg_temp.verificar((select estado='cancelado' from public.whatsapp_outbox where lead_id='60000000-0000-4000-8000-000000000003'),'lead saiu de Novo fica cancelado');

-- Reserva20h59: entrou em21h antes da primeira mensagem, agenda09h sem gastar tentativa.
select set_config('test.formulario_clock','2026-10-22 14:59:30-03',true);
insert into public.leads(id,categoria,status,respostas,whatsapp,created_at)
  values('60000000-0000-4000-8000-000000000004','casamento','incompleto','{}','19912345678','2026-10-22 14:59:30-03');
select set_config('test.formulario_clock','2026-10-22 20:59:30-03',true);
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6(c.inicio,c.mensagens,'https://melstorymaker.com.br')=1,'enfileira antes21h') from config c;
truncate job; insert into job select * from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false);
select set_config('test.formulario_clock','2026-10-22 21:00:00-03',true);
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'started',null,true,'2026-10-20',false,false,null,null,null,false) is null,'21h entre claim e primeira parte bloqueia') from job j;
select pg_temp.verificar((select estado='pendente' and tentativas=0 and proxima_tentativa_em='2026-10-23 09:00:00-03' from public.whatsapp_outbox where lead_id='60000000-0000-4000-8000-000000000004'),'reserva noturna devolve tentativa e remarca09h');
-- Voltou a preencher por mais de24h: pendencia nao expira no prazo antigo.
select set_config('test.formulario_clock','2026-10-24 07:00:00-03',true);
update public.leads set respostas='{"nome":"resposta recente"}' where id='60000000-0000-4000-8000-000000000004';
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false)),'espera seis horas desde retorno');
select pg_temp.verificar((select estado='pendente' and proxima_tentativa_em='2026-10-24 13:00:00-03' and expira_em>pg_temp.agora() from public.whatsapp_outbox where lead_id='60000000-0000-4000-8000-000000000004'),'TTL renovado enquanto espera atividade');
select set_config('test.formulario_clock','2026-10-24 13:00:00-03',true);
truncate job; insert into job select * from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false);
select pg_temp.verificar((select count(*)=1 from job),'lead que voltou recebe apos novo prazo');
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'started',null,true,'2026-10-20',false,false,null,null,null,false)='enviando','envio inicia depois do retorno') from job j;
update public.leads set respostas=respostas||'{"durante":"nova resposta"}' where id='60000000-0000-4000-8000-000000000004';
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'started',null,true,'2026-10-20',false,false,null,null,null,false) is null,'retorno durante envio bloqueia parte seguinte') from job j;
select pg_temp.verificar((select estado='indeterminado' from public.whatsapp_outbox where lead_id='60000000-0000-4000-8000-000000000004'),'parcial nao pode repetir automatico');
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false)),'parcial nao volta a fila');
-- Worker detecta21h antes do STARTED e reporta FAILED especifico:09h fica persistido.
select set_config('test.formulario_clock','2026-10-24 14:59:30-03',true);
insert into public.leads(id,categoria,status,respostas,whatsapp,created_at)
  values('60000000-0000-4000-8000-000000000005','casamento','incompleto','{}','19912345678','2026-10-24 14:59:30-03');
select set_config('test.formulario_clock','2026-10-24 20:59:30-03',true);
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6(c.inicio,c.mensagens,'https://melstorymaker.com.br')=1,'prepara FAILED noturno') from config c;
truncate job; insert into job select * from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false);
select set_config('test.formulario_clock','2026-10-24 21:00:00-03',true);
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'failed','formulario_nao_perturbe',true,'2026-10-20',false,false,null,null,null,false)='pendente','FAILED de nao perturbe devolve fila') from job j;
select pg_temp.verificar((select estado='pendente' and tentativas=0 and proxima_tentativa_em='2026-10-25 09:00:00-03' from public.whatsapp_outbox where lead_id='60000000-0000-4000-8000-000000000005'),'FAILED noturno persiste09h sem consumir tentativa');
select set_config('test.formulario_clock','2026-10-25 08:30:00-03',true);
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false)),'reinicio08h30 nao antecipa FAILED remarcado09h');
select set_config('test.formulario_clock','2026-10-25 09:00:00-03',true);
truncate job; insert into job select * from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false);
select pg_temp.verificar((select count(*)=1 from job),'FAILED remarcado libera09h');
-- Trocar contato antes da primeira parte cancela sem disparar ao numero antigo.
update public.leads set whatsapp='19998765432' where id='60000000-0000-4000-8000-000000000005';
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'started',null,true,'2026-10-20',false,false,null,null,null,false) is null,'contato antigo bloqueado') from job j;
select pg_temp.verificar((select estado='cancelado' and iniciado_em is null from public.whatsapp_outbox where lead_id='60000000-0000-4000-8000-000000000005'),'troca contato nunca inicia');

-- Cruzar21h apos primeira parte interrompe sem tentar completar/repetir no dia seguinte.
select set_config('test.formulario_clock','2026-10-25 14:59:30-03',true);
insert into public.leads(id,categoria,status,respostas,whatsapp,created_at)
  values('60000000-0000-4000-8000-000000000006','casamento','incompleto','{}','19912345678','2026-10-25 14:59:30-03');
select set_config('test.formulario_clock','2026-10-25 20:59:30-03',true);
select pg_temp.verificar(public.enfileirar_lembretes_formulario_whatsapp_v6(c.inicio,c.mensagens,'https://melstorymaker.com.br')=1,'prepara cruzamento noturno apos inicio') from config c;
truncate job; insert into job select * from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false);
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'started',null,true,'2026-10-20',false,false,null,null,null,false)='enviando','primeira parte antes21h e autorizada') from job j;
select set_config('test.formulario_clock','2026-10-25 21:00:00-03',true);
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'started',null,true,'2026-10-20',false,false,null,null,null,false) is null,'segunda parte21h bloqueada') from job j;
select pg_temp.verificar((select estado='indeterminado' and iniciado_em is not null from public.whatsapp_outbox where lead_id='60000000-0000-4000-8000-000000000006'),'sequencia parcial nao volta a pendente');
select set_config('test.formulario_clock','2026-10-26 09:00:00-03',true);
select pg_temp.verificar((select count(*)=0 from public.reivindicar_whatsapp_v6(true,'2026-10-20',false,false)),'dia seguinte nunca repete parcial');
select pg_temp.verificar(public.resultado_whatsapp_v6(j.id,j.lease_token,'sent',null,false,null,false,false,null,null,null,false)='enviado','ACK tardio completo reconcilia mesmo bloqueado') from job j;

select pg_temp.verificar(not has_function_privilege('anon','public.reivindicar_whatsapp_v6(boolean,timestamptz,boolean,boolean)','EXECUTE'),'anon nao reivindica');
select pg_temp.verificar(not has_function_privilege('authenticated','public.enfileirar_lembretes_formulario_whatsapp_v6(timestamptz,jsonb,text)','EXECUTE'),'sessao comum nao enfileira');
rollback;
