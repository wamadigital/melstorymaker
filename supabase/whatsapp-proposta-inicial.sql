-- Primeiro envio da proposta após 15 minutos em Aguardando revisão.
-- Aplicar manualmente depois de whatsapp-testes-owner.sql. Não ativa flags.
-- A fila existente, sessão e recibos permanecem preservados.
begin;

alter table public.leads add column if not exists pdf_storage_path text;

create table if not exists public.whatsapp_propostas_automaticas (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  id uuid not null unique default gen_random_uuid(),
  entrada_em timestamptz not null,
  estado text not null default 'agendada' check (estado in
    ('agendada','gerando','enfileirada','enviado','cancelada','falha','indeterminado')),
  tentativas integer not null default 0 check (tentativas between 0 and 5),
  proxima_tentativa_em timestamptz not null default now(),
  lease_token uuid, lease_ate timestamptz,
  categoria text, respostas jsonb, destinatario text,
  pdf_anterior_em timestamptz, pdf_gerado_em timestamptz,
  arquivo text, nome_contato text, ultimo_codigo text
);
alter table public.whatsapp_propostas_automaticas enable row level security;
revoke all on table public.whatsapp_propostas_automaticas from public,anon,authenticated;
grant select,insert,update,delete on table public.whatsapp_propostas_automaticas to service_role;
create index if not exists whatsapp_propostas_automaticas_agendadas_idx
  on public.whatsapp_propostas_automaticas(proxima_tentativa_em,entrada_em)
  where estado in ('agendada','gerando');

create or replace function public.registrar_entrada_proposta_automatica()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  if new.status::text='aguardando_revisao'
    and (tg_op='INSERT' or old.status is distinct from new.status)
    and new.enviado_em is null
    and not exists(select 1 from public.whatsapp_outbox o where o.lead_id=new.id
      and o.tipo='proposta_inicial_15m' and o.iniciado_em is not null) then
    insert into public.whatsapp_propostas_automaticas(lead_id,entrada_em)
      values(new.id,statement_timestamp())
    on conflict(lead_id) do update set entrada_em=excluded.entrada_em,estado='agendada',
      tentativas=0,proxima_tentativa_em=statement_timestamp(),lease_token=null,lease_ate=null,
      ultimo_codigo=null;
  end if;
  return new;
end;
$$;
revoke execute on function public.registrar_entrada_proposta_automatica() from public,anon,authenticated;
grant execute on function public.registrar_entrada_proposta_automatica() to service_role;
drop trigger if exists leads_agendar_proposta_automatica on public.leads;
create trigger leads_agendar_proposta_automatica after insert or update of status on public.leads
  for each row execute function public.registrar_entrada_proposta_automatica();

-- Para os cards atuais, updated_at é um limite conservador: nunca antecipa
-- os 15 minutos. Novas entradas usam o instante exato do trigger acima.
insert into public.whatsapp_propostas_automaticas(lead_id,entrada_em)
  select id,greatest(created_at,updated_at) from public.leads
  where status::text='aguardando_revisao' and enviado_em is null
  on conflict(lead_id) do nothing;

create or replace function public.sequencia_proposta_inicial(p_nome text,p_link text)
returns jsonb language sql immutable security invoker set search_path=pg_catalog
as $$
  select case when p_nome=btrim(p_nome) and length(p_nome) between 1 and 120
    and p_nome !~ '[[:cntrl:]{}<>]' and p_link ~ '^https://[^[:space:]/?#@]+/p/[a-z0-9]{4}$'
    and strpos(p_link,chr(92))=0 then jsonb_build_array(
      jsonb_build_object('message','Oi, '||p_nome||' tudo bem? Aqui é a Mel Storymaker ✨','delayBeforeSeconds',0),
      jsonb_build_object('message','Você solicitou um orçamento através do meu site.','delayBeforeSeconds',3),
      jsonb_build_object('message',E'Segue a sua proposta:\n🤍 '||p_link,'delayBeforeSeconds',2),
      jsonb_build_object('message',E'Qualquer dúvida, é só me chamar. Ok?\nFico à disposição para te ajudar no que precisar!','delayBeforeSeconds',4)) end;
$$;
create or replace function public.sequencia_proposta_inicial_valida(p_seq jsonb,p_nome text,p_link text,p_texto text)
returns boolean language sql immutable security invoker set search_path=pg_catalog
as $$
  select coalesce(p_seq=public.sequencia_proposta_inicial(p_nome,p_link)
    and p_texto=(select string_agg(p.value->>'message',E'\n\n' order by p.n)
      from jsonb_array_elements(public.sequencia_proposta_inicial(p_nome,p_link)) with ordinality p(value,n)),false);
