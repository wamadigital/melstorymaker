-- Rodada UNICA de lembretes legados, aprovada pelo owner em 16/10/2026.
-- Instala a capacidade SEM criar lote, ativar fila ou enviar mensagens.
-- A unica excecao e cobertura historica incompleta; identidade e interacao
-- recente continuam sendo verificadas em cada parte pelo bridge/worker.
begin;
lock table public.whatsapp_outbox in share row exclusive mode;

create table if not exists public.whatsapp_lotes_legados (
  id uuid primary key,
  criado_em timestamptz not null default statement_timestamp(),
  expira_em timestamptz not null,
  estado text not null default 'pausado' check(estado in('pausado','ativo','cancelado','concluido')),
  ativado_em timestamptz,
  manifesto_selado boolean not null default false,
  proximo_inicio_em timestamptz,
  constraint whatsapp_lote_prazo_check check(isfinite(criado_em) and isfinite(expira_em)
    and expira_em>criado_em and expira_em<=criado_em+interval '24 hours')
);
create unique index if not exists whatsapp_um_lote_legado_ativo_idx
  on public.whatsapp_lotes_legados((true)) where estado='ativo';
create table if not exists public.whatsapp_lote_legado_itens (
  lote_id uuid not null references public.whatsapp_lotes_legados(id),
  -- Snapshot preservado mesmo se o card for excluido; nao bloqueia o DELETE normal.
  lead_id uuid not null,
  proposta_enviado_em timestamptz not null check(isfinite(proposta_enviado_em)),
  proposta_pdf_url text not null,
  destinatario text not null,
  tipo text not null check(tipo='lembrete_proposta_7d'),
  sequencia jsonb not null,
  mensagem text not null,
  ordem integer not null check(ordem between 1 and 49),
  job_id uuid not null unique,
  estado text not null default 'aguardando' check(estado in('aguardando','reservado','enviado','bloqueado','indeterminado')),
  codigo text,
  intervalo_segundos integer check(intervalo_segundos between 120 and 240),
  primary key(lote_id,lead_id),
  unique(lote_id,ordem),unique(lote_id,destinatario),
  check(public.sequencia_lembrete_proposta_valida(sequencia,tipo,proposta_pdf_url,mensagem))
);
alter table public.whatsapp_lotes_legados enable row level security;
alter table public.whatsapp_lote_legado_itens enable row level security;
revoke all on public.whatsapp_lotes_legados,public.whatsapp_lote_legado_itens from public,anon,authenticated;
grant select,insert,update on public.whatsapp_lotes_legados,public.whatsapp_lote_legado_itens to service_role;
alter table public.whatsapp_outbox add column if not exists lote_legado_id uuid references public.whatsapp_lotes_legados(id);
create index if not exists whatsapp_outbox_lote_legado_idx on public.whatsapp_outbox(lote_legado_id) where lote_legado_id is not null;

