-- Finalize o formulario: seis horas desde a ultima resposta salva.
-- Aplicar DEPOIS de whatsapp-testes-owner.sql e whatsapp-proposta-inicial.sql. Nao habilita flags.
-- O identificador historico lembrete_formulario_24h permanece opaco.
-- Somente o protocolo 5/RPC V6 pode iniciar esta sequencia.
begin;

-- Fast default conservador para leads anteriores: instante de instalacao.
-- Sem UPDATE em massa: preserva updated_at e demais triggers/metadados existentes.
-- O corte de ativacao exclui todos esses leads anteriores dos envios novos.
alter table public.leads add column if not exists formulario_ultima_atividade_em timestamptz not null default now();

create or replace function public.registrar_atividade_formulario()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  if tg_op='INSERT' then
    new.formulario_ultima_atividade_em:=clock_timestamp();
  elsif new.status::text='incompleto' and (new.categoria is distinct from old.categoria
    or new.respostas is distinct from old.respostas or new.passo_atual is distinct from old.passo_atual) then
    new.formulario_ultima_atividade_em:=greatest(old.formulario_ultima_atividade_em,clock_timestamp());
  else
    -- Campo controlado pelo servidor: metadados e timestamp recebido nao mudam o prazo.
    new.formulario_ultima_atividade_em:=old.formulario_ultima_atividade_em;
  end if;
  return new;
end;
$$;
drop trigger if exists leads_registrar_atividade_formulario on public.leads;
create trigger leads_registrar_atividade_formulario before insert or update on public.leads
  for each row execute function public.registrar_atividade_formulario();

create or replace function public.horario_lembrete_formulario_permitido(p_agora timestamptz)
returns boolean language sql immutable security invoker set search_path=pg_catalog
as $$
  select coalesce(isfinite(p_agora) and (p_agora at time zone 'America/Sao_Paulo')::time>=time '08:00'
    and (p_agora at time zone 'America/Sao_Paulo')::time<time '21:00',false);
$$;

-- Converte apenas o vencimento que cai em nao perturbe. 08h e permitido, 21h e bloqueado.
create or replace function public.proximo_horario_lembrete_formulario(p_agora timestamptz)
returns timestamptz language sql immutable security invoker set search_path=pg_catalog
as $$
  select case when p_agora is null or not isfinite(p_agora) then null
    when (p_agora at time zone 'America/Sao_Paulo')::time>=time '21:00'
      then (((p_agora at time zone 'America/Sao_Paulo')::date+1)+time '09:00') at time zone 'America/Sao_Paulo'
    when (p_agora at time zone 'America/Sao_Paulo')::time<time '08:00'
      then (((p_agora at time zone 'America/Sao_Paulo')::date)+time '09:00') at time zone 'America/Sao_Paulo'
    else p_agora end;
$$;
create or replace function public.prazo_lembrete_formulario(p_ultima_atividade_em timestamptz)
returns timestamptz language sql immutable security invoker set search_path=pg_catalog
as $$ select public.proximo_horario_lembrete_formulario(p_ultima_atividade_em+interval '6 hours'); $$;

-- Rollback nunca volta a produzir nem iniciar o lembrete de 24 horas.
create or replace function public.enfileirar_lembretes_formulario_whatsapp_v3(
  p_inicio_em timestamptz,p_mensagens jsonb,p_app_url text
)
returns integer language sql security invoker set search_path=pg_catalog
as $$ select 0; $$;
create or replace function public.reivindicar_whatsapp_v3(p_lembrete_ativo boolean,p_inicio_em timestamptz)
returns setof public.whatsapp_outbox language sql security invoker set search_path=pg_catalog
as $$ select o.* from public.whatsapp_outbox o where false; $$;

