-- SOMENTE Postgres isolado, apos whatsapp-testes-owner.sql e schemas atuais.
-- Fixture de leads precisa de nome_display text. Nunca executar em producao.
begin;
set local timezone='UTC';
do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    raise exception 'Fixture exige Postgres isolado SEM realtime.send real';
  end if;
  if exists(select 1 from pg_policy where polrelid='public.whatsapp_testes_owner'::regclass)
    or not(select relrowsecurity from pg_class where oid='public.whatsapp_testes_owner'::regclass)
    or has_table_privilege('anon','public.whatsapp_testes_owner','SELECT')
    or has_table_privilege('authenticated','public.whatsapp_testes_owner','INSERT')
    or has_function_privilege('anon','public.teste_proposta_whatsapp_valido(uuid,text,timestamptz,text,text,timestamptz)','EXECUTE')
    or has_function_privilege('authenticated','public.marcar_teste_owner_whatsapp()','EXECUTE') then
    raise exception 'Excecao de teste ficou publica';
  end if;
end;
$$;

set local role service_role;
do $$
declare
  v_agora timestamptz:=statement_timestamp();
  v_admin uuid:='ad000000-0000-4000-8000-000000000001';
  v_sete uuid:='01b985e2-6bff-4e9c-bb5e-2f1cc280edf7';
  v_trinta uuid:='abf88ff2-ea34-4e32-994d-f7dc75df599b';
  v_normal uuid:='ae000000-0000-4000-8000-000000000001';
  v_job public.whatsapp_outbox%rowtype; v_json jsonb; v_carimbo timestamptz; v_retorno text; v_claim integer;
