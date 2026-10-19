-- Formulario /orcar: mesmo Kanban, primeira proposta enviada manualmente pela Mel.
-- Aplicar MANUALMENTE antes do deploy web, depois dos SQLs do WhatsApp atuais.
-- Reaplicavel. Nao altera flags, worker, mensagens ou recibos ja registrados.
begin;

alter table public.leads add column if not exists origem_formulario text not null default 'formulario';
alter table public.leads drop constraint if exists leads_origem_formulario_check;
alter table public.leads add constraint leads_origem_formulario_check
  check(origem_formulario in ('formulario','orcar'));

-- Uma retomada pelo link da Mel desliga somente a proposta inicial. A origem
-- nao volta ao padrao se o lead depois abrir /formulario ou /continuar.
create or replace function public.preservar_origem_formulario()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  if old.origem_formulario='orcar' then
    new.origem_formulario:='orcar';
  elsif new.origem_formulario is distinct from old.origem_formulario
    and (old.status::text<>'incompleto' or old.enviado_em is not null) then
    raise exception 'origem_formulario_apos_conclusao' using errcode='23514';
  end if;
  return new;
end;
$$;
revoke execute on function public.preservar_origem_formulario() from public,anon,authenticated;
grant execute on function public.preservar_origem_formulario() to service_role;
drop trigger if exists leads_preservar_origem_formulario on public.leads;
create trigger leads_preservar_origem_formulario before update of origem_formulario on public.leads
  for each row execute function public.preservar_origem_formulario();

create or replace function public.registrar_entrada_proposta_automatica()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  -- A origem acompanha o lead; abrir outro link nunca reativa esta automacao.
  if new.origem_formulario='orcar' then
    update public.whatsapp_propostas_automaticas set estado='cancelada',
      ultimo_codigo='origem_formulario_manual',lease_token=null,lease_ate=null
      where lead_id=new.id and estado in ('agendada','gerando');
    return new;
  end if;
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
drop trigger if exists leads_agendar_proposta_automatica on public.leads;
create trigger leads_agendar_proposta_automatica after insert or update of status,origem_formulario on public.leads
  for each row execute function public.registrar_entrada_proposta_automatica();

create or replace function public.reivindicar_preparo_proposta_whatsapp(p_ativo boolean)
returns setof public.whatsapp_propostas_automaticas language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_agora timestamptz:=statement_timestamp(); v_lead public.leads%rowtype;
begin
  if p_ativo is not true then return; end if;
  select l.* into v_lead from public.leads l join public.whatsapp_propostas_automaticas p on p.lead_id=l.id
    where l.status::text='aguardando_revisao' and l.enviado_em is null
      and l.origem_formulario<>'orcar'
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
  if v_lead.origem_formulario='orcar' or v_lead.status::text<>'aguardando_revisao' or v_lead.enviado_em is not null
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
  if l.origem_formulario='orcar' then return 'origem_formulario_manual'; end if;
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

-- O schema completo contem o backfill historico da proposta. Ao reaplica-lo,
-- encerra somente preparos sem envio desta origem; outbox e ACKs ficam intactos.
update public.whatsapp_propostas_automaticas p set estado='cancelada',
  ultimo_codigo='origem_formulario_manual',lease_token=null,lease_ate=null
  from public.leads l where l.id=p.lead_id and l.origem_formulario='orcar'
    and p.estado in ('agendada','gerando');

-- ACK terminal fica em resultado_whatsapp_v5: envio iniciado deve continuar
-- reconciliavel mesmo se a origem mudar antes de o recibo chegar.
revoke execute on function public.registrar_entrada_proposta_automatica(),
  public.reivindicar_preparo_proposta_whatsapp(boolean),
  public.concluir_preparo_proposta_whatsapp(uuid,uuid,text,text,text),
  public.recusa_proposta_inicial_whatsapp(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.registrar_entrada_proposta_automatica(),
  public.reivindicar_preparo_proposta_whatsapp(boolean),
  public.concluir_preparo_proposta_whatsapp(uuid,uuid,text,text,text),
  public.recusa_proposta_inicial_whatsapp(uuid,timestamptz) to service_role;
commit;