-- V3 mantem apenas resultados finais historicos; nenhum STARTED legado e aceito.
create or replace function public.resultado_whatsapp_v3(
  p_id uuid,p_lease_token uuid,p_outcome text,p_code text,p_lembrete_ativo boolean,p_inicio_em timestamptz
)
returns text language plpgsql security invoker set search_path=pg_catalog
as $$
declare v public.whatsapp_outbox%rowtype; v_agora timestamptz:=statement_timestamp();
begin
  if p_outcome='started' then return null; end if;
  select o.* into v from public.whatsapp_outbox o where o.id=p_id and o.lease_token=p_lease_token for update;
  if not found then return null; end if;
  -- Resultados finais continuam validos sem flags, mesmo apos TTL ou rollback.
  if p_outcome = 'sent' and v.estado in ('enviando', 'indeterminado', 'enviado') then
    update public.whatsapp_outbox set estado = 'enviado',
      enviado_em = coalesce(enviado_em, v_agora), ultimo_codigo = null where id = p_id;
    return 'enviado';
  end if;
  if p_outcome in ('indeterminate', 'failed') and v.estado in ('enviando', 'indeterminado') then
    update public.whatsapp_outbox set estado = 'indeterminado',
      ultimo_codigo = coalesce(p_code, 'resultado_indeterminado') where id = p_id;
    return 'indeterminado';
  end if;
  if p_outcome = 'failed' and v.estado = 'reservado' then
    update public.whatsapp_outbox set
      estado = case when expira_em <= v_agora or tentativas >= 5 then 'expirado' else 'pendente' end,
      lease_token = null, lease_ate = null,
      proxima_tentativa_em = v_agora + interval '5 minutes',
      ultimo_codigo = coalesce(p_code, 'falha_antes_envio') where id = p_id;
    return case when v.expira_em <= v_agora or v.tentativas >= 5 then 'expirado' else 'pendente' end;
  end if;
  return null;
end;
$$;
revoke execute on function public.resultado_whatsapp_v3(uuid, uuid, text, text, boolean, timestamptz)
  from anon, authenticated, public;
grant execute on function public.resultado_whatsapp_v3(uuid, uuid, text, text, boolean, timestamptz) to service_role;


-- V4 preserva os lembretes manuais e nao toca na fila de formulario.
create or replace function public.reivindicar_whatsapp_v4(
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean
)
returns setof public.whatsapp_outbox language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp(); v_leads uuid[];
begin
  select coalesce(array_agg(p.id),array[]::uuid[]) into v_leads from (
    select l.id from public.leads l where exists(select 1 from public.whatsapp_outbox o
      where o.lead_id=l.id and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
        and o.estado in ('pendente','reservado','enviando'))
    order by l.id for update of l skip locked) p;
  update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio'
    where tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and lead_id=any(v_leads) and estado='enviando' and lease_ate<=v_agora;
  update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,ultimo_codigo='lease_expirado_antes_envio'
    where tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and lead_id=any(v_leads) and estado='reservado' and lease_ate<=v_agora;
  -- Um job marcado para teste nunca perde silenciosamente a validade temporaria.
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='teste_owner_expirado'
    where o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.teste_owner_expira_em is not null
      and (o.teste_owner_expira_em<>timestamptz '2026-10-17T18:00:00Z'
        or not public.teste_proposta_whatsapp_valido(o.lead_id,o.tipo,o.proposta_enviado_em,
          o.proposta_pdf_url,o.destinatario,v_agora));
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='proposta_condicao_alterada'
    where o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
      and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is not null;
  update public.whatsapp_outbox set estado='expirado',lease_token=null,lease_ate=null,
    ultimo_codigo=case when tentativas>=5 then 'limite_tentativas' else 'prazo_expirado' end
    where tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and lead_id=any(v_leads) and estado in ('pendente','reservado')
      and (expira_em<=v_agora or (estado='pendente' and tentativas>=5));
  return query with candidato as (
    select o.id from public.whatsapp_outbox o join public.leads l on l.id=o.lead_id
    where l.id=any(v_leads) and o.estado='pendente' and o.expira_em>v_agora
      and o.proxima_tentativa_em<=v_agora and o.tentativas<5
      and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and p_propostas_ativo is true
      and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is null
    order by o.ocorrido_em,o.id limit 1 for update of o skip locked
  ) update public.whatsapp_outbox o set estado='reservado',lease_token=gen_random_uuid(),
    lease_ate=v_agora+interval '90 seconds',tentativas=o.tentativas+1,proxima_tentativa_em=v_agora+interval '5 minutes'
    from candidato c where o.id=c.id returning o.*;
end;
$$;
revoke execute on function public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean) from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean) to service_role;


