-- Rodar somente em Postgres isolado, depois dos três SQLs de WhatsApp.
begin;
insert into public.leads (id,status,created_at,whatsapp) values
  ('af111111-0000-4000-8000-000000000001','aguardando_revisao',now()-interval '2 days','19988887777'),
  ('af111111-0000-4000-8000-000000000002','incompleto',now()-interval '25 hours','19988887777');

do $$
declare
  v_estado text;
  v_job public.whatsapp_outbox%rowtype;
  v_seq jsonb := jsonb_build_array(
    jsonb_build_object('message','Olá! Aqui é a Mel Storymaker 👋','delayBeforeSeconds',0),
    jsonb_build_object('message','Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊','delayBeforeSeconds',2),
    jsonb_build_object('message','Suas respostas estão salvas, acesse o link:','delayBeforeSeconds',3));
begin
  if public.registrar_confirmacao_whatsapp('af111111-0000-4000-8000-000000000001',
    '5519988887777','Confirmação não autorizada',now()) is not null then
    raise exception 'RPC de confirmação deveria ser no-op';
  end if;
  if exists(select 1 from public.whatsapp_outbox where lead_id='af111111-0000-4000-8000-000000000001') then
    raise exception 'RPC antiga criou confirmação';
  end if;
  foreach v_estado in array array['pendente','reservado','enviando'] loop
    begin
      insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,estado)
      values ('af111111-0000-4000-8000-000000000001','confirmacao_recebimento',now(),now()+interval '24 hours',
        '5519988887777','Mensagem não autorizada',v_estado);
      raise exception 'Confirmação entrou no circuito de envio: %',v_estado;
    exception when check_violation then null;
    end;
  end loop;
  -- O fato histórico permanece visível, mas não volta a ser enviável.
  insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,estado,enviado_em)
  values ('af111111-0000-4000-8000-000000000001','confirmacao_recebimento',now(),now()+interval '24 hours',
    '5519988887777','Histórico fictício','enviado',now());
  begin
    update public.whatsapp_outbox set estado='pendente'
      where lead_id='af111111-0000-4000-8000-000000000001';
    raise exception 'Histórico foi rearmado';
  exception when check_violation then null;
  end;
  if exists(select 1 from public.reivindicar_whatsapp()) then
    raise exception 'Worker legado recebeu confirmação';
  end if;
  if public.enfileirar_lembretes_formulario_whatsapp_v3(now()-interval '2 days',v_seq,'https://crm.invalid') <> 1 then
    raise exception 'A sequência aprovada deixou de enfileirar';
  end if;
  select * into v_job from public.reivindicar_whatsapp_v3(true,now()-interval '2 days');
  if not found or v_job.tipo <> 'lembrete_formulario_24h' or jsonb_array_length(v_job.sequencia) <> 4 then
    raise exception 'Claim não retornou exclusivamente a sequência aprovada';
  end if;
  if v_job.sequencia #>> '{3,message}' <> 'https://crm.invalid/continuar/af111111-0000-4000-8000-000000000002' then
    raise exception 'Link individual incorreto';
  end if;
  if public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'started',null,true,now()-interval '2 days') <> 'enviando'
    or public.resultado_whatsapp_v3(v_job.id,v_job.lease_token,'sent',null,true,now()-interval '2 days') <> 'enviado' then
    raise exception 'Política bloqueou a sequência aprovada';
  end if;
  if has_table_privilege('anon','public.whatsapp_outbox','SELECT')
    or has_table_privilege('authenticated','public.whatsapp_outbox','SELECT')
    or has_function_privilege('anon','public.registrar_confirmacao_whatsapp(uuid,text,text,timestamptz)','EXECUTE') then
    raise exception 'Permissão pública foi ampliada';
  end if;
end;
$$;
rollback;
