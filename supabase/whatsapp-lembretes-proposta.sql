-- Lembretes da proposta SOMENTE por clique autenticado da Mel.
-- Aplicar manualmente depois de whatsapp-lembrete-copy.sql. Nao ativa flags,
-- nao consulta conversas, nao envia mensagens e nao enfileira por cron/lote.
begin;
lock table public.whatsapp_outbox in share row exclusive mode;

alter table public.whatsapp_outbox add column if not exists proposta_enviado_em timestamptz;
alter table public.whatsapp_outbox add column if not exists proposta_pdf_url text;
alter table public.whatsapp_outbox add column if not exists solicitado_em timestamptz;
alter table public.whatsapp_outbox add column if not exists solicitado_por uuid;
alter table public.whatsapp_outbox add column if not exists historico_verificado_em timestamptz;
alter table public.whatsapp_outbox add column if not exists historico_cobertura_inicio_em timestamptz;
alter table public.whatsapp_outbox add column if not exists ultima_interacao_em timestamptz;

alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_tipo_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_tipo_check check (tipo in (
  'confirmacao_recebimento','lembrete_formulario_24h','lembrete_proposta_7d','lembrete_proposta_30d'));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_somente_lembrete_ativo;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_somente_lembrete_ativo check (
  tipo in ('lembrete_formulario_24h','lembrete_proposta_7d','lembrete_proposta_30d')
  or estado not in ('pendente','reservado','enviando'));

-- Quatro/cinco partes fechadas; o link e o snapshot HTTPS da proposta atual.
create or replace function public.sequencia_lembrete_proposta(
  p_tipo text, p_pdf_url text
)
returns jsonb language sql immutable security invoker set search_path = pg_catalog
as $$
  select case when p_pdf_url ~ '^https://[^[:space:]/?#@]+(/[^[:space:]?#@]*)?$'
    and strpos(p_pdf_url,chr(92))=0 then
    case p_tipo
      when 'lembrete_proposta_7d' then jsonb_build_array(
        jsonb_build_object('message','Olá, como vai?!','delayBeforeSeconds',0),
        jsonb_build_object('message','Passando só para saber se você conseguiu dar uma olhadinha na proposta que te enviei.','delayBeforeSeconds',2),
        jsonb_build_object('message',p_pdf_url,'delayBeforeSeconds',3),
        jsonb_build_object('message','Se ficou alguma dúvida, me chama que eu te explico. ✨','delayBeforeSeconds',2))
      when 'lembrete_proposta_30d' then jsonb_build_array(
        jsonb_build_object('message','Oi! Passando só para saber se você conseguiu dar uma olhadinha na proposta que te enviei. 🤍','delayBeforeSeconds',0),
        jsonb_build_object('message',p_pdf_url,'delayBeforeSeconds',4),
        jsonb_build_object('message','Se ainda fizer sentido, é só me chamar que a gente conversa.','delayBeforeSeconds',4),
        jsonb_build_object('message','Se não for o momento, me avise por gentileza, para que eu possa me organizar por aqui 🙏','delayBeforeSeconds',3),
        jsonb_build_object('message','Desde já, agradeço ✨','delayBeforeSeconds',5))
    end
  end;
$$;
revoke execute on function public.sequencia_lembrete_proposta(text,text) from anon, authenticated, public;
grant execute on function public.sequencia_lembrete_proposta(text,text) to service_role;

create or replace function public.sequencia_lembrete_proposta_valida(
  p_sequencia jsonb, p_tipo text, p_pdf_url text, p_mensagem text
)
returns boolean language sql immutable security invoker set search_path = pg_catalog
as $$
  select coalesce(p_sequencia=public.sequencia_lembrete_proposta(p_tipo,p_pdf_url)
    and p_mensagem=(select string_agg(p.value->>'message',E'\n\n' order by p.n)
      from jsonb_array_elements(public.sequencia_lembrete_proposta(p_tipo,p_pdf_url)) with ordinality p(value,n))
    and length(p_mensagem) between 1 and 2000,false);
$$;
revoke execute on function public.sequencia_lembrete_proposta_valida(jsonb,text,text,text) from anon, authenticated, public;
grant execute on function public.sequencia_lembrete_proposta_valida(jsonb,text,text,text) to service_role;

alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_proposta_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_proposta_check check (
  (tipo not in ('lembrete_proposta_7d','lembrete_proposta_30d')
    and proposta_enviado_em is null and proposta_pdf_url is null
    and solicitado_em is null and solicitado_por is null)
  or (tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
    and proposta_enviado_em is not null and isfinite(proposta_enviado_em)
    and proposta_enviado_em<=ocorrido_em and proposta_pdf_url is not null
    and solicitado_em is not null and solicitado_em=ocorrido_em and solicitado_por is not null
    and public.sequencia_lembrete_proposta_valida(sequencia,tipo,proposta_pdf_url,mensagem)));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_sequencia_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_sequencia_check check (
  (tipo='confirmacao_recebimento' and sequencia is null)
  or (tipo='lembrete_formulario_24h' and (estado not in ('pendente','reservado','enviando')
    or public.sequencia_lembrete_formulario_valida(sequencia,lead_id,mensagem)))
  or (tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
    and public.sequencia_lembrete_proposta_valida(sequencia,tipo,proposta_pdf_url,mensagem)));

-- Historicos de varias revisoes coexistem; formulario continua unico por lead.
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_lead_id_tipo_key;
create unique index if not exists whatsapp_outbox_formulario_unico_idx
  on public.whatsapp_outbox(lead_id,tipo)
  where tipo in ('confirmacao_recebimento','lembrete_formulario_24h');
create unique index if not exists whatsapp_outbox_proposta_unica_idx
  on public.whatsapp_outbox(lead_id,tipo,proposta_enviado_em)
  where tipo in ('lembrete_proposta_7d','lembrete_proposta_30d');

-- Retorna codigo, nao dados pessoais. Executada com o lead ja travado pelo chamador.
create or replace function public.recusa_lembrete_proposta_whatsapp(
  p_lead_id uuid, p_tipo text, p_proposta_enviado_em timestamptz,
  p_pdf_url text, p_destinatario text, p_agora timestamptz
)
returns text language plpgsql stable security invoker set search_path = pg_catalog
as $$
declare v_lead public.leads%rowtype; v_sete timestamptz;
begin
  select * into v_lead from public.leads where id=p_lead_id;
  if not found then return 'lead_nao_encontrado'; end if;
  if v_lead.status::text not in ('enviado','esfriou') then return 'coluna_invalida'; end if;
  if p_proposta_enviado_em is null or v_lead.enviado_em is distinct from p_proposta_enviado_em
    then return 'proposta_alterada'; end if;
  if public.sequencia_lembrete_proposta(p_tipo,v_lead.pdf_url) is null then return 'proposta_ausente'; end if;
  if v_lead.pdf_url is distinct from p_pdf_url then return 'proposta_alterada'; end if;
  if public.destinatario_whatsapp_br(v_lead.whatsapp) is null then return 'telefone_invalido'; end if;
  if public.destinatario_whatsapp_br(v_lead.whatsapp) is distinct from p_destinatario then return 'proposta_alterada'; end if;
  if p_agora<p_proposta_enviado_em+(case when p_tipo='lembrete_proposta_7d'
    then interval '7 days' else interval '30 days' end) then return 'prazo_nao_atingido'; end if;
  if p_tipo='lembrete_proposta_30d' then
    select o.enviado_em into v_sete from public.whatsapp_outbox o
      where o.lead_id=p_lead_id and o.tipo='lembrete_proposta_7d'
        and o.proposta_enviado_em=p_proposta_enviado_em and o.proposta_pdf_url=p_pdf_url
        and o.destinatario=p_destinatario and o.estado='enviado'
        and o.iniciado_em is not null and o.enviado_em is not null
        and public.sequencia_lembrete_proposta_valida(o.sequencia,o.tipo,o.proposta_pdf_url,o.mensagem);
    if not found then return 'lembrete_7_nao_enviado'; end if;
    if v_sete>p_agora-interval '15 days' then return 'lembrete_7_recente'; end if;
  end if;
  return null;
end;
$$;
revoke execute on function public.recusa_lembrete_proposta_whatsapp(uuid,text,timestamptz,text,text,timestamptz)
  from anon, authenticated, public;
grant execute on function public.recusa_lembrete_proposta_whatsapp(uuid,text,timestamptz,text,text,timestamptz) to service_role;

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
      ('inactivity_recent','inactivity_unverified','proposta_condicao_alterada') then
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

create or replace function public.reivindicar_whatsapp_v4(
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean
)
returns setof public.whatsapp_outbox language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp(); v_leads uuid[];
  v_formulario boolean:=p_formulario_ativo is true and p_inicio_em is not null
    and isfinite(p_inicio_em) and p_inicio_em<=statement_timestamp();
