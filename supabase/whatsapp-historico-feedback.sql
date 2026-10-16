-- Feedback verificavel do historico de WhatsApp nos lembretes manuais de 7/30 dias.
-- Aplicar depois dos scripts de WhatsApp atuais (incluindo owner/proposta/formulario).
-- Mantem os gates de 5/15 dias, ACKs e deduplicacao; nao enfileira nem envia mensagens.
-- Prova parcial e diagnostico, sem conceder permissao para iniciar um envio.
begin;

create or replace function public.enfileirar_lembrete_proposta_whatsapp(
  p_lead_id uuid, p_marco integer, p_proposta_enviado_em timestamptz, p_solicitado_por uuid
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp(); v_lead public.leads%rowtype;
  v_job public.whatsapp_outbox%rowtype; v_tipo text; v_recusa text; v_seq jsonb; v_texto text;
begin
  if p_marco not in (7,30) or p_marco is null or p_solicitado_por is null then
    return jsonb_build_object('erro','payload_invalido'); end if;
  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then return jsonb_build_object('erro','lead_nao_encontrado'); end if;
  v_tipo:=case when p_marco=7 then 'lembrete_proposta_7d' else 'lembrete_proposta_30d' end;
  v_recusa:=public.recusa_lembrete_proposta_whatsapp(p_lead_id,v_tipo,p_proposta_enviado_em,
    v_lead.pdf_url,public.destinatario_whatsapp_br(v_lead.whatsapp),v_agora);
  if v_recusa is not null then return jsonb_build_object('erro',v_recusa); end if;
  select * into v_job from public.whatsapp_outbox where lead_id=p_lead_id and tipo=v_tipo
    and proposta_enviado_em=p_proposta_enviado_em for update;
  if found then
    if v_job.estado='enviado' then return jsonb_build_object('erro','ja_enviado'); end if;
    if v_job.estado in ('pendente','reservado','enviando') then
      return jsonb_build_object('id',v_job.id,'estado',v_job.estado,'reutilizado',true); end if;
    if v_job.estado='indeterminado' or v_job.iniciado_em is not null then
      return jsonb_build_object('erro','envio_indeterminado'); end if;
    if v_job.proposta_pdf_url is distinct from v_lead.pdf_url
      or v_job.destinatario is distinct from public.destinatario_whatsapp_br(v_lead.whatsapp) then
      return jsonb_build_object('erro','proposta_alterada'); end if;
    if v_job.estado<>'cancelado' or v_job.ultimo_codigo is null or v_job.ultimo_codigo not in
      ('inactivity_recent','inactivity_unverified','proposta_condicao_alterada',
        'historico_em_sincronizacao','historico_incompleto','historico_indisponivel','identidade_nao_confirmada') then
      return jsonb_build_object('erro','tentativa_encerrada'); end if;
    -- Outro clique pode refazer apenas o que NUNCA recebeu started/MCP.
    -- Mantem o ID para evitar qualquer colisao com recibos/ledger ja existentes.
    update public.whatsapp_outbox set estado='pendente',ocorrido_em=v_agora,expira_em=v_agora+interval '24 hours',
      solicitado_em=v_agora,solicitado_por=p_solicitado_por,proxima_tentativa_em=v_agora,
      lease_token=null,lease_ate=null,tentativas=0,ultimo_codigo=null,
      historico_verificado_em=null,historico_cobertura_inicio_em=null,ultima_interacao_em=null
      where id=v_job.id;
    return jsonb_build_object('id',v_job.id,'estado','pendente','reutilizado',true);
  end if;
  v_seq:=public.sequencia_lembrete_proposta(v_tipo,v_lead.pdf_url);
  select string_agg(p.value->>'message',E'\n\n' order by p.n) into v_texto
    from jsonb_array_elements(v_seq) with ordinality p(value,n);
  insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,
    proposta_enviado_em,proposta_pdf_url,solicitado_em,solicitado_por)
  values(p_lead_id,v_tipo,v_agora,v_agora+interval '24 hours',public.destinatario_whatsapp_br(v_lead.whatsapp),
    v_texto,v_seq,p_proposta_enviado_em,v_lead.pdf_url,v_agora,p_solicitado_por) returning * into v_job;
  return jsonb_build_object('id',v_job.id,'estado',v_job.estado,'reutilizado',false);