-- O manifesto nao muda depois da revisao. Nem o processo privilegiado pode
-- transformar um envio normal em excecao depois de STARTED.
create or replace function public.proteger_manifesto_lote_legado_whatsapp()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if tg_table_name='whatsapp_lote_legado_itens' then
    if tg_op='INSERT' then
      if not exists(select 1 from public.whatsapp_lotes_legados where id=new.lote_id and manifesto_selado is false) then
        raise exception 'manifesto_legado_imutavel'; end if;
      return new;
    end if;
    if tg_op='DELETE' or (new.lote_id,new.lead_id,new.proposta_enviado_em,new.proposta_pdf_url,
      new.destinatario,new.tipo,new.sequencia,new.mensagem,new.ordem,new.job_id) is distinct from
      (old.lote_id,old.lead_id,old.proposta_enviado_em,old.proposta_pdf_url,
      old.destinatario,old.tipo,old.sequencia,old.mensagem,old.ordem,old.job_id) then
      raise exception 'manifesto_legado_imutavel';
    end if;
  elsif tg_table_name='whatsapp_lotes_legados' then
    if tg_op='DELETE' or (old.manifesto_selado is true and new.manifesto_selado is not true)
      or (new.id,new.criado_em,new.expira_em) is distinct from (old.id,old.criado_em,old.expira_em) then
      raise exception 'manifesto_legado_imutavel'; end if;
  else
    if old.lote_legado_id is not null then
      if (new.lead_id,new.tipo,new.proposta_enviado_em,new.proposta_pdf_url,new.destinatario,new.sequencia,new.mensagem)
        is distinct from (old.lead_id,old.tipo,old.proposta_enviado_em,old.proposta_pdf_url,old.destinatario,old.sequencia,old.mensagem) then
        raise exception 'manifesto_legado_imutavel'; end if;
      if new.lote_legado_id is distinct from old.lote_legado_id and not (
        new.lote_legado_id is null and old.estado='cancelado' and new.estado='pendente'
        and old.iniciado_em is null and old.enviado_em is null and new.iniciado_em is null and new.enviado_em is null
        and exists(select 1 from public.whatsapp_lote_legado_itens i where i.lote_id=old.lote_legado_id
          and i.job_id=old.id and i.lead_id=old.lead_id and i.estado='bloqueado')) then
        raise exception 'manifesto_legado_imutavel'; end if;
    end if;
    if old.lote_legado_id is null and new.lote_legado_id is not null
      and (old.iniciado_em is not null or old.enviado_em is not null or old.estado<>'cancelado') then
      raise exception 'tentativa_legada_nao_reutilizavel'; end if;
  end if;
  return new;
end; $$;
drop trigger if exists whatsapp_legado_item_imutavel on public.whatsapp_lote_legado_itens;
create trigger whatsapp_legado_item_imutavel before insert or update or delete on public.whatsapp_lote_legado_itens
  for each row execute function public.proteger_manifesto_lote_legado_whatsapp();
drop trigger if exists whatsapp_legado_lote_imutavel on public.whatsapp_lotes_legados;
create trigger whatsapp_legado_lote_imutavel before update or delete on public.whatsapp_lotes_legados
  for each row execute function public.proteger_manifesto_lote_legado_whatsapp();
drop trigger if exists whatsapp_legado_outbox_imutavel on public.whatsapp_outbox;
create trigger whatsapp_legado_outbox_imutavel before update on public.whatsapp_outbox
  for each row execute function public.proteger_manifesto_lote_legado_whatsapp();

create or replace function public.recusa_item_lote_legado_whatsapp(p_lote uuid,p_lead uuid,p_agora timestamptz)
returns text language plpgsql stable security invoker set search_path=pg_catalog as $$
declare i public.whatsapp_lote_legado_itens%rowtype; l public.leads%rowtype;
begin
  select * into i from public.whatsapp_lote_legado_itens where lote_id=p_lote and lead_id=p_lead;
  if not found then return 'lote_manifesto_ausente'; end if;
  select * into l from public.leads where id=p_lead;
  if not found then return 'lead_nao_encontrado'; end if;
  if l.status::text<>'esfriou' then return 'coluna_invalida'; end if;
  if coalesce(l.nome_display,'')~*'(^|[^[:alpha:]])teste([^[:alpha:]]|$)' then return 'lote_teste_excluido'; end if;
  if l.data_evento is null or l.data_evento<=(p_agora at time zone 'America/Sao_Paulo')::date then return 'lote_evento_nao_futuro'; end if;
  if l.enviado_em is distinct from i.proposta_enviado_em or l.pdf_url is distinct from i.proposta_pdf_url
    or public.destinatario_whatsapp_br(l.whatsapp) is distinct from i.destinatario then return 'proposta_alterada'; end if;
  -- Carimbo manual antigo nao substitui ACK da outbox. A prova real e conferida abaixo.
  if public.recusa_lembrete_proposta_whatsapp(i.lead_id,i.tipo,i.proposta_enviado_em,i.proposta_pdf_url,i.destinatario,p_agora) is not null
    then return 'proposta_condicao_alterada'; end if;
  if exists(select 1 from public.whatsapp_outbox o where (o.lead_id=i.lead_id or o.destinatario=i.destinatario)
    and o.tipo in('lembrete_proposta_7d','lembrete_proposta_30d') and o.id<>i.job_id
    and (o.iniciado_em is not null or o.enviado_em is not null or o.estado in('pendente','reservado','enviando','indeterminado','enviado')))
    then return 'lote_outro_envio_existente'; end if;
  return null;