create or replace function public.enfileirar_lembretes_formulario_whatsapp_v6(
  p_inicio_em timestamptz,p_mensagens jsonb,p_app_url text
)
returns integer language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp();
  v_base text:=regexp_replace(p_app_url,'/+$','');
  v_link text:=v_base||'/continuar/00000000-0000-4000-8000-000000000000';
  v_texto text:=(p_mensagens#>>'{0,message}')||E'\n\n'||(p_mensagens#>>'{1,message}')||E'\n\n'||(p_mensagens#>>'{2,message}')||E'\n\n';
  v_quantidade integer;
begin
  if p_inicio_em is null or not isfinite(p_inicio_em) or p_inicio_em>v_agora
    or p_app_url is null or p_app_url!~'^https://[^[:space:]/?#@]+/*$'
    or not public.sequencia_lembrete_formulario_valida(p_mensagens||jsonb_build_array(
      jsonb_build_object('message',v_link,'delayBeforeSeconds',2)),
      '00000000-0000-4000-8000-000000000000',v_texto||v_link) then return 0; end if;
  -- Pode registrar enquanto aguarda 09h, mas nunca cria fila antes das seis horas.
  with candidatos as materialized(
    select l.id,public.destinatario_whatsapp_br(l.whatsapp) as destinatario,
      public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em) as prazo
      from public.leads l
      where l.status::text='incompleto' and l.created_at>=p_inicio_em
        and l.formulario_ultima_atividade_em<=v_agora-interval '6 hours'
        and isfinite(l.formulario_ultima_atividade_em)
        and public.destinatario_whatsapp_br(l.whatsapp) is not null
        and not exists(select 1 from public.whatsapp_outbox o
          where o.lead_id=l.id and o.tipo='lembrete_formulario_24h')
      order by l.formulario_ultima_atividade_em,l.id limit 50 for update of l skip locked
  )
  insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,proxima_tentativa_em)
    select c.id,'lembrete_formulario_24h',v_agora,v_agora+interval '24 hours',c.destinatario,
      v_texto||v_base||'/continuar/'||c.id::text,
      p_mensagens||jsonb_build_array(jsonb_build_object('message',v_base||'/continuar/'||c.id::text,'delayBeforeSeconds',2)),
      greatest(c.prazo,public.proximo_horario_lembrete_formulario(v_agora))
    from candidatos c on conflict(lead_id,tipo) where tipo in('confirmacao_recebimento','lembrete_formulario_24h') do nothing;
  get diagnostics v_quantidade=row_count;
  return v_quantidade;
end;
$$;

create or replace function public.reivindicar_whatsapp_v6(
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,p_inicial_ativo boolean
)
returns setof public.whatsapp_outbox language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp(); v_anterior public.whatsapp_outbox%rowtype;
  v_leads uuid[]; v_id uuid;
