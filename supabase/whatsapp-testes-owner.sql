-- Excecao TEMPORARIA pedida pelo owner em 15/10/2026 para cinco cards de teste.
-- Aplicar depois de whatsapp-lembretes-proposta.sql. Nao cria leads, nao enfileira,
-- nao envia, nao altera historicos e nao ativa automacao de formulario.
-- A allowlist e preenchida separadamente com a revisao exata de cada proposta.
-- Expira em 17/10/2026 as 15h de Sao Paulo, sem renovacao implicita.
begin;
lock table public.whatsapp_outbox in share row exclusive mode;

create table if not exists public.whatsapp_testes_owner (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  marco integer not null,
  proposta_enviado_em timestamptz not null check(isfinite(proposta_enviado_em)),
  proposta_pdf_url text not null,
  expira_em timestamptz not null default '2026-10-17T18:00:00Z',
  constraint whatsapp_testes_owner_escopo_check check (
    expira_em=timestamptz '2026-10-17T18:00:00Z' and
    ((marco=7 and lead_id in ('01b985e2-6bff-4e9c-bb5e-2f1cc280edf7',
      'd459193f-9e7c-4b2c-995d-7f829a0936bd','13e49741-9d35-404c-ae54-42fe93e55c66'))
     or (marco=30 and lead_id in ('abf88ff2-ea34-4e32-994d-f7dc75df599b',
      '9263d823-d059-4e0a-b759-9184035dec89'))))
);
alter table public.whatsapp_testes_owner enable row level security;
revoke all on table public.whatsapp_testes_owner from anon,authenticated,public;
grant select,insert,update,delete on table public.whatsapp_testes_owner to service_role;

alter table public.whatsapp_outbox add column if not exists teste_owner_expira_em timestamptz;
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_teste_owner_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_teste_owner_check check (
  teste_owner_expira_em is null or (teste_owner_expira_em=timestamptz '2026-10-17T18:00:00Z'
    and destinatario='5519988763916' and proposta_enviado_em is not null
    and ((tipo='lembrete_proposta_7d' and lead_id in ('01b985e2-6bff-4e9c-bb5e-2f1cc280edf7',
      'd459193f-9e7c-4b2c-995d-7f829a0936bd','13e49741-9d35-404c-ae54-42fe93e55c66'))
     or (tipo='lembrete_proposta_30d' and lead_id in ('abf88ff2-ea34-4e32-994d-f7dc75df599b',
      '9263d823-d059-4e0a-b759-9184035dec89')))));

-- Sem parametro controlado pelo navegador. O banco confere todos os snapshots.
create or replace function public.teste_proposta_whatsapp_valido(
  p_lead_id uuid,p_tipo text,p_proposta_enviado_em timestamptz,
  p_pdf_url text,p_destinatario text,p_agora timestamptz
)
returns boolean language sql stable security invoker set search_path=pg_catalog
as $$
  select coalesce(p_agora is not null and isfinite(p_agora)
    and p_agora<timestamptz '2026-10-17T18:00:00Z'
    and p_destinatario='5519988763916' and exists (
      select 1 from public.whatsapp_testes_owner t join public.leads l on l.id=t.lead_id
      where t.lead_id=p_lead_id and t.expira_em=timestamptz '2026-10-17T18:00:00Z'
        and t.expira_em>p_agora
        and ((t.marco=7 and p_tipo='lembrete_proposta_7d')
          or (t.marco=30 and p_tipo='lembrete_proposta_30d'))
        and t.proposta_enviado_em=p_proposta_enviado_em and l.enviado_em=p_proposta_enviado_em
        and t.proposta_pdf_url=p_pdf_url and l.pdf_url=p_pdf_url
        and l.nome_display='TESTE HENRIQUE'
        and public.destinatario_whatsapp_br(l.whatsapp)=p_destinatario
        and l.status::text in ('enviado','esfriou')
        and p_agora>=p_proposta_enviado_em+case when t.marco=7 then interval '7 days' else interval '30 days' end
        and public.sequencia_lembrete_proposta(p_tipo,p_pdf_url) is not null),false);
$$;
revoke execute on function public.teste_proposta_whatsapp_valido(uuid,text,timestamptz,text,text,timestamptz)
  from anon,authenticated,public;
grant execute on function public.teste_proposta_whatsapp_valido(uuid,text,timestamptz,text,text,timestamptz) to service_role;

-- Marca somente novo clique/reclique anterior ao MCP. Nunca reescreve ACK real.
create or replace function public.marcar_teste_owner_whatsapp()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  if new.estado='pendente' and new.iniciado_em is null then
    if tg_op='INSERT' or (old.estado='cancelado' and old.iniciado_em is null) then
      new.teste_owner_expira_em:=case when public.teste_proposta_whatsapp_valido(
        new.lead_id,new.tipo,new.proposta_enviado_em,new.proposta_pdf_url,new.destinatario,statement_timestamp())
        then timestamptz '2026-10-17T18:00:00Z' else null end;
      return new;
    end if;
  end if;
  if tg_op='UPDATE' then new.teste_owner_expira_em:=old.teste_owner_expira_em; end if;
  return new;
end;
$$;
revoke execute on function public.marcar_teste_owner_whatsapp() from anon,authenticated,public;
grant execute on function public.marcar_teste_owner_whatsapp() to service_role;
drop trigger if exists whatsapp_outbox_marcar_teste_owner on public.whatsapp_outbox;
create trigger whatsapp_outbox_marcar_teste_owner before insert or update on public.whatsapp_outbox
  for each row execute function public.marcar_teste_owner_whatsapp();

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
  if p_tipo='lembrete_proposta_30d' and not public.teste_proposta_whatsapp_valido(
    p_lead_id,p_tipo,p_proposta_enviado_em,p_pdf_url,p_destinatario,p_agora) then
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
  -- Um job marcado para teste nunca perde silenciosamente a validade temporaria.
  update public.whatsapp_outbox o set estado='cancelado',lease_token=null,lease_ate=null,ultimo_codigo='teste_owner_expirado'
    where o.lead_id=any(v_leads) and o.estado in ('pendente','reservado')
      and o.teste_owner_expira_em is not null
      and (o.teste_owner_expira_em<>timestamptz '2026-10-17T18:00:00Z'
        or not public.teste_proposta_whatsapp_valido(o.lead_id,o.tipo,o.proposta_enviado_em,
          o.proposta_pdf_url,o.destinatario,v_agora));
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
    if v.teste_owner_expira_em is not null then
      if v.teste_owner_expira_em<>timestamptz '2026-10-17T18:00:00Z'
        or not public.teste_proposta_whatsapp_valido(v.lead_id,v.tipo,v.proposta_enviado_em,
          v.proposta_pdf_url,v.destinatario,v_agora) then v_recusa:='teste_owner_expirado'; end if;
    elsif p_historico_completo is not true or p_historico_verificado_em is null
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

commit;
