-- SOMENTE Postgres isolado. Fixtures sinteticas, sem bridge/MCP, rollback final.
begin;
set local timezone='UTC';
do $$ begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
    raise exception 'Fixture exige Postgres isolado SEM realtime.send real'; end if;
  if exists(select 1 from pg_proc where pronamespace='public'::regnamespace and proname in
    ('criar_lote_legado_whatsapp','ativar_lote_legado_whatsapp','pausar_lote_legado_whatsapp','reivindicar_whatsapp_v7','resultado_whatsapp_v7')
    and (prosecdef or proconfig is distinct from array['search_path=pg_catalog']))
    or has_function_privilege('anon','public.criar_lote_legado_whatsapp(uuid,jsonb,timestamptz)','EXECUTE')
    or has_function_privilege('authenticated','public.resultado_whatsapp_v7(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)','EXECUTE')
    or has_table_privilege('anon','public.whatsapp_lote_legado_itens','SELECT')
    or exists(select 1 from pg_class where oid in('public.whatsapp_lotes_legados'::regclass,'public.whatsapp_lote_legado_itens'::regclass) and not relrowsecurity)
    then raise exception 'Lote perdeu isolamento/permissoes'; end if;
end; $$;
set local role service_role;
do $$
declare a timestamptz:=statement_timestamp(); b uuid:='ba777777-0000-4000-8000-000000000001';
  bad uuid:='ba777777-0000-4000-8000-000000000002'; payload jsonb; badpayload jsonb; v jsonb;
  o public.whatsapp_outbox%rowtype; v_id uuid; r text; n integer; due timestamptz; first_due timestamptz;
  checked timestamptz; coverage timestamptz; last_at timestamptz; complete boolean;