begin
  -- A regra noturna vale para o lembrete de formulario; demais tipos mantem V5.
  select * into v_anterior from public.reivindicar_whatsapp_v5(false,null,p_propostas_ativo,p_inicial_ativo);
  if found then return next v_anterior; return; end if;
  if p_formulario_ativo is not true or p_inicio_em is null or not isfinite(p_inicio_em)
    or p_inicio_em>v_agora then return; end if;
  select coalesce(array_agg(p.id),array[]::uuid[]) into v_leads from(
    select l.id from public.leads l where exists(select 1 from public.whatsapp_outbox o
      where o.lead_id=l.id and o.tipo='lembrete_formulario_24h' and o.estado in('pendente','reservado','enviando'))
      order by l.id for update of l skip locked)p;
  update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio'
    where lead_id=any(v_leads) and tipo='lembrete_formulario_24h' and estado='enviando' and lease_ate<=v_agora;
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='lead_ou_contato_alterado'
    from public.leads l where l.id=o.lead_id and l.id=any(v_leads) and o.tipo='lembrete_formulario_24h'
      and o.estado in('pendente','reservado') and (l.status::text<>'incompleto' or l.created_at<p_inicio_em
        or not isfinite(l.formulario_ultima_atividade_em)
        or o.destinatario is distinct from public.destinatario_whatsapp_br(l.whatsapp)
        or not public.sequencia_lembrete_formulario_valida(o.sequencia,o.lead_id,o.mensagem));
  -- Nova resposta ou nao perturbe antes do envio apenas adia. Nao gasta tentativas,
  -- nem deixa o TTL antigo vencer enquanto o prazo de seis horas estiver correndo.
  update public.whatsapp_outbox o set estado='pendente',lease_token=null,lease_ate=null,
    tentativas=greatest(0,o.tentativas-case when o.estado='reservado' then 1 else 0 end),
    proxima_tentativa_em=greatest(o.proxima_tentativa_em,
      public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em),public.proximo_horario_lembrete_formulario(v_agora)),
    ocorrido_em=v_agora,expira_em=v_agora+interval '24 hours',ultimo_codigo='formulario_aguardando_horario'
    from public.leads l where l.id=o.lead_id and l.id=any(v_leads) and o.tipo='lembrete_formulario_24h'
      and o.estado in('pendente','reservado') and o.iniciado_em is null
      and (public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em)>v_agora
        or not public.horario_lembrete_formulario_permitido(v_agora));
  update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,ultimo_codigo='lease_expirado_antes_envio'
    where lead_id=any(v_leads) and tipo='lembrete_formulario_24h' and estado='reservado' and lease_ate<=v_agora;
  update public.whatsapp_outbox set estado='expirado',lease_token=null,lease_ate=null,
    ultimo_codigo=case when tentativas>=5 then 'limite_tentativas' else 'prazo_expirado' end
    where lead_id=any(v_leads) and tipo='lembrete_formulario_24h' and estado in('pendente','reservado')
      and (expira_em<=v_agora or (estado='pendente' and tentativas>=5));
  if not public.horario_lembrete_formulario_permitido(v_agora) then return; end if;
  select o.id into v_id from public.whatsapp_outbox o join public.leads l on l.id=o.lead_id
    where l.id=any(v_leads) and o.tipo='lembrete_formulario_24h' and o.estado='pendente'
      and o.iniciado_em is null and o.expira_em>v_agora and o.proxima_tentativa_em<=v_agora and o.tentativas<5
      and l.status::text='incompleto' and l.created_at>=p_inicio_em
      and public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em)<=v_agora
      and o.destinatario=public.destinatario_whatsapp_br(l.whatsapp)
      and public.sequencia_lembrete_formulario_valida(o.sequencia,o.lead_id,o.mensagem)
    order by o.ocorrido_em,o.id limit 1 for update of o skip locked;
  if found then
    return query update public.whatsapp_outbox set estado='reservado',lease_token=gen_random_uuid(),
      lease_ate=v_agora+interval '90 seconds',tentativas=tentativas+1,
      proxima_tentativa_em=v_agora+interval '5 minutes' where id=v_id returning *;
  end if;
end;
$$;

create or replace function public.resultado_whatsapp_v6(
  p_id uuid,p_lease_token uuid,p_outcome text,p_code text,
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,p_inicial_ativo boolean,
  p_historico_verificado_em timestamptz,p_historico_cobertura_inicio_em timestamptz,
  p_ultima_interacao_em timestamptz,p_historico_completo boolean
)
returns text language plpgsql security invoker set search_path=pg_catalog
as $$
declare
  v public.whatsapp_outbox%rowtype; l public.leads%rowtype;
  v_lead uuid; v_tipo text; v_agora timestamptz:=statement_timestamp(); v_prazo timestamptz; v_recusa text;