begin
  select coalesce(array_agg(p.id),array[]::uuid[]) into v_leads from (
    select l.id from public.leads l where exists(select 1 from public.whatsapp_outbox o
      where o.lead_id=l.id and o.estado in ('pendente','reservado','enviando'))
    order by l.id for update of l skip locked) p;
  update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio'
    where lead_id=any(v_leads) and estado='enviando' and lease_ate<=v_agora;
  update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,ultimo_codigo='lease_expirado_antes_envio'
    where lead_id=any(v_leads) and estado='reservado' and lease_ate<=v_agora;
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='proposta_condicao_alterada'
    where o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
      and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is not null;
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='lead_ou_contato_alterado'
    from public.leads l where o.lead_id=l.id and l.id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.tipo='lembrete_formulario_24h' and (l.status::text<>'incompleto'
        or o.destinatario is distinct from public.destinatario_whatsapp_br(l.whatsapp));
  update public.whatsapp_outbox set estado='expirado',lease_token=null,lease_ate=null,
    ultimo_codigo=case when tentativas>=5 then 'limite_tentativas' else 'prazo_expirado' end
    where lead_id=any(v_leads) and estado in ('pendente','reservado')
      and (expira_em<=v_agora or (estado='pendente' and tentativas>=5));
  return query with candidato as (
    select o.id from public.whatsapp_outbox o join public.leads l on l.id=o.lead_id
    where l.id=any(v_leads) and o.estado='pendente' and o.expira_em>v_agora
      and o.proxima_tentativa_em<=v_agora and o.tentativas<5
      and ((o.tipo='lembrete_formulario_24h' and v_formulario
        and public.sequencia_lembrete_formulario_valida(o.sequencia,o.lead_id,o.mensagem)
        and l.created_at>=p_inicio_em and l.created_at<v_agora-interval '24 hours')
      or (o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and p_propostas_ativo is true
        and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is null))
    order by o.ocorrido_em,o.id limit 1 for update of o skip locked
  ) update public.whatsapp_outbox o set estado='reservado',lease_token=gen_random_uuid(),
    lease_ate=v_agora+interval '90 seconds',tentativas=o.tentativas+1,proxima_tentativa_em=v_agora+interval '5 minutes'
    from candidato c where o.id=c.id returning o.*;
end;
$$;
revoke execute on function public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean) from anon, authenticated, public;
grant execute on function public.reivindicar_whatsapp_v4(boolean,timestamptz,boolean) to service_role;

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
  v_janela interval; v_recusa text; v_enviado timestamptz;
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
    if p_historico_completo is not true or p_historico_verificado_em is null
      or not isfinite(p_historico_verificado_em) or p_historico_cobertura_inicio_em is null
      or not isfinite(p_historico_cobertura_inicio_em)
      or p_historico_verificado_em<v_agora-interval '30 seconds'
      or p_historico_verificado_em>v_agora+interval '5 seconds'
      or p_historico_cobertura_inicio_em>v_agora-v_janela
      or (p_ultima_interacao_em is not null and not isfinite(p_ultima_interacao_em)) then
      v_recusa:='inactivity_unverified';
    elsif p_ultima_interacao_em>v_agora-v_janela then v_recusa:='inactivity_recent'; end if;
    if v_recusa is not null then
      update public.whatsapp_outbox set estado=case when iniciado_em is not null then 'indeterminado' else 'cancelado' end,
        ultimo_codigo=v_recusa where id=p_id;
      return null;
    end if;
    update public.whatsapp_outbox set estado='enviando',iniciado_em=coalesce(iniciado_em,v_agora),
      lease_ate=coalesce(iniciado_em,v_agora)+interval '240 seconds',
      historico_verificado_em=p_historico_verificado_em,historico_cobertura_inicio_em=p_historico_cobertura_inicio_em,
      ultima_interacao_em=p_ultima_interacao_em where id=p_id;
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
    if p_code in ('inactivity_recent','inactivity_unverified') then
      update public.whatsapp_outbox set estado='cancelado',ultimo_codigo=p_code where id=p_id;
      return 'cancelado';
    end if;
    update public.whatsapp_outbox set estado=case when expira_em<=v_agora or tentativas>=5 then 'expirado' else 'pendente' end,
      lease_token=null,lease_ate=null,proxima_tentativa_em=v_agora+interval '5 minutes',ultimo_codigo=coalesce(p_code,'falha_antes_envio') where id=p_id;
    return case when v.expira_em<=v_agora or v.tentativas>=5 then 'expirado' else 'pendente' end;
  end if;
  return null;