end; $$;

create or replace function public.criar_lote_legado_whatsapp(p_id uuid,p_itens jsonb,p_expira_em timestamptz)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare a timestamptz:=statement_timestamp(); j jsonb; n integer; i public.whatsapp_lote_legado_itens%rowtype;
  v_recusa text; o public.whatsapp_outbox%rowtype;
begin
  if p_id is null or jsonb_typeof(p_itens) is distinct from 'array' or p_expira_em is null
    or not isfinite(p_expira_em) or p_expira_em<=a or p_expira_em>a+interval '24 hours' then
    return jsonb_build_object('erro','payload_invalido'); end if;
  n:=jsonb_array_length(p_itens);
  if n<1 or n>49 then return jsonb_build_object('erro','payload_invalido'); end if;
  perform pg_advisory_xact_lock(783921401);
  if exists(select 1 from public.whatsapp_lotes_legados where id=p_id) then
    return jsonb_build_object('erro','lote_ja_existe'); end if;
  -- Erro em qualquer item faz rollback de TODO o manifesto, sem efeitos parciais.
  begin
    insert into public.whatsapp_lotes_legados(id,criado_em,expira_em) values(p_id,a,p_expira_em);
    for j in select value from jsonb_array_elements(p_itens) loop
      if jsonb_typeof(j)<>'object' or (select count(*) from jsonb_object_keys(j))<>9
        or not (j ?& array['lead_id','proposta_enviado_em','proposta_pdf_url','destinatario','tipo','sequencia','mensagem','ordem','job_id']) then
        raise exception 'payload_invalido'; end if;
      insert into public.whatsapp_lote_legado_itens(lote_id,lead_id,proposta_enviado_em,proposta_pdf_url,destinatario,tipo,sequencia,mensagem,ordem,job_id)
        values(p_id,(j->>'lead_id')::uuid,(j->>'proposta_enviado_em')::timestamptz,j->>'proposta_pdf_url',j->>'destinatario',
          j->>'tipo',j->'sequencia',j->>'mensagem',(j->>'ordem')::integer,(j->>'job_id')::uuid) returning * into i;
    end loop;
    if (select min(ordem)<>1 or max(ordem)<>n from public.whatsapp_lote_legado_itens where lote_id=p_id) then raise exception 'ordem_invalida'; end if;
    perform 1 from public.leads where id in(select lead_id from public.whatsapp_lote_legado_itens where lote_id=p_id)
      order by id for update;
    for i in select * from public.whatsapp_lote_legado_itens where lote_id=p_id order by lead_id loop
      v_recusa:=public.recusa_item_lote_legado_whatsapp(p_id,i.lead_id,a);
      if v_recusa is not null then raise exception '%',v_recusa; end if;
      select * into o from public.whatsapp_outbox where id=i.job_id for update;
      if found and (o.lead_id is distinct from i.lead_id or o.tipo is distinct from i.tipo
        or o.proposta_enviado_em is distinct from i.proposta_enviado_em or o.proposta_pdf_url is distinct from i.proposta_pdf_url
        or o.destinatario is distinct from i.destinatario or o.sequencia is distinct from i.sequencia or o.mensagem is distinct from i.mensagem
        or o.lote_legado_id is not null or o.estado<>'cancelado' or o.iniciado_em is not null or o.enviado_em is not null
        or coalesce(o.ultimo_codigo,'') not in('historico_incompleto','inactivity_unverified','inactivity_recent','identidade_nao_confirmada')) then
        raise exception 'tentativa_legada_nao_reutilizavel'; end if;
      if exists(select 1 from public.whatsapp_outbox x where x.lead_id=i.lead_id and x.tipo=i.tipo
        and x.proposta_enviado_em=i.proposta_enviado_em and x.id<>i.job_id) then raise exception 'job_id_divergente'; end if;
    end loop;
    update public.whatsapp_lotes_legados set manifesto_selado=true where id=p_id;
  exception when others then
    return jsonb_build_object('erro','manifesto_invalido','codigo',case when sqlstate='P0001' then sqlerrm else 'snapshot_ou_formato_invalido' end);
  end;
  return jsonb_build_object('id',p_id,'estado','pausado','quantidade',n);