begin
  insert into public.leads(id,status,nome_display,whatsapp,created_at,enviado_em,pdf_url,data_evento)
    select ('aa777777-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,'esfriou','Cliente sintetico '||g,
      '19988'||lpad(g::text,6,'0'),a-interval '60 days',a-interval '35 days','https://crm.invalid/lote/'||g,
      (a at time zone 'America/Sao_Paulo')::date+60 from generate_series(1,50)g;
  select jsonb_agg(jsonb_build_object('lead_id',l.id,'proposta_enviado_em',l.enviado_em,'proposta_pdf_url',l.pdf_url,
    'destinatario',public.destinatario_whatsapp_br(l.whatsapp),'tipo','lembrete_proposta_7d',
    'sequencia',public.sequencia_lembrete_proposta('lembrete_proposta_7d',l.pdf_url),
    'mensagem',(select string_agg(p.value->>'message',E'\n\n' order by p.n)
      from jsonb_array_elements(public.sequencia_lembrete_proposta('lembrete_proposta_7d',l.pdf_url)) with ordinality p(value,n)),
    'ordem',right(l.id::text,12)::integer,'job_id',('ab777777-0000-4000-8000-'||right(l.id::text,12))::uuid)
    order by l.id) into payload from public.leads l where l.id::text like 'aa777777-%';

  -- Limites fechados e transacao integral: nada parcial sobrevive a um erro.
  v:=public.criar_lote_legado_whatsapp(b,payload,a+interval '2 hours');
  if v->>'erro' is distinct from 'payload_invalido' then raise exception 'Aceitou50itens'; end if;
  payload:=(select jsonb_agg(x.value order by x.n) from jsonb_array_elements(payload) with ordinality x(value,n) where x.n<=12);
  badpayload:=jsonb_set(payload,'{1,ordem}','1');
  v:=public.criar_lote_legado_whatsapp(bad,badpayload,a+interval '2 hours');
  if v->>'erro' is distinct from 'manifesto_invalido' or exists(select 1 from public.whatsapp_lotes_legados where id=bad)
    then raise exception 'Manifesto duplicado deixou efeito parcial'; end if;
  badpayload:=jsonb_set(payload,'{0,mensagem}','"mensagem nao aprovada"');
  v:=public.criar_lote_legado_whatsapp(bad,badpayload,a+interval '2 hours');
  if v->>'erro' is distinct from 'manifesto_invalido' then raise exception 'Aceitoutextoalterado'; end if;
  if public.criar_lote_legado_whatsapp(bad,payload,a+interval '25 hours')->>'erro' is distinct from 'payload_invalido'
    then raise exception 'Aceitouprazo>24h'; end if;
  update public.leads set data_evento=(a at time zone 'America/Sao_Paulo')::date-1 where id=(payload#>>'{0,lead_id}')::uuid;
  v:=public.criar_lote_legado_whatsapp(bad,payload,a+interval '2 hours');
  if v->>'codigo' is distinct from 'lote_evento_nao_futuro' then raise exception 'Aceitoueventopassado'; end if;
  update public.leads set data_evento=(a at time zone 'America/Sao_Paulo')::date+60,nome_display='TESTE HENRIQUE' where id=(payload#>>'{0,lead_id}')::uuid;
  if public.criar_lote_legado_whatsapp(bad,payload,a+interval '2 hours')->>'codigo' is distinct from 'lote_teste_excluido'
    then raise exception 'Aceitoucardteste'; end if;
  update public.leads set nome_display='Cliente sintetico 1' where id=(payload#>>'{0,lead_id}')::uuid;

  -- Reutilizacao de cancelamento previo preserva o MESMO job_id.
  v:=public.enfileirar_lembrete_proposta_whatsapp((payload#>>'{0,lead_id}')::uuid,7,a-interval '35 days',b);
  v_id:=(v->>'id')::uuid;
  update public.whatsapp_outbox set estado='cancelado',ultimo_codigo='historico_incompleto' where id=v_id;
  payload:=jsonb_set(payload,'{0,job_id}',to_jsonb(v_id::text));
  v:=public.criar_lote_legado_whatsapp(b,payload,a+interval '2 hours');
  if v->>'estado' is distinct from 'pausado' or (v->>'quantidade')::integer<>12 then raise exception 'Nao criou manifesto: %',v; end if;
  if (select count(*) from public.whatsapp_outbox where lote_legado_id=b)<>0
    or exists(select 1 from public.reivindicar_whatsapp_v7(false,null,true,false)) then raise exception 'Criacao enviou/claimouantesativar'; end if;
  if public.criar_lote_legado_whatsapp(b,payload,a+interval '2 hours')->>'erro' is distinct from 'lote_ja_existe'
    then raise exception 'Criacaonaoidempotentepeloid'; end if;
  begin
    update public.whatsapp_lote_legado_itens set mensagem='troca' where lote_id=b and ordem=1;
    raise exception 'Nao bloqueou manifesto imutavel';
  exception when raise_exception then if sqlerrm<>'manifesto_legado_imutavel' then raise; end if; end;
  begin
    insert into public.whatsapp_lote_legado_itens select lote_id,
      'aa777777-0000-4000-8000-000000000050',proposta_enviado_em,proposta_pdf_url,
      '5519988000050',tipo,sequencia,mensagem,49,gen_random_uuid(),'aguardando',null,null
      from public.whatsapp_lote_legado_itens where lote_id=b and ordem=1;
    raise exception 'Permitiu append apos selo';
  exception when raise_exception then if sqlerrm<>'manifesto_legado_imutavel' then raise; end if; end;
  -- Carimbo manual antigo nao e ACK e nao impede rodada autorizada.
  update public.leads set lembrete_7_em=a-interval '1 day' where id=(payload#>>'{1,lead_id}')::uuid;
  perform public.ativar_lote_legado_whatsapp(b);
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
  if o.id is distinct from v_id or o.lote_legado_id is distinct from b then raise exception 'Nao reutilizoujobcancelado'; end if;
  select proximo_inicio_em into due from public.whatsapp_lotes_legados where id=b;
  if due<a+interval '120 seconds' or due>a+interval '225 seconds' then raise exception 'Cooldownforadolimite'; end if;
  if exists(select 1 from public.reivindicar_whatsapp_v7(false,null,true,false))
    or exists(select 1 from public.reivindicar_whatsapp_v4(false,null,true)) then raise exception 'Duplareserva/oldclaim'; end if;
  r:=public.resultado_whatsapp_v6(o.id,o.lease_token,'started',null,false,null,true,false,a,a-interval '20 days',null,true);
  if r is not null or (select iniciado_em from public.whatsapp_outbox where id=o.id) is not null then raise exception 'Protocolooldinicioulote'; end if;
  r:=public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,a,a-interval '1 hour',null,false);
  if r is distinct from 'enviando' then raise exception 'Excecaocoberturaincompletanaofuncionou'; end if;
  select proximo_inicio_em into first_due from public.whatsapp_lotes_legados where id=b;
  r:=public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,a,a-interval '1 hour',null,false);
  if r<>'enviando' or (select proximo_inicio_em from public.whatsapp_lotes_legados where id=b) is distinct from first_due then raise exception 'Partesrenovaramcooldown'; end if;
  if (select lembrete_7_em from public.leads where id=o.lead_id) is not null then raise exception 'CarimbousemACK'; end if;
  r:=public.resultado_whatsapp_v7(o.id,o.lease_token,'sent',null,false,null,true,false,null,null,null,null);
  if r<>'enviado' or (select lembrete_7_em from public.leads where id=o.lead_id) is null
    or (select status from public.leads where id=o.lead_id)<>'esfriou' then raise exception 'ACKnaoquitou/moveucard'; end if;
  perform public.resultado_whatsapp_v7(o.id,o.lease_token,'sent',null,false,null,true,false,null,null,null,null);
  if (select count(*) from public.whatsapp_outbox where lead_id=o.lead_id)<>1 then raise exception 'ACKduplicou'; end if;
  if exists(select 1 from public.reivindicar_whatsapp_v7(false,null,true,false)) then raise exception 'Ignorouespacamentopersistido'; end if;

  -- Falhas de prova nunca autorizam nem a excecao; somente complete:false coerente.
  update public.whatsapp_lotes_legados set proximo_inicio_em=a-interval '1 hour' where id=b;
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
  update public.leads set lembrete_7_em=null where id=o.lead_id;
  for n in 1..10 loop
    checked:=a;coverage:=a-interval '1 hour';last_at:=null;complete:=false;
    case n when 1 then checked:=null;when 2 then checked:='1970-01-01';when 3 then checked:=a-interval '31 seconds';
      when 4 then checked:=a+interval '6 seconds';when 5 then coverage:=null;when 6 then coverage:='0001-01-01';
      when 7 then coverage:=a+interval '1 second';when 8 then last_at:=a+interval '1 second';
      when 9 then complete:=null;when 10 then last_at:=a-interval '4 days'; end case;
    r:=public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,checked,coverage,last_at,complete);
    if r is not null or (select iniciado_em from public.whatsapp_outbox where id=o.id) is not null then raise exception 'Provainvalida%iniciou',n; end if;
    if n=10 and (select ultimo_codigo from public.whatsapp_outbox where id=o.id)<>'inactivity_recent' then raise exception 'Nao preservourecent'; end if;
    update public.whatsapp_outbox set estado='reservado' where id=o.id;
    update public.whatsapp_lote_legado_itens set estado='reservado' where job_id=o.id;
  end loop;
  perform public.resultado_whatsapp_v7(o.id,o.lease_token,'failed','inactivity_recent',false,null,true,false,a,a-interval '1 hour',a-interval '4 days',false);

  -- Pausar entre claim e STARTED realmente cancela; nao ha autorizacao residual.
  update public.whatsapp_lotes_legados set proximo_inicio_em=a-interval '1 hour' where id=b;
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
  perform public.pausar_lote_legado_whatsapp(b);
  r:=public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,a,a-interval '1 hour',null,false);
  if r is not null or (select ultimo_codigo from public.whatsapp_outbox where id=o.id)<>'lote_nao_ativo'
    or exists(select 1 from public.reivindicar_whatsapp_v7(false,null,true,false)) then raise exception 'Pauseinoperante'; end if;
  perform public.ativar_lote_legado_whatsapp(b);
  if (select proximo_inicio_em from public.whatsapp_lotes_legados where id=b)<a+interval '120 seconds' then raise exception 'Retomadadisparoucatchup'; end if;

  -- Envio parcial e indeterminado nunca repete; ACK tardio reconcilia mesmo pausado.
  update public.whatsapp_lotes_legados set proximo_inicio_em=a-interval '1 hour' where id=b;
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
  perform public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,a,a-interval '1 hour',null,false);
  r:=public.resultado_whatsapp_v7(o.id,o.lease_token,'failed','partial_send',false,null,true,false,null,null,null,null);
  if r<>'indeterminado' or (select lembrete_7_em from public.leads where id=o.lead_id) is not null then raise exception 'Parcialquitou'; end if;
  perform public.pausar_lote_legado_whatsapp(b);
  r:=public.resultado_whatsapp_v7(o.id,o.lease_token,'sent',null,false,null,false,false,null,null,null,null);
  if r<>'enviado' then raise exception 'ACKtardioperdido'; end if;
  perform public.ativar_lote_legado_whatsapp(b);

  -- Mudanca de proposta entre reserva e primeira parte bloqueia somente esse item.
  update public.whatsapp_lotes_legados set proximo_inicio_em=a-interval '1 hour' where id=b;
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
  update public.leads set pdf_url='https://crm.invalid/revisao-nova' where id=o.lead_id;
  r:=public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,a,a-interval '1 hour',null,false);
  if r is not null or (select iniciado_em from public.whatsapp_outbox where id=o.id) is not null then raise exception 'Snapshotalteradopassou'; end if;

  -- Lease vencida ANTES de qualquer parte pode ser revendicada, nunca junto com outra.
  update public.whatsapp_lotes_legados set proximo_inicio_em=a-interval '1 hour' where id=b;
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
  v_id:=o.id;
  update public.whatsapp_outbox set lease_ate=a-interval '1 second' where id=o.id;
  update public.whatsapp_lotes_legados set proximo_inicio_em=a-interval '1 hour' where id=b;
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
  if o.id is distinct from v_id or o.tentativas<>2 then raise exception 'LeaseantesSTARTEDnaorecuperoumesmojob'; end if;
  perform public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,a,a-interval '1 hour',null,false);
  update public.whatsapp_outbox set lease_ate=a-interval '1 second' where id=o.id;
  perform public.reivindicar_whatsapp_v7(false,null,true,false);
  if (select estado from public.whatsapp_outbox where id=o.id)<>'indeterminado' then raise exception 'CrashaposSTARTEDnaofechou'; end if;
  if public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,a,a-interval '1 hour',null,false) is not null then raise exception 'Crashreiniciouenvio'; end if;

  -- Identidade/saude do bridge: recusa do worker cancela e nunca quita.
  update public.whatsapp_lotes_legados set proximo_inicio_em=a-interval '1 hour' where id=b;
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
  r:=public.resultado_whatsapp_v7(o.id,o.lease_token,'failed','identidade_nao_confirmada',false,null,true,false,null,null,null,null);
  if r<>'cancelado' or (select lembrete_7_em from public.leads where id=o.lead_id) is not null then raise exception 'Identidadenaobloqueou'; end if;
  -- Um ACK real pelo endpoint anterior tambem reconcilia o item no proximo poll.
  update public.whatsapp_lotes_legados set proximo_inicio_em=a-interval '1 hour' where id=b;
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
  perform public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,a,a-interval '1 hour',null,false);
  r:=public.resultado_whatsapp_v6(o.id,o.lease_token,'sent',null,false,null,false,false,null,null,null,null);
  if r<>'enviado' then raise exception 'ACKoldnaoaceito'; end if;
  perform public.reivindicar_whatsapp_v7(false,null,true,false);
  if (select estado from public.whatsapp_lote_legado_itens where job_id=o.id)<>'enviado' then raise exception 'ACKoldnaoreconciliou'; end if;
  -- Novo clique de um item bloqueado sai do lote e exige cobertura COMPLETA normal.
  select x.* into o from public.whatsapp_outbox x join public.whatsapp_lote_legado_itens i on i.job_id=x.id
    where i.lote_id=b and i.estado='bloqueado' and x.estado='cancelado' and x.ultimo_codigo='identidade_nao_confirmada' limit 1;
  v:=public.enfileirar_lembrete_proposta_whatsapp(o.lead_id,7,o.proposta_enviado_em,b);
  if v->>'id' is distinct from o.id::text or (select lote_legado_id from public.whatsapp_outbox where id=o.id) is not null
    then raise exception 'Botao normal ficou preso ao lote'; end if;
  select * into o from public.reivindicar_whatsapp_v4(false,null,true);
  r:=public.resultado_whatsapp_v4(o.id,o.lease_token,'started',null,false,null,true,a,a-interval '1 hour',null,false);
  if r is not null or (select iniciado_em from public.whatsapp_outbox where id=o.id) is not null then raise exception 'Retrynormalherdouexcecao'; end if;
  v:=public.enfileirar_lembrete_proposta_whatsapp(o.lead_id,7,o.proposta_enviado_em,b);
  select * into o from public.reivindicar_whatsapp_v4(false,null,true);
  r:=public.resultado_whatsapp_v4(o.id,o.lease_token,'started',null,false,null,true,a,a-interval '6 days',null,true);
  if r<>'enviando' then raise exception 'Retrynormalcomhistoriconormalnaofuncionou'; end if;
  perform public.resultado_whatsapp_v4(o.id,o.lease_token,'sent',null,false,null,true,null,null,null,null);
  if (select estado from public.whatsapp_lote_legado_itens where job_id=o.id)<>'bloqueado' then raise exception 'ACKnormalcontoucomolote'; end if;
  -- Expiracao nao estende autorizacao durante uma interrupcao longa.
  update public.whatsapp_lotes_legados set proximo_inicio_em=a-interval '1 hour' where id=b;
  select * into o from public.reivindicar_whatsapp_v7(false,null,true,false);
  update public.whatsapp_outbox set expira_em=ocorrido_em+interval '24 hours',lease_ate=a-interval '1 second' where id=o.id;
  r:=public.resultado_whatsapp_v7(o.id,o.lease_token,'started',null,false,null,true,false,a,a-interval '1 hour',null,false);
  if r is not null then raise exception 'Leasevencidapassou'; end if;
end; $$;
rollback;