begin
  if v_agora>=timestamptz '2026-10-17T18:00:00Z' then
    raise exception 'Fixture de validade fixa precisa de relogio anterior ao vencimento';
  end if;
  insert into public.leads(id,status,nome_display,whatsapp,created_at,enviado_em,pdf_url)
    select id,'esfriou','TESTE HENRIQUE','19988763916',v_agora-interval '60 days',
      v_agora-interval '35 days','https://crm.invalid/teste/'||id from unnest(array[
      v_sete,'d459193f-9e7c-4b2c-995d-7f829a0936bd'::uuid,
      '13e49741-9d35-404c-ae54-42fe93e55c66'::uuid,v_trinta,
      '9263d823-d059-4e0a-b759-9184035dec89'::uuid,v_normal]) id;
  insert into public.whatsapp_testes_owner(lead_id,marco,proposta_enviado_em,proposta_pdf_url)
    select id,case when id in(v_trinta,'9263d823-d059-4e0a-b759-9184035dec89'::uuid) then 30 else 7 end,
      enviado_em,pdf_url from public.leads where id<>v_normal;
  if (select count(*) from public.whatsapp_testes_owner)<>5 then raise exception 'Escopo nao tem cinco casos'; end if;
  if not public.teste_proposta_whatsapp_valido(v_sete,'lembrete_proposta_7d',v_agora-interval '35 days',
    'https://crm.invalid/teste/'||v_sete,'5519988763916',v_agora)
    or public.teste_proposta_whatsapp_valido(v_sete,'lembrete_proposta_7d',v_agora-interval '35 days',
      'https://crm.invalid/teste/'||v_sete,'5519988763916',timestamptz '2026-10-17T18:00:00Z')
    or public.teste_proposta_whatsapp_valido(v_sete,'lembrete_proposta_30d',v_agora-interval '35 days',
      'https://crm.invalid/teste/'||v_sete,'5519988763916',v_agora) then
    raise exception 'Scope/marco/expiracao incorretos';
  end if;
  begin
    insert into public.whatsapp_testes_owner(lead_id,marco,proposta_enviado_em,proposta_pdf_url)
      values(v_normal,7,v_agora-interval '35 days','https://crm.invalid');
    raise exception 'Allowlist aceitou sexto ID';
  exception when check_violation then null;
  end;
  if public.enfileirar_lembrete_proposta_whatsapp(v_normal,30,v_agora-interval '35 days',v_admin)->>'erro'
    is distinct from 'lembrete_7_nao_enviado' then raise exception 'Teste vazou para cliente normal'; end if;
  update public.leads set nome_display='Teste Henrique' where id=v_trinta;
  if public.enfileirar_lembrete_proposta_whatsapp(v_trinta,30,v_agora-interval '35 days',v_admin)->>'erro'
    is distinct from 'lembrete_7_nao_enviado' then raise exception 'Nome divergente ganhou excecao'; end if;
  update public.leads set nome_display='TESTE HENRIQUE',whatsapp='19988763917' where id=v_trinta;
  if public.enfileirar_lembrete_proposta_whatsapp(v_trinta,30,v_agora-interval '35 days',v_admin)->>'erro'
    is distinct from 'lembrete_7_nao_enviado' then raise exception 'Outro telefone ganhou excecao'; end if;
  update public.leads set whatsapp='19988763916' where id=v_trinta;

  -- 30d e um teste explicito, sem fabricar ACK7 ou cobertura de15dias.
  v_json:=public.enfileirar_lembrete_proposta_whatsapp(v_trinta,30,v_agora-interval '35 days',v_admin);
  if v_json->>'id' is null then raise exception 'Teste30 nao enfileirou: %',v_json; end if;
  select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
  if v_job.teste_owner_expira_em is distinct from timestamptz '2026-10-17T18:00:00Z'
    or v_job.tipo<>'lembrete_proposta_30d' then raise exception 'Claim sem marcador fechado'; end if;
  if public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,null,null,null,false)
    is distinct from 'enviando' then raise exception 'Teste exigiu cobertura inventada'; end if;
  if (select historico_verificado_em is not null or historico_cobertura_inicio_em is not null
    or ultima_interacao_em is not null from public.whatsapp_outbox where id=v_job.id)
    or (select lembrete_7_em is not null or lembrete_30_em is not null from public.leads where id=v_trinta) then
    raise exception 'Teste inventou cobertura ou ACK'; end if;
  -- Revogacao entre partes bloqueia nova parte; ACK tardio verdadeiro continua permitido.
  delete from public.whatsapp_testes_owner where lead_id=v_trinta;
  v_retorno:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,null,null,null,false);
  if v_retorno is not null
    or (select estado from public.whatsapp_outbox where id=v_job.id)<>'indeterminado' then
    raise exception 'Revogacao nao interrompeu sequencia'; end if;
  if public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'sent',null,false,null,false,null,null,null,false)<>'enviado' then
    raise exception 'Revogacao apagou ACK factual'; end if;
  select enviado_em into v_carimbo from public.whatsapp_outbox where id=v_job.id;
  perform public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'sent',null,false,null,false,null,null,null,false);
  if (select enviado_em from public.whatsapp_outbox where id=v_job.id) is distinct from v_carimbo then
    raise exception 'ACK repetido mudou historico'; end if;

  -- Teste7 funciona mesmo com interacao recente; evidencia continua NULL.
  perform public.enfileirar_lembrete_proposta_whatsapp(v_sete,7,v_agora-interval '35 days',v_admin);
  select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
  if public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,
    v_agora,v_agora,v_agora,true)<>'enviando' then raise exception 'Teste7 recusou interacao de teste'; end if;
  if (select historico_verificado_em is not null from public.whatsapp_outbox where id=v_job.id) then
    raise exception 'Teste persistiu falsa comprovacao'; end if;
  perform public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'sent',null,false,null,true,null,null,null,false);
  if public.enfileirar_lembrete_proposta_whatsapp(v_sete,7,v_agora-interval '35 days',v_admin)->>'erro'<>'ja_enviado'
    or (select count(*) from public.whatsapp_outbox where lead_id=v_sete)<>1 then
    raise exception 'Teste perdeu protecao contra duplicidade'; end if;

  -- Cliente normal continua exigindo historico real.
  perform public.enfileirar_lembrete_proposta_whatsapp(v_normal,7,v_agora-interval '35 days',v_admin);
  select * into v_job from public.reivindicar_whatsapp_v4(false,null,true);
  v_retorno:=public.resultado_whatsapp_v4(v_job.id,v_job.lease_token,'started',null,false,null,true,null,null,null,false);
  if v_job.teste_owner_expira_em is not null
    or v_retorno is not null
    or (select ultimo_codigo from public.whatsapp_outbox where id=v_job.id)<>'inactivity_unverified' then
    raise exception 'Cliente normal ignorou historico'; end if;

  -- Snapshot de teste revogado enquanto pendente nunca volta ao fluxo normal.
  v_sete:='d459193f-9e7c-4b2c-995d-7f829a0936bd';
  perform public.enfileirar_lembrete_proposta_whatsapp(v_sete,7,v_agora-interval '35 days',v_admin);
  delete from public.whatsapp_testes_owner where lead_id=v_sete;
  select count(*) into v_claim from public.reivindicar_whatsapp_v4(false,null,true);
  if v_claim<>0
    or (select ultimo_codigo from public.whatsapp_outbox where lead_id=v_sete)<>'teste_owner_expirado' then
    raise exception 'Teste revogado degradou para cliente normal'; end if;
end;
$$;
reset role;
rollback;