end;
$$;
revoke execute on function public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean)
  from anon, authenticated, public;
grant execute on function public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean) to service_role;

-- A revisao do enfileirador de formulario com ON CONFLICT parcial vem abaixo.
create or replace function public.enfileirar_lembretes_formulario_whatsapp_v3(
  p_inicio_em timestamptz, p_mensagens jsonb, p_app_url text
)
returns integer
language plpgsql security invoker
set search_path = pg_catalog
as $$
declare
  v_agora timestamptz := statement_timestamp();
  v_base text := regexp_replace(p_app_url, '/+$', '');
  v_quantidade integer;
  v_link_teste text := v_base || '/continuar/00000000-0000-4000-8000-000000000000';
  v_teste jsonb := p_mensagens || jsonb_build_array(
    jsonb_build_object('message', v_link_teste, 'delayBeforeSeconds', 2));
  v_texto text := (p_mensagens #>> '{0,message}') || E'\n\n'
    || (p_mensagens #>> '{1,message}') || E'\n\n'
    || (p_mensagens #>> '{2,message}') || E'\n\n';
begin
  if p_inicio_em is null or not isfinite(p_inicio_em) or p_inicio_em > v_agora
    or p_app_url is null or p_app_url !~ '^https://[^[:space:]/?#@]+/*$'
    or not public.sequencia_lembrete_formulario_valida(v_teste,
      '00000000-0000-4000-8000-000000000000', v_texto || v_link_teste) then
    return 0;
  end if;

  -- Ordem de locks: lead primeiro, outbox depois, tambem no claim/started.
  -- SKIP LOCKED evita disputar com conclusao/edicao/exclusao em andamento.
  with candidatos as materialized (
    select l.id, public.destinatario_whatsapp_br(l.whatsapp) as destinatario
    from public.leads l
    where l.status::text = 'incompleto' and l.created_at >= p_inicio_em
      and l.created_at < v_agora - interval '24 hours'
      and public.destinatario_whatsapp_br(l.whatsapp) is not null
      and not exists (select 1 from public.whatsapp_outbox o
        where o.lead_id = l.id and o.tipo = 'lembrete_formulario_24h')
    order by l.created_at, l.id limit 50 for update of l skip locked
  )
  insert into public.whatsapp_outbox
    (lead_id, tipo, ocorrido_em, expira_em, destinatario, mensagem, sequencia)
  select c.id, 'lembrete_formulario_24h', v_agora, v_agora + interval '24 hours',
    c.destinatario, v_texto || v_base || '/continuar/' || c.id::text,
    p_mensagens || jsonb_build_array(jsonb_build_object('message',
      v_base || '/continuar/' || c.id::text, 'delayBeforeSeconds', 2))
  from candidatos c
  on conflict (lead_id, tipo) where tipo in ('confirmacao_recebimento', 'lembrete_formulario_24h') do nothing;
  get diagnostics v_quantidade = row_count;
  return v_quantidade;
end;
$$;
revoke execute on function public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz, jsonb, text)
  from anon, authenticated, public;
grant execute on function public.enfileirar_lembretes_formulario_whatsapp_v3(timestamptz, jsonb, text) to service_role;


-- Historico WhatsApp ao vivo no Kanban. Aplicar DEPOIS de quadro-tempo-real.sql
-- e whatsapp-outbox.sql, em transacao. O mesmo bloco encerra schema.sql.
-- Reutiliza a campainha privada e vazia: nenhum dado da outbox/lead vai ao canal,
-- nenhuma policy muda, e uma falha do Broadcast nao desfaz o ACK do WhatsApp.
-- ACK repetido, heartbeat entre partes e simples correcao de carimbo nao avisam.
-- Propostas tambem avisam mudancas de estado para a UI encerrar fila/bloqueios.
drop trigger if exists whatsapp_outbox_avisar_quadro on public.whatsapp_outbox;
create trigger whatsapp_outbox_avisar_quadro
  after update of estado, enviado_em on public.whatsapp_outbox
  for each row
  when ((old.estado is distinct from 'enviado'
    and new.estado = 'enviado' and new.enviado_em is not null)
    or (new.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
      and old.estado is distinct from new.estado))
  execute function public.avisar_quadro();

commit;