$$;
revoke execute on function public.sequencia_proposta_inicial(text,text),public.sequencia_proposta_inicial_valida(jsonb,text,text,text)
  from public,anon,authenticated;
grant execute on function public.sequencia_proposta_inicial(text,text),public.sequencia_proposta_inicial_valida(jsonb,text,text,text) to service_role;

alter table public.whatsapp_outbox add column if not exists proposta_automatica_id uuid;
alter table public.whatsapp_outbox add column if not exists proposta_nome text;
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_tipo_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_tipo_check check(tipo in
  ('confirmacao_recebimento','lembrete_formulario_24h','lembrete_proposta_7d','lembrete_proposta_30d','proposta_inicial_15m'));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_somente_lembrete_ativo;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_somente_lembrete_ativo check(
  tipo in ('lembrete_formulario_24h','lembrete_proposta_7d','lembrete_proposta_30d','proposta_inicial_15m')
  or estado not in ('pendente','reservado','enviando'));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_proposta_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_proposta_check check(
  (tipo not in ('lembrete_proposta_7d','lembrete_proposta_30d','proposta_inicial_15m')
    and proposta_enviado_em is null and proposta_pdf_url is null and solicitado_em is null and solicitado_por is null)
  or (tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and proposta_enviado_em is not null
    and isfinite(proposta_enviado_em) and proposta_enviado_em<=ocorrido_em and proposta_pdf_url is not null
    and solicitado_em is not null and solicitado_em=ocorrido_em and solicitado_por is not null
    and public.sequencia_lembrete_proposta_valida(sequencia,tipo,proposta_pdf_url,mensagem))
  or (tipo='proposta_inicial_15m' and proposta_enviado_em is null and solicitado_em is null and solicitado_por is null
    and proposta_automatica_id is not null and proposta_nome is not null and proposta_pdf_url is not null
    and public.sequencia_proposta_inicial_valida(sequencia,proposta_nome,proposta_pdf_url,mensagem)));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_sequencia_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_sequencia_check check(
  (tipo='confirmacao_recebimento' and sequencia is null)
  or (tipo='lembrete_formulario_24h' and (estado not in ('pendente','reservado','enviando')
    or public.sequencia_lembrete_formulario_valida(sequencia,lead_id,mensagem)))
  or (tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
    and public.sequencia_lembrete_proposta_valida(sequencia,tipo,proposta_pdf_url,mensagem))
  or (tipo='proposta_inicial_15m' and public.sequencia_proposta_inicial_valida(sequencia,proposta_nome,proposta_pdf_url,mensagem)));
create unique index if not exists whatsapp_outbox_inicial_unica_idx
  on public.whatsapp_outbox(lead_id,tipo) where tipo='proposta_inicial_15m';

create or replace function public.reivindicar_preparo_proposta_whatsapp(p_ativo boolean)
returns setof public.whatsapp_propostas_automaticas language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_agora timestamptz:=statement_timestamp(); v_lead public.leads%rowtype;
begin
  if p_ativo is not true then return; end if;
  select l.* into v_lead from public.leads l join public.whatsapp_propostas_automaticas p on p.lead_id=l.id
    where l.status::text='aguardando_revisao' and l.enviado_em is null
      and p.entrada_em<=v_agora-interval '15 minutes' and p.tentativas<5 and p.proxima_tentativa_em<=v_agora
      and (p.estado='agendada' or (p.estado='gerando' and p.lease_ate<=v_agora))
      and not exists(select 1 from public.whatsapp_outbox o where o.lead_id=l.id
        and o.tipo='proposta_inicial_15m' and o.iniciado_em is not null)
    order by p.entrada_em,l.id limit 1 for update of l skip locked;
  if not found then return; end if;
  return query update public.whatsapp_propostas_automaticas p set estado='gerando',
    lease_token=gen_random_uuid(),lease_ate=v_agora+interval '90 seconds',tentativas=p.tentativas+1,
    categoria=v_lead.categoria::text,respostas=v_lead.respostas,
    destinatario=public.destinatario_whatsapp_br(v_lead.whatsapp),pdf_anterior_em=v_lead.pdf_gerado_em,
    ultimo_codigo=null where p.lead_id=v_lead.id returning p.*;
end;
$$;