end;
$$;
revoke execute on function public.enfileirar_lembrete_proposta_whatsapp(uuid,integer,timestamptz,uuid) from anon, authenticated, public;
grant execute on function public.enfileirar_lembrete_proposta_whatsapp(uuid,integer,timestamptz,uuid) to service_role;

create or replace function public.resultado_whatsapp_v4(
  p_id uuid,p_lease_token uuid,p_outcome text,p_code text,
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,
  p_historico_verificado_em timestamptz,p_historico_cobertura_inicio_em timestamptz,
  p_ultima_interacao_em timestamptz,p_historico_completo boolean
)
returns text language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v public.whatsapp_outbox%rowtype; v_lead_id uuid; v_tipo text; v_agora timestamptz:=statement_timestamp();
  v_janela interval; v_recusa text; v_enviado timestamptz; v_diagnostico_valido boolean:=false;
begin
  select o.lead_id,o.tipo into v_lead_id,v_tipo from public.whatsapp_outbox o
    where o.id=p_id and o.lease_token=p_lease_token;
  if not found then return null; end if;
  if v_tipo not in ('lembrete_proposta_7d','lembrete_proposta_30d') then
    return public.resultado_whatsapp_v3(p_id,p_lease_token,p_outcome,p_code,p_formulario_ativo,p_inicio_em);
  end if;
  -- Mesma ordem de locks do enqueue/claim, inclusive no ACK que carimba o lead.
  perform 1 from public.leads where id=v_lead_id for update;
  if not found then return null; end if;
  select * into v from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token for update;
  if not found then return null; end if;
  if p_outcome='started' then
    if v.estado not in ('reservado','enviando') or p_propostas_ativo is not true then return null; end if;
    v_recusa:=public.recusa_lembrete_proposta_whatsapp(v.lead_id,v.tipo,v.proposta_enviado_em,v.proposta_pdf_url,v.destinatario,v_agora);
    if v_recusa is not null then v_recusa:='proposta_condicao_alterada'; end if;
    if v.lease_ate<=v_agora or v.expira_em<=v_agora then v_recusa:='prazo_expirado'; end if;
    v_janela:=case when v.tipo='lembrete_proposta_7d' then interval '5 days' else interval '15 days' end;
    if v.teste_owner_expira_em is not null then
      if v.teste_owner_expira_em<>timestamptz '2026-10-17T18:00:00Z'
        or not public.teste_proposta_whatsapp_valido(v.lead_id,v.tipo,v.proposta_enviado_em,
          v.proposta_pdf_url,v.destinatario,v_agora) then v_recusa:='teste_owner_expirado'; end if;
    elsif p_historico_completo is not true or p_historico_verificado_em is null
      or not isfinite(p_historico_verificado_em)
      or p_historico_verificado_em<=timestamptz '1970-01-01T00:00:00Z'
      or p_historico_cobertura_inicio_em is null
      or not isfinite(p_historico_cobertura_inicio_em)
      or p_historico_cobertura_inicio_em<=timestamptz '1970-01-01T00:00:00Z'
      or p_historico_cobertura_inicio_em>p_historico_verificado_em
      or p_historico_verificado_em<v_agora-interval '30 seconds'
      or p_historico_verificado_em>v_agora+interval '5 seconds'
      or p_historico_cobertura_inicio_em>v_agora-v_janela
      or (p_ultima_interacao_em is not null and (not isfinite(p_ultima_interacao_em)
        or p_ultima_interacao_em<=timestamptz '1970-01-01T00:00:00Z'
        or p_ultima_interacao_em>p_historico_verificado_em)) then
      v_recusa:='inactivity_unverified';
    elsif p_ultima_interacao_em>v_agora-v_janela then v_recusa:='inactivity_recent'; end if;
    if v_recusa is not null then
      update public.whatsapp_outbox set estado=case when iniciado_em is not null then 'indeterminado' else 'cancelado' end,
        ultimo_codigo=v_recusa where id=p_id;
      return null;
    end if;
    update public.whatsapp_outbox set estado='enviando',iniciado_em=coalesce(iniciado_em,v_agora),
      lease_ate=coalesce(iniciado_em,v_agora)+interval '240 seconds',
      historico_verificado_em=case when v.teste_owner_expira_em is null then p_historico_verificado_em else null end,
      historico_cobertura_inicio_em=case when v.teste_owner_expira_em is null then p_historico_cobertura_inicio_em else null end,
      ultima_interacao_em=case when v.teste_owner_expira_em is null then p_ultima_interacao_em else null end where id=p_id;
    return 'enviando';
  end if;
  if p_outcome='sent' and v.estado in ('enviando','indeterminado','enviado') then
    v_enviado:=coalesce(v.enviado_em,v_agora);
    update public.whatsapp_outbox set estado='enviado',enviado_em=v_enviado,ultimo_codigo=null where id=p_id;
    if v.tipo='lembrete_proposta_7d' then
      update public.leads set lembrete_7_em=v_enviado where id=v.lead_id and enviado_em=v.proposta_enviado_em
        and lembrete_7_em is distinct from v_enviado;
    else
      update public.leads set lembrete_30_em=v_enviado where id=v.lead_id and enviado_em=v.proposta_enviado_em
        and lembrete_30_em is distinct from v_enviado;
    end if;
    return 'enviado';
  end if;
  if p_outcome in ('failed','indeterminate') and v.estado in ('enviando','indeterminado') then
    update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo=coalesce(p_code,'resultado_indeterminado') where id=p_id;
    return 'indeterminado';
  end if;
  if p_outcome='failed' and v.estado='reservado' then
    if p_code in ('inactivity_recent','inactivity_unverified','historico_em_sincronizacao',
      'historico_incompleto','historico_indisponivel','identidade_nao_confirmada') then
      -- Evidencia parcial serve somente para explicar o bloqueio. Nunca autoriza started.
      -- Nao preservar datas de outra verificacao se a prova atual esta ausente/invalida.
      v_janela:=case when v.tipo='lembrete_proposta_7d' then interval '5 days' else interval '15 days' end;
      v_diagnostico_valido:=coalesce(p_code='historico_incompleto' and p_historico_completo is false
        and p_historico_verificado_em is not null and isfinite(p_historico_verificado_em)
        and p_historico_verificado_em>timestamptz '1970-01-01T00:00:00Z'
        and p_historico_verificado_em>=v_agora-interval '30 seconds'
        and p_historico_verificado_em<=v_agora+interval '5 seconds'
        and p_historico_cobertura_inicio_em is not null and isfinite(p_historico_cobertura_inicio_em)
        and p_historico_cobertura_inicio_em>timestamptz '1970-01-01T00:00:00Z'
        and p_historico_cobertura_inicio_em<=p_historico_verificado_em
        and p_historico_cobertura_inicio_em>v_agora-v_janela
        and (p_ultima_interacao_em is null or (isfinite(p_ultima_interacao_em)
          and p_ultima_interacao_em>timestamptz '1970-01-01T00:00:00Z'
          and p_ultima_interacao_em<=p_historico_verificado_em)),false);
      update public.whatsapp_outbox set estado='cancelado',ultimo_codigo=p_code,
        historico_verificado_em=case when v_diagnostico_valido then p_historico_verificado_em else null end,
        historico_cobertura_inicio_em=case when v_diagnostico_valido then p_historico_cobertura_inicio_em else null end,
        ultima_interacao_em=case when v_diagnostico_valido then p_ultima_interacao_em else null end
        where id=p_id;
      return 'cancelado';
    end if;
    update public.whatsapp_outbox set estado=case when expira_em<=v_agora or tentativas>=5 then 'expirado' else 'pendente' end,
      lease_token=null,lease_ate=null,proxima_tentativa_em=v_agora+interval '5 minutes',ultimo_codigo=coalesce(p_code,'falha_antes_envio'),
      historico_verificado_em=null,historico_cobertura_inicio_em=null,ultima_interacao_em=null where id=p_id;
    return case when v.expira_em<=v_agora or v.tentativas>=5 then 'expirado' else 'pendente' end;
  end if;
  return null;
end;
$$;
revoke execute on function public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean)
  from anon, authenticated, public;
grant execute on function public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean) to service_role;

commit;