begin
  select lead_id,tipo into v_lead,v_tipo from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token;
  if not found then return null; end if;
  if v_tipo<>'lembrete_formulario_24h' then
    return public.resultado_whatsapp_v5(p_id,p_lease_token,p_outcome,p_code,false,null,
      p_propostas_ativo,p_inicial_ativo,p_historico_verificado_em,p_historico_cobertura_inicio_em,
      p_ultima_interacao_em,p_historico_completo);
  end if;
  -- O worker tambem pode perceber o nao perturbe ANTES de pedir STARTED.
  -- Persistir09h aqui evita reabrir o envio08h30 apos uma noite sem worker.
  if p_outcome='failed' and p_code='formulario_nao_perturbe' then
    select * into l from public.leads where id=v_lead for update;
    if not found then return null; end if;
    select * into v from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token for update;
    if not found then return null; end if;
    if v.estado='reservado' and v.iniciado_em is null then
      update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,
        tentativas=greatest(0,tentativas-1),
        proxima_tentativa_em=greatest(public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em),
          public.proximo_horario_lembrete_formulario(v_agora)),
        ocorrido_em=v_agora,expira_em=v_agora+interval '24 hours',ultimo_codigo='formulario_aguardando_horario' where id=p_id;
      return 'pendente';
    end if;
  end if;
  -- Resultados terminais preservam a reconciliacao historica/ACK mesmo sem flags.
  if p_outcome<>'started' then
    return public.resultado_whatsapp_v3(p_id,p_lease_token,p_outcome,p_code,false,null);
  end if;
  select * into l from public.leads where id=v_lead for update;
  if not found then return null; end if;
  select * into v from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token for update;
  if not found or v.estado not in('reservado','enviando') then return null; end if;
  if p_formulario_ativo is not true or p_inicio_em is null or not isfinite(p_inicio_em) or p_inicio_em>v_agora then
    v_recusa:='formulario_desativado';
  elsif l.status::text<>'incompleto' or l.created_at<p_inicio_em
    or v.destinatario is distinct from public.destinatario_whatsapp_br(l.whatsapp)
    or not public.sequencia_lembrete_formulario_valida(v.sequencia,v.lead_id,v.mensagem)
    or not isfinite(l.formulario_ultima_atividade_em) then
    v_recusa:='lead_ou_contato_alterado';
  elsif v.lease_ate<=v_agora then v_recusa:='lease_expirado_antes_envio'; end if;
  v_prazo:=greatest(public.prazo_lembrete_formulario(l.formulario_ultima_atividade_em),
    public.proximo_horario_lembrete_formulario(v_agora));
  if v_recusa is null and (v_prazo>v_agora or not public.horario_lembrete_formulario_permitido(v_agora)) then
    if v.iniciado_em is not null then
      update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='formulario_horario_ou_atividade_alterado' where id=p_id;
    else
      update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,
        tentativas=greatest(0,tentativas-1),proxima_tentativa_em=v_prazo,
        ocorrido_em=v_agora,expira_em=v_agora+interval '24 hours',ultimo_codigo='formulario_aguardando_horario' where id=p_id;
    end if;
    return null;
  end if;
  if v_recusa is null and v.expira_em<=v_agora then v_recusa:='prazo_expirado'; end if;
  if v_recusa is not null then
    update public.whatsapp_outbox set estado=case when iniciado_em is not null then 'indeterminado' else 'cancelado' end,
      ultimo_codigo=v_recusa where id=p_id;
    return null;
  end if;
  -- proxima_tentativa_em e o cooldown da reserva; o prazo real foi revalidado acima.
  update public.whatsapp_outbox set estado='enviando',iniciado_em=coalesce(iniciado_em,v_agora),
    lease_ate=coalesce(iniciado_em,v_agora)+interval '180 seconds' where id=p_id;
  return 'enviando';
end;
$$;

revoke execute on function public.registrar_atividade_formulario(),
  public.horario_lembrete_formulario_permitido(timestamptz),public.proximo_horario_lembrete_formulario(timestamptz),
  public.prazo_lembrete_formulario(timestamptz),
  public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz,jsonb,text),
  public.reivindicar_whatsapp_v3(boolean,timestamptz),
  public.enfileirar_lembretes_formulario_whatsapp_v6(timestamptz,jsonb,text),
  public.reivindicar_whatsapp_v6(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v6(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  from public,anon,authenticated;
grant execute on function public.registrar_atividade_formulario(),
  public.horario_lembrete_formulario_permitido(timestamptz),public.proximo_horario_lembrete_formulario(timestamptz),
  public.prazo_lembrete_formulario(timestamptz),
  public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz,jsonb,text),
  public.reivindicar_whatsapp_v3(boolean,timestamptz),
  public.enfileirar_lembretes_formulario_whatsapp_v6(timestamptz,jsonb,text),
  public.reivindicar_whatsapp_v6(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v6(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  to service_role;
commit;