create or replace function public.falhar_preparo_proposta_whatsapp(p_lead_id uuid,p_token uuid,p_codigo text,p_definitivo boolean)
returns boolean language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  perform 1 from public.leads where id=p_lead_id for update;
  update public.whatsapp_propostas_automaticas set estado=case when p_definitivo or tentativas>=5 then 'falha' else 'agendada' end,
    lease_token=null,lease_ate=null,proxima_tentativa_em=statement_timestamp()+interval '5 minutes',ultimo_codigo=p_codigo
    where lead_id=p_lead_id and lease_token=p_token and estado='gerando';
  return found;
end;
$$;

create or replace function public.concluir_preparo_proposta_whatsapp(
  p_lead_id uuid,p_token uuid,p_nome text,p_link text,p_arquivo text
)
returns boolean language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_lead public.leads%rowtype; v public.whatsapp_propostas_automaticas%rowtype;
  v_agora timestamptz:=statement_timestamp(); v_seq jsonb; v_texto text;
begin
  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then return false; end if;
  select * into v from public.whatsapp_propostas_automaticas where lead_id=p_lead_id for update;
  if not found or v.estado<>'gerando' or v.lease_token is distinct from p_token or v.lease_ate<=v_agora then return false; end if;
  if v_lead.status::text<>'aguardando_revisao' or v_lead.enviado_em is not null
    or v.entrada_em>v_agora-interval '15 minutes' or v_lead.categoria::text is distinct from v.categoria
    or v_lead.respostas is distinct from v.respostas or v_lead.pdf_gerado_em is distinct from v.pdf_anterior_em
    or v.destinatario is null or public.destinatario_whatsapp_br(v_lead.whatsapp) is distinct from v.destinatario
    or p_nome is distinct from btrim(v_lead.respostas->>'nome')
    or v_lead.slug is null or right(p_link,7) is distinct from '/p/'||v_lead.slug
    or p_arquivo is distinct from 'automaticas/'||p_lead_id::text||'/'||p_token::text||'.pdf'
    or exists(select 1 from public.whatsapp_outbox o where o.lead_id=p_lead_id and o.tipo='proposta_inicial_15m' and o.iniciado_em is not null)
  then
    update public.whatsapp_propostas_automaticas set estado='cancelada',ultimo_codigo='proposta_condicao_alterada',lease_token=null,lease_ate=null
      where lead_id=p_lead_id;
    return false;
  end if;
  v_seq:=public.sequencia_proposta_inicial(p_nome,p_link);
  if v_seq is null then return false; end if;
  select string_agg(p.value->>'message',E'\n\n' order by p.n) into v_texto from jsonb_array_elements(v_seq) with ordinality p(value,n);
  insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,
    proposta_automatica_id,proposta_nome,proposta_pdf_url)
    values(p_lead_id,'proposta_inicial_15m',v_agora,v_agora+interval '24 hours',v.destinatario,v_texto,v_seq,v.id,p_nome,p_link)
    on conflict(lead_id,tipo) where tipo='proposta_inicial_15m' do update
      set estado='pendente',ocorrido_em=excluded.ocorrido_em,expira_em=excluded.expira_em,
      destinatario=excluded.destinatario,mensagem=excluded.mensagem,sequencia=excluded.sequencia,
      proposta_automatica_id=excluded.proposta_automatica_id,proposta_nome=excluded.proposta_nome,
      proposta_pdf_url=excluded.proposta_pdf_url,tentativas=0,proxima_tentativa_em=v_agora,
      lease_token=null,lease_ate=null,ultimo_codigo=null
      where whatsapp_outbox.iniciado_em is null;
  update public.leads set pdf_url=p_link,pdf_gerado_em=v_agora,pdf_storage_path=p_arquivo where id=p_lead_id;
  update public.whatsapp_propostas_automaticas set estado='enfileirada',nome_contato=p_nome,
    arquivo=p_arquivo,pdf_gerado_em=v_agora,lease_token=null,lease_ate=null where lead_id=p_lead_id;
  return true;
end;
$$;