end; $$;

create or replace function public.ativar_lote_legado_whatsapp(p_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
declare b public.whatsapp_lotes_legados%rowtype; a timestamptz:=statement_timestamp();
begin
  perform pg_advisory_xact_lock(783921401);
  select * into b from public.whatsapp_lotes_legados where id=p_id for update;
  if not found then return jsonb_build_object('erro','lote_nao_encontrado'); end if;
  if b.manifesto_selado is not true or b.estado not in('pausado','ativo') or b.expira_em<=a then return jsonb_build_object('erro','lote_encerrado'); end if;
  if exists(select 1 from public.whatsapp_lotes_legados where estado='ativo' and id<>p_id) then return jsonb_build_object('erro','outro_lote_ativo'); end if;
  update public.whatsapp_lotes_legados set estado='ativo',ativado_em=coalesce(ativado_em,a),
    proximo_inicio_em=case when ativado_em is null then a else greatest(coalesce(proximo_inicio_em,a),a+interval '120 seconds') end where id=p_id;
  return jsonb_build_object('id',p_id,'estado','ativo');
end; $$;
create or replace function public.pausar_lote_legado_whatsapp(p_id uuid)
returns jsonb language plpgsql security invoker set search_path=pg_catalog as $$
begin
  update public.whatsapp_lotes_legados set estado='pausado' where id=p_id and estado='ativo';
  return jsonb_build_object('id',p_id,'estado',(select estado from public.whatsapp_lotes_legados where id=p_id));
end; $$;

-- Claim legado ignora totalmente o lote, inclusive reaper de leases.
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
      where o.lote_legado_id is null and o.lead_id=l.id and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
        and o.estado in ('pendente','reservado','enviando'))
    order by l.id for update of l skip locked) p;
  update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio'
    where lote_legado_id is null and tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and lead_id=any(v_leads) and estado='enviando' and lease_ate<=v_agora;
  update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,ultimo_codigo='lease_expirado_antes_envio'
    where lote_legado_id is null and tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and lead_id=any(v_leads) and estado='reservado' and lease_ate<=v_agora;
  -- Um job marcado para teste nunca perde silenciosamente a validade temporaria.
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='teste_owner_expirado'
    where o.lote_legado_id is null and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.teste_owner_expira_em is not null
      and (o.teste_owner_expira_em<>timestamptz '2026-10-17T18:00:00Z'
        or not public.teste_proposta_whatsapp_valido(o.lead_id,o.tipo,o.proposta_enviado_em,
          o.proposta_pdf_url,o.destinatario,v_agora));
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='proposta_condicao_alterada'
    where o.lote_legado_id is null and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
      and public.recusa_lembrete_proposta_whatsapp(o.lead_id,o.tipo,o.proposta_enviado_em,o.proposta_pdf_url,o.destinatario,v_agora) is not null;
  update public.whatsapp_outbox set estado='expirado',lease_token=null,lease_ate=null,
    ultimo_codigo=case when tentativas>=5 then 'limite_tentativas' else 'prazo_expirado' end
    where lote_legado_id is null and tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and lead_id=any(v_leads) and estado in ('pendente','reservado')
      and (expira_em<=v_agora or (estado='pendente' and tentativas>=5));
  return query with candidato as (
    select o.id from public.whatsapp_outbox o join public.leads l on l.id=o.lead_id
    where o.lote_legado_id is null and l.id=any(v_leads) and o.estado='pendente' and o.expira_em>v_agora
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
    -- Protocolos anteriores NUNCA autorizam a excecao do lote. ACK final continua valido.
    if v.lote_legado_id is not null then return null; end if;
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
-- Um novo clique depois do lote usa o fluxo NORMAL, sem herdar a excecao.
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
    if v_job.lote_legado_id is not null and not exists(select 1 from public.whatsapp_lote_legado_itens i
      where i.lote_id=v_job.lote_legado_id and i.job_id=v_job.id and i.estado='bloqueado') then
      return jsonb_build_object('erro','tentativa_encerrada'); end if;
    -- Outro clique pode refazer apenas o que NUNCA recebeu started/MCP.
    -- Mantem o ID para evitar qualquer colisao com recibos/ledger ja existentes.
    update public.whatsapp_outbox set lote_legado_id=null,estado='pendente',ocorrido_em=v_agora,expira_em=v_agora+interval '24 hours',
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

-- Protocolo 6: as filas normais continuam passando por V6 sem flexibilizacao.
create or replace function public.reivindicar_whatsapp_v7(
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,p_inicial_ativo boolean
)
returns setof public.whatsapp_outbox language plpgsql security invoker set search_path=pg_catalog as $$
declare a timestamptz:=statement_timestamp(); b public.whatsapp_lotes_legados%rowtype;
  i public.whatsapp_lote_legado_itens%rowtype; o public.whatsapp_outbox%rowtype; r text; d integer;
begin
  -- O lote vem antes de qualquer lock de lead, inclusive os locks da fila normal.
  select * into b from public.whatsapp_lotes_legados where estado='ativo' order by criado_em,id limit 1 for update skip locked;
  select * into o from public.reivindicar_whatsapp_v6(p_formulario_ativo,p_inicio_em,p_propostas_ativo,p_inicial_ativo);
  if found then return next o; return; end if;
  if p_propostas_ativo is not true then return; end if;
  if b.id is null then return; end if;
  if b.expira_em<=a then
    update public.whatsapp_outbox set estado='expirado',ultimo_codigo='lote_expirado' where lote_legado_id=b.id
      and estado in('pendente','reservado') and iniciado_em is null;
    update public.whatsapp_lote_legado_itens set estado='bloqueado',codigo='lote_expirado'
      where lote_id=b.id and estado='aguardando';
    update public.whatsapp_lotes_legados set estado='cancelado' where id=b.id;
    return;
  end if;
  -- Reap nunca transforma STARTED em nova tentativa. Receipts tardios sao aceitos.
  for i in select * from public.whatsapp_lote_legado_itens where lote_id=b.id and estado='reservado' order by lead_id loop
    perform 1 from public.leads where id=i.lead_id for update;
    select * into o from public.whatsapp_outbox where id=i.job_id for update;
    -- Reconciliar tambem ACKs tardios recebidos por um endpoint anterior e
    -- exclusao normal do lead; a fila do lote e derivavel da outbox real.
    if not found then
      update public.whatsapp_lote_legado_itens set estado='bloqueado',codigo='job_nao_encontrado' where job_id=i.job_id;
    elsif o.estado='enviado' and o.iniciado_em is not null and o.enviado_em is not null then
      update public.whatsapp_lote_legado_itens set estado='enviado',codigo=null where job_id=i.job_id;
    elsif o.estado='indeterminado' then
      update public.whatsapp_lote_legado_itens set estado='indeterminado',codigo=o.ultimo_codigo where job_id=i.job_id;
    elsif o.estado in('cancelado','expirado') then
      update public.whatsapp_lote_legado_itens set estado='bloqueado',codigo=o.ultimo_codigo where job_id=i.job_id;
    elsif o.estado='enviando' and o.lease_ate<=a then
      update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio' where id=o.id;
      update public.whatsapp_lote_legado_itens set estado='indeterminado',codigo='lease_expirado_durante_envio' where job_id=o.id;
    elsif o.estado='reservado' and o.lease_ate<=a and o.iniciado_em is null then
      update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null,ultimo_codigo='lease_expirado_antes_envio' where id=o.id;
      update public.whatsapp_lote_legado_itens set estado='aguardando',codigo='lease_expirado_antes_envio' where job_id=o.id;
    end if;
  end loop;
  if exists(select 1 from public.whatsapp_lote_legado_itens where lote_id=b.id and estado='reservado') then return; end if;
  if not exists(select 1 from public.whatsapp_lote_legado_itens where lote_id=b.id and estado='aguardando') then
    update public.whatsapp_lotes_legados set estado='concluido' where id=b.id; return;
  end if;
  if b.proximo_inicio_em>a then return; end if;
  for i in select * from public.whatsapp_lote_legado_itens where lote_id=b.id and estado='aguardando' order by ordem loop
    perform 1 from public.leads where id=i.lead_id for update;
    r:=public.recusa_item_lote_legado_whatsapp(b.id,i.lead_id,a);
    select * into o from public.whatsapp_outbox where id=i.job_id for update;
    if found and (o.lote_legado_id is not null and o.lote_legado_id<>b.id
      or o.iniciado_em is not null or o.enviado_em is not null
      or o.lead_id is distinct from i.lead_id or o.tipo is distinct from i.tipo
      or o.proposta_enviado_em is distinct from i.proposta_enviado_em or o.proposta_pdf_url is distinct from i.proposta_pdf_url
      or o.destinatario is distinct from i.destinatario or o.sequencia is distinct from i.sequencia or o.mensagem is distinct from i.mensagem
      or (o.lote_legado_id is null and (o.estado<>'cancelado'
        or coalesce(o.ultimo_codigo,'') not in('historico_incompleto','inactivity_unverified','inactivity_recent','identidade_nao_confirmada')))
      or (o.lote_legado_id=b.id and o.estado<>'pendente')) then r:='tentativa_legada_nao_reutilizavel'; end if;
    if o.lote_legado_id=b.id and o.tentativas>=5 then r:='limite_tentativas'; end if;
    if r is not null then
      update public.whatsapp_outbox set estado='cancelado',ultimo_codigo=r where id=i.job_id and lote_legado_id=b.id
        and estado in('pendente','reservado') and iniciado_em is null;
      update public.whatsapp_lote_legado_itens set estado='bloqueado',codigo=r where lote_id=b.id and lead_id=i.lead_id;
      continue;
    end if;
    if o.id is null then
      insert into public.whatsapp_outbox(id,lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,
        proposta_enviado_em,proposta_pdf_url,solicitado_em,solicitado_por,lote_legado_id)
        values(i.job_id,i.lead_id,i.tipo,a,a+interval '24 hours',i.destinatario,i.mensagem,i.sequencia,
          i.proposta_enviado_em,i.proposta_pdf_url,a,b.id,b.id);
    elsif o.lote_legado_id is null then
      update public.whatsapp_outbox set lote_legado_id=b.id,estado='pendente',ocorrido_em=a,expira_em=a+interval '24 hours',
        solicitado_em=a,solicitado_por=b.id,proxima_tentativa_em=a,lease_token=null,lease_ate=null,tentativas=0,
        ultimo_codigo=null,historico_verificado_em=null,historico_cobertura_inicio_em=null,ultima_interacao_em=null where id=i.job_id;
    end if;
    -- Reserva uma vez por vez. O prazo e sempre baseado no AGORA, sem catch-up.
    d:=120+floor(random()*106)::integer;
    update public.whatsapp_lotes_legados set proximo_inicio_em=a+make_interval(secs=>d) where id=b.id;
    update public.whatsapp_lote_legado_itens set estado='reservado',codigo=null,intervalo_segundos=d where lote_id=b.id and lead_id=i.lead_id;
    return query update public.whatsapp_outbox set estado='reservado',lease_token=gen_random_uuid(),
      lease_ate=a+interval '90 seconds',tentativas=tentativas+1,proxima_tentativa_em=a+interval '5 minutes'
      where id=i.job_id returning *;
    return;
  end loop;
  if not exists(select 1 from public.whatsapp_lote_legado_itens where lote_id=b.id and estado in('aguardando','reservado')) then
    update public.whatsapp_lotes_legados set estado='concluido' where id=b.id;
  end if;
end; $$;

create or replace function public.resultado_whatsapp_v7(
  p_id uuid,p_lease_token uuid,p_outcome text,p_code text,
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,p_inicial_ativo boolean,
  p_historico_verificado_em timestamptz,p_historico_cobertura_inicio_em timestamptz,
  p_ultima_interacao_em timestamptz,p_historico_completo boolean
)
returns text language plpgsql security invoker set search_path=pg_catalog as $$
declare a timestamptz:=statement_timestamp(); v_lote uuid; v_lead uuid; b public.whatsapp_lotes_legados%rowtype;
  i public.whatsapp_lote_legado_itens%rowtype; o public.whatsapp_outbox%rowtype; r text; v_estado text;
begin
  select lote_legado_id,lead_id into v_lote,v_lead from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token;
  if not found then return null; end if;
  if v_lote is null then return public.resultado_whatsapp_v6(p_id,p_lease_token,p_outcome,p_code,p_formulario_ativo,p_inicio_em,
    p_propostas_ativo,p_inicial_ativo,p_historico_verificado_em,p_historico_cobertura_inicio_em,p_ultima_interacao_em,p_historico_completo); end if;
  -- Ordem unica de locks para claim, resultado, pause e ativacao: lote -> lead -> outbox.
  select * into b from public.whatsapp_lotes_legados where id=v_lote for update;
  perform 1 from public.leads where id=v_lead for update;
  select * into i from public.whatsapp_lote_legado_itens where lote_id=v_lote and lead_id=v_lead and job_id=p_id for update;
  if not found then return null; end if;
  select * into o from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token for update;
  if not found then return null; end if;
  if p_outcome='started' then
    if o.estado not in('reservado','enviando') then return null; end if;
    if p_propostas_ativo is not true then r:='propostas_desativadas';
    elsif b.estado<>'ativo' then r:='lote_nao_ativo';
    elsif b.expira_em<=a or o.expira_em<=a then r:='lote_expirado';
    elsif o.lease_ate<=a then r:='prazo_expirado';
    elsif i.estado<>'reservado' or i.tipo<>o.tipo or i.proposta_enviado_em is distinct from o.proposta_enviado_em
      or i.proposta_pdf_url is distinct from o.proposta_pdf_url or i.destinatario is distinct from o.destinatario
      or i.sequencia is distinct from o.sequencia or i.mensagem is distinct from o.mensagem or o.teste_owner_expira_em is not null then
      r:='lote_manifesto_divergente';
    else r:=public.recusa_item_lote_legado_whatsapp(v_lote,v_lead,a); end if;
    -- Somente o gate de COMPLETUDE/COBERTURA e dispensado. Datas reais,
    -- prova fresca e nenhuma interacao positiva nos ultimos 5 dias sao obrigatorias.
    if r is null then
      if p_historico_completo is null or p_historico_verificado_em is null or not isfinite(p_historico_verificado_em)
        or p_historico_verificado_em<=timestamptz '1970-01-01' or p_historico_verificado_em<a-interval '30 seconds'
        or p_historico_verificado_em>a+interval '5 seconds'
        or p_historico_cobertura_inicio_em is null or not isfinite(p_historico_cobertura_inicio_em)
        or p_historico_cobertura_inicio_em<=timestamptz '1970-01-01' or p_historico_cobertura_inicio_em>p_historico_verificado_em
        or (p_ultima_interacao_em is not null and (not isfinite(p_ultima_interacao_em)
          or p_ultima_interacao_em<=timestamptz '1970-01-01' or p_ultima_interacao_em>p_historico_verificado_em)) then
        r:='inactivity_unverified';
      elsif p_ultima_interacao_em>p_historico_verificado_em-interval '5 days' then r:='inactivity_recent'; end if;
    end if;
    if r is not null then
      update public.whatsapp_outbox set estado=case when iniciado_em is null then 'cancelado' else 'indeterminado' end,ultimo_codigo=r where id=p_id;
      update public.whatsapp_lote_legado_itens set estado=case when o.iniciado_em is null then 'bloqueado' else 'indeterminado' end,codigo=r where job_id=p_id;
      return null;
    end if;
    if o.iniciado_em is null then
      update public.whatsapp_lotes_legados set proximo_inicio_em=greatest(coalesce(proximo_inicio_em,a),a+make_interval(secs=>i.intervalo_segundos)) where id=v_lote;
    end if;
    update public.whatsapp_outbox set estado='enviando',iniciado_em=coalesce(iniciado_em,a),
      lease_ate=coalesce(iniciado_em,a)+interval '240 seconds',historico_verificado_em=p_historico_verificado_em,
      historico_cobertura_inicio_em=p_historico_cobertura_inicio_em,ultima_interacao_em=p_ultima_interacao_em where id=p_id;
    return 'enviando';
  end if;
  -- Nunca presumir um ACK: somente o outcome 'sent' confirmado pelo worker pode
  -- quitar o lembrete. A delegacao preserva ACK tardio e nunca move Esfriou.
  if p_outcome='failed' and o.estado='reservado' and o.iniciado_em is null then
    update public.whatsapp_outbox set estado='cancelado',ultimo_codigo=coalesce(p_code,'falha_antes_envio') where id=p_id;
    v_estado:='cancelado';
  else
    v_estado:=public.resultado_whatsapp_v6(p_id,p_lease_token,p_outcome,p_code,false,null,p_propostas_ativo,p_inicial_ativo,
      p_historico_verificado_em,p_historico_cobertura_inicio_em,p_ultima_interacao_em,p_historico_completo);
  end if;
  if v_estado is not null then
    update public.whatsapp_lote_legado_itens set estado=case v_estado when 'enviado' then 'enviado'
      when 'indeterminado' then 'indeterminado' else 'bloqueado' end,
      codigo=case when v_estado='enviado' then null else coalesce(p_code,'falha_antes_envio') end where job_id=p_id;
    if not exists(select 1 from public.whatsapp_lote_legado_itens where lote_id=v_lote and estado in('aguardando','reservado')) then
      update public.whatsapp_lotes_legados set estado='concluido' where id=v_lote and estado in('ativo','pausado'); end if;
  end if;
  return v_estado;
end; $$;

revoke execute on function public.proteger_manifesto_lote_legado_whatsapp(),
  public.recusa_item_lote_legado_whatsapp(uuid,uuid,timestamptz),
  public.criar_lote_legado_whatsapp(uuid,jsonb,timestamptz),public.ativar_lote_legado_whatsapp(uuid),public.pausar_lote_legado_whatsapp(uuid),
  public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean),
  public.reivindicar_whatsapp_v7(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v7(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  from public,anon,authenticated;
grant execute on function public.proteger_manifesto_lote_legado_whatsapp(),
  public.recusa_item_lote_legado_whatsapp(uuid,uuid,timestamptz),
  public.criar_lote_legado_whatsapp(uuid,jsonb,timestamptz),public.ativar_lote_legado_whatsapp(uuid),public.pausar_lote_legado_whatsapp(uuid),
  public.resultado_whatsapp_v4(uuid,uuid,text,text,boolean,timestamptz,boolean,timestamptz,timestamptz,timestamptz,boolean),
  public.reivindicar_whatsapp_v7(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v7(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  to service_role;
commit;