create or replace function public.recusa_proposta_inicial_whatsapp(p_id uuid,p_agora timestamptz)
returns text language plpgsql stable security invoker set search_path=pg_catalog
as $$
declare v public.whatsapp_outbox%rowtype; p public.whatsapp_propostas_automaticas%rowtype; l public.leads%rowtype;
begin
  select * into v from public.whatsapp_outbox where id=p_id and tipo='proposta_inicial_15m';
  if not found then return 'job_invalido'; end if;
  select * into l from public.leads where id=v.lead_id;
  if not found or l.status::text<>'aguardando_revisao' or l.enviado_em is not null then return 'coluna_invalida'; end if;
  select * into p from public.whatsapp_propostas_automaticas where lead_id=v.lead_id and id=v.proposta_automatica_id;
  if not found or p.estado<>'enfileirada' or p.entrada_em>p_agora-interval '15 minutes'
    or l.categoria::text is distinct from p.categoria or l.respostas is distinct from p.respostas
    or l.pdf_url is distinct from v.proposta_pdf_url or l.pdf_storage_path is distinct from p.arquivo
    or l.pdf_gerado_em is distinct from p.pdf_gerado_em
    or public.destinatario_whatsapp_br(l.whatsapp) is distinct from v.destinatario
    or btrim(l.respostas->>'nome') is distinct from v.proposta_nome
    or not public.sequencia_proposta_inicial_valida(v.sequencia,v.proposta_nome,v.proposta_pdf_url,v.mensagem)
    then return 'proposta_condicao_alterada'; end if;
  return null;
end;
$$;

-- V4 permanece restrito aos tipos anteriores. Só o worker protocolo 4 usa V5.
create or replace function public.reivindicar_whatsapp_v5(
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,p_inicial_ativo boolean
)
returns setof public.whatsapp_outbox language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_agora timestamptz:=statement_timestamp(); v_leads uuid[]; v_id uuid;
begin
  if p_inicial_ativo is true then
    select coalesce(array_agg(c.id),array[]::uuid[]) into v_leads from(
      select l.id from public.leads l where exists(select 1 from public.whatsapp_outbox o
        where o.lead_id=l.id and o.tipo='proposta_inicial_15m' and o.estado in ('pendente','reservado','enviando'))
      order by l.id for update of l skip locked)c;
    update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo='lease_expirado_durante_envio'
      where lead_id=any(v_leads) and tipo='proposta_inicial_15m' and estado='enviando' and lease_ate<=v_agora;
    update public.whatsapp_outbox set estado='pendente',lease_token=null,lease_ate=null
      where lead_id=any(v_leads) and tipo='proposta_inicial_15m' and estado='reservado' and lease_ate<=v_agora;
    update public.whatsapp_outbox o set estado='cancelado',ultimo_codigo='proposta_condicao_alterada',lease_token=null,lease_ate=null
      where o.lead_id=any(v_leads) and o.tipo='proposta_inicial_15m' and o.estado in ('pendente','reservado')
      and public.recusa_proposta_inicial_whatsapp(o.id,v_agora) is not null;
    update public.whatsapp_outbox set estado='expirado',ultimo_codigo='prazo_expirado',lease_token=null,lease_ate=null
      where lead_id=any(v_leads) and tipo='proposta_inicial_15m' and estado in ('pendente','reservado')
      and (expira_em<=v_agora or tentativas>=5);
    select o.id into v_id from public.whatsapp_outbox o where o.lead_id=any(v_leads) and o.tipo='proposta_inicial_15m'
      and o.estado='pendente' and o.proxima_tentativa_em<=v_agora and o.expira_em>v_agora and o.tentativas<5
      order by o.ocorrido_em,o.id limit 1 for update of o skip locked;
    if found then
      return query update public.whatsapp_outbox set estado='reservado',lease_token=gen_random_uuid(),
        lease_ate=v_agora+interval '90 seconds',tentativas=tentativas+1,
        proxima_tentativa_em=v_agora+interval '5 minutes' where id=v_id returning *;
      return;
    end if;
  end if;
  return query select * from public.reivindicar_whatsapp_v4(p_formulario_ativo,p_inicio_em,p_propostas_ativo);
end;
$$;

create or replace function public.resultado_whatsapp_v5(
  p_id uuid,p_lease_token uuid,p_outcome text,p_code text,
  p_formulario_ativo boolean,p_inicio_em timestamptz,p_propostas_ativo boolean,p_inicial_ativo boolean,
  p_historico_verificado_em timestamptz,p_historico_cobertura_inicio_em timestamptz,
  p_ultima_interacao_em timestamptz,p_historico_completo boolean
)
returns text language plpgsql security invoker set search_path=pg_catalog
as $$
declare v public.whatsapp_outbox%rowtype; v_lead uuid; v_tipo text; v_agora timestamptz:=statement_timestamp(); v_recusa text; v_sent timestamptz;
begin
  select lead_id,tipo into v_lead,v_tipo from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token;
  if not found then return null; end if;
  if v_tipo<>'proposta_inicial_15m' then return public.resultado_whatsapp_v4(p_id,p_lease_token,p_outcome,p_code,
    p_formulario_ativo,p_inicio_em,p_propostas_ativo,p_historico_verificado_em,p_historico_cobertura_inicio_em,p_ultima_interacao_em,p_historico_completo); end if;
  perform 1 from public.leads where id=v_lead for update;
  if not found then return null; end if;
  perform 1 from public.whatsapp_propostas_automaticas where lead_id=v_lead for update;
  select * into v from public.whatsapp_outbox where id=p_id and lease_token=p_lease_token for update;
  if not found then return null; end if;
  if p_outcome='started' then
    if v.estado not in ('reservado','enviando') or p_inicial_ativo is not true then return null; end if;
    v_recusa:=public.recusa_proposta_inicial_whatsapp(p_id,v_agora);
    if v.lease_ate<=v_agora or v.expira_em<=v_agora then v_recusa:='prazo_expirado'; end if;
    if v_recusa is not null then
      update public.whatsapp_outbox set estado=case when iniciado_em is null then 'cancelado' else 'indeterminado' end,
        ultimo_codigo=v_recusa where id=p_id;
      update public.whatsapp_propostas_automaticas set estado=case when v.iniciado_em is null then 'cancelada' else 'indeterminado' end,
        ultimo_codigo=v_recusa where lead_id=v_lead;
      return null;
    end if;
    update public.whatsapp_outbox set estado='enviando',iniciado_em=coalesce(iniciado_em,v_agora),
      lease_ate=coalesce(iniciado_em,v_agora)+interval '240 seconds' where id=p_id;
    return 'enviando';
  end if;
  if p_outcome='sent' and v.iniciado_em is not null and v.estado in ('enviando','indeterminado','enviado') then
    v_sent:=coalesce(v.enviado_em,v_agora);
    update public.whatsapp_outbox set estado='enviado',enviado_em=v_sent,ultimo_codigo=null where id=p_id;
    update public.leads l set enviado_em=coalesce(l.enviado_em,v_sent),
      status=case when l.status::text='aguardando_revisao' and l.respostas=p.respostas
        and l.categoria::text=p.categoria then 'enviado' else l.status end
      from public.whatsapp_propostas_automaticas p where l.id=v_lead and p.lead_id=l.id;
    update public.whatsapp_propostas_automaticas set estado='enviado',ultimo_codigo=null where lead_id=v_lead;
    return 'enviado';
  end if;
  if p_outcome in ('failed','indeterminate') and v.estado in ('enviando','indeterminado') then
    update public.whatsapp_outbox set estado='indeterminado',ultimo_codigo=coalesce(p_code,'resultado_indeterminado') where id=p_id;
    update public.whatsapp_propostas_automaticas set estado='indeterminado',ultimo_codigo='resultado_indeterminado' where lead_id=v_lead;
    return 'indeterminado';
  end if;
  if p_outcome='failed' and v.estado='reservado' then
    v_recusa:=case when v.expira_em<=v_agora or v.tentativas>=5 then 'expirado' else 'pendente' end;
    update public.whatsapp_outbox set estado=v_recusa,lease_token=null,lease_ate=null,
      proxima_tentativa_em=v_agora+interval '5 minutes',ultimo_codigo=coalesce(p_code,'falha_antes_envio') where id=p_id;
    return v_recusa;
  end if;
  return null;
end;
$$;

revoke execute on function public.reivindicar_preparo_proposta_whatsapp(boolean),
  public.falhar_preparo_proposta_whatsapp(uuid,uuid,text,boolean),
  public.concluir_preparo_proposta_whatsapp(uuid,uuid,text,text,text),
  public.recusa_proposta_inicial_whatsapp(uuid,timestamptz),
  public.reivindicar_whatsapp_v5(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v5(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  from public,anon,authenticated;
grant execute on function public.reivindicar_preparo_proposta_whatsapp(boolean),
  public.falhar_preparo_proposta_whatsapp(uuid,uuid,text,boolean),
  public.concluir_preparo_proposta_whatsapp(uuid,uuid,text,text,text),
  public.recusa_proposta_inicial_whatsapp(uuid,timestamptz),
  public.reivindicar_whatsapp_v5(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v5(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  to service_role;
commit;
