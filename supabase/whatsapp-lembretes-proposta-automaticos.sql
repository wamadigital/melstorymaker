-- Aplicar depois de eventos-passados.sql. Registra novas entradas em Esfriou
-- e usa a fila existente, com os mesmos textos, leases, historico e ACKs.
begin;

create table if not exists public.whatsapp_lembretes_proposta_config (
  id smallint primary key default 1 check (id=1),
  ativa boolean not null default true,
  ativada_em timestamptz not null default statement_timestamp()
);
insert into public.whatsapp_lembretes_proposta_config(id) values (1) on conflict do nothing;
alter table public.whatsapp_lembretes_proposta_config enable row level security;
revoke all on public.whatsapp_lembretes_proposta_config from public,anon,authenticated,service_role;
grant select,update(ativa) on public.whatsapp_lembretes_proposta_config to service_role;

create or replace function public.carimbar_ativacao_lembretes_proposta()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.ativa and not old.ativa then new.ativada_em:=statement_timestamp(); end if;
  return new;
end;
$$;
drop trigger if exists whatsapp_lembretes_proposta_carimbar_ativacao on public.whatsapp_lembretes_proposta_config;
create trigger whatsapp_lembretes_proposta_carimbar_ativacao
  before update of ativa on public.whatsapp_lembretes_proposta_config
  for each row execute function public.carimbar_ativacao_lembretes_proposta();

-- Sem backfill: quem ja estava em Esfriou antes da mudanca segue manual.
alter table public.leads add column if not exists esfriou_em timestamptz;
create or replace function public.registrar_entrada_esfriou()
returns trigger language plpgsql security invoker set search_path=pg_catalog as $$
begin
  if new.status<>'esfriou' then
    new.esfriou_em:=null;
  elsif tg_op='INSERT' or old.status is distinct from new.status then
    new.esfriou_em:=coalesce(new.esfriou_em,statement_timestamp());
  elsif old.enviado_em is distinct from new.enviado_em then
    new.esfriou_em:=statement_timestamp();
  else
    new.esfriou_em:=old.esfriou_em;
  end if;
  return new;
end;
$$;
-- Em ordem alfabetica, roda depois de preservar_encerramento_evento.
drop trigger if exists leads_registrar_entrada_esfriou on public.leads;
create trigger leads_registrar_entrada_esfriou before insert or update of status,enviado_em,data_evento,esfriou_em
  on public.leads for each row execute function public.registrar_entrada_esfriou();

create or replace function public.esfriar_leads_parados_whatsapp(p_agora timestamptz)
returns table(id uuid) language sql security invoker set search_path=pg_catalog as $$
  with candidatos as (
    select l.id, greatest(l.enviado_em,l.updated_at)+interval '168 hours' as entrou_em
    from public.leads l
    where l.status='enviado'
      and l.enviado_em<=least(p_agora,statement_timestamp())-interval '168 hours'
      and l.updated_at<=least(p_agora,statement_timestamp())-interval '168 hours'
      and p_agora is not null and isfinite(p_agora)
      and not public.evento_ja_passou(l.data_evento,statement_timestamp())
    order by l.id for update of l skip locked
  )
  update public.leads l set status='esfriou',esfriou_em=c.entrou_em
    from candidatos c where l.id=c.id returning l.id;
$$;

-- Solicitacoes manuais e do lote tem ator identificado. Na automatica, a
-- entrada exata permite invalidar uma reserva se o card saiu e voltou.
alter table public.whatsapp_outbox add column if not exists entrada_esfriou_automatica_em timestamptz;
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_entrada_esfriou_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_entrada_esfriou_check check(
  entrada_esfriou_automatica_em is null or (tipo in ('lembrete_proposta_7d','lembrete_proposta_30d')
    and isfinite(entrada_esfriou_automatica_em) and entrada_esfriou_automatica_em<=ocorrido_em));
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_proposta_check;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_proposta_check check(
  (tipo not in ('lembrete_proposta_7d','lembrete_proposta_30d','proposta_inicial_15m')
    and proposta_enviado_em is null and proposta_pdf_url is null and solicitado_em is null and solicitado_por is null)
  or (tipo in ('lembrete_proposta_7d','lembrete_proposta_30d') and proposta_enviado_em is not null
    and isfinite(proposta_enviado_em) and proposta_enviado_em<=ocorrido_em and proposta_pdf_url is not null
    and solicitado_em is not null and solicitado_em=ocorrido_em
    and (solicitado_por is not null or entrada_esfriou_automatica_em is not null)
    and public.sequencia_lembrete_proposta_valida(sequencia,tipo,proposta_pdf_url,mensagem))
  or (tipo='proposta_inicial_15m' and proposta_enviado_em is null and solicitado_em is null and solicitado_por is null
    and proposta_automatica_id is not null and proposta_nome is not null and proposta_pdf_url is not null
    and public.sequencia_proposta_inicial_valida(sequencia,proposta_nome,proposta_pdf_url,mensagem)));

-- Gates existentes de proposta: mesma revisao, identidade, evento e ACK.
create or replace function public.recusa_lembrete_proposta_basico_whatsapp(
  p_lead_id uuid, p_tipo text, p_proposta_enviado_em timestamptz,
  p_pdf_url text, p_destinatario text, p_agora timestamptz
)
returns text language plpgsql stable security invoker set search_path = pg_catalog
as $$
declare v_lead public.leads%rowtype; v_sete timestamptz;
begin
  select * into v_lead from public.leads where id=p_lead_id;
  if not found then return 'lead_nao_encontrado'; end if;
  if public.evento_ja_passou(v_lead.data_evento,p_agora) then return 'evento_passado'; end if;
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

-- Claim e cada STARTED passam por este gate, inclusive nos protocolos antigos.
-- ACK tardio segue a reconciliacao normal e nao depende da configuracao.
create or replace function public.recusa_lembrete_proposta_whatsapp(
  p_lead_id uuid, p_tipo text, p_proposta_enviado_em timestamptz,
  p_pdf_url text, p_destinatario text, p_agora timestamptz
)
returns text language plpgsql security invoker set search_path=pg_catalog as $$
declare v_recusa text; v_solicitado_em timestamptz; v_mesma_entrada boolean; v_ativa boolean;
begin
  v_recusa:=public.recusa_lembrete_proposta_basico_whatsapp(
    p_lead_id,p_tipo,p_proposta_enviado_em,p_pdf_url,p_destinatario,p_agora);
  if v_recusa is not null then return v_recusa; end if;
  select o.solicitado_em,l.status='esfriou' and l.esfriou_em=o.entrada_esfriou_automatica_em
    into v_solicitado_em,v_mesma_entrada
    from public.whatsapp_outbox o join public.leads l on l.id=o.lead_id
    where o.lead_id=p_lead_id and o.tipo=p_tipo and o.proposta_enviado_em=p_proposta_enviado_em
      and o.solicitado_por is null and o.entrada_esfriou_automatica_em is not null
      and o.estado in ('pendente','reservado','enviando');
  if not found then return null; end if;

  -- O PATCH so tranca esta linha. Serializa a pausa com STARTED sem
  -- inverter a ordem dos locks de lead/fila ou bloquear envios manuais.
  select c.ativa and c.ativada_em<=v_solicitado_em into v_ativa
    from public.whatsapp_lembretes_proposta_config c where c.id=1 for share;
  if v_mesma_entrada is not true or v_ativa is not true then return 'proposta_condicao_alterada'; end if;
  return null;
end;
$$;

-- A fila e a deduplicacao sao compartilhadas entre o clique e o agendador.
create or replace function public.enfileirar_lembrete_proposta_whatsapp_interno(
  p_lead_id uuid, p_marco integer, p_proposta_enviado_em timestamptz, p_solicitado_por uuid,
  p_entrada_esfriou timestamptz, p_prazo timestamptz
)
returns jsonb language plpgsql security invoker set search_path = pg_catalog
as $$
declare
  v_agora timestamptz:=statement_timestamp(); v_lead public.leads%rowtype;
  v_job public.whatsapp_outbox%rowtype; v_tipo text; v_recusa text; v_seq jsonb; v_texto text;
  v_cancelar_auto boolean; v_ocorrido_em timestamptz:=coalesce(p_prazo,v_agora);
begin
  if p_marco not in (7,30) or p_marco is null or (p_solicitado_por is null)=(p_entrada_esfriou is null) then
    return jsonb_build_object('erro','payload_invalido'); end if;
  select * into v_lead from public.leads where id=p_lead_id for update;
  if not found then return jsonb_build_object('erro','lead_nao_encontrado'); end if;
  v_tipo:=case when p_marco=7 then 'lembrete_proposta_7d' else 'lembrete_proposta_30d' end;
  if p_entrada_esfriou is not null then
    if v_lead.status<>'esfriou' or v_lead.esfriou_em is distinct from p_entrada_esfriou then
      return jsonb_build_object('erro','coluna_invalida');
    end if;
    if p_prazo is null or p_prazo<=v_agora-interval '24 hours' or p_prazo>v_agora
      or not exists(select 1 from public.whatsapp_lembretes_proposta_config c
                    where c.id=1 and c.ativa and c.ativada_em<=p_prazo) then
      return jsonb_build_object('erro','prazo_nao_atingido');
    end if;
  end if;
  v_recusa:=public.recusa_lembrete_proposta_basico_whatsapp(p_lead_id,v_tipo,p_proposta_enviado_em,
    v_lead.pdf_url,public.destinatario_whatsapp_br(v_lead.whatsapp),v_agora);
  if v_recusa is not null then return jsonb_build_object('erro',v_recusa); end if;
  select * into v_job from public.whatsapp_outbox where lead_id=p_lead_id and tipo=v_tipo
    and proposta_enviado_em=p_proposta_enviado_em for update;
  if found then
    if v_job.estado='enviado' then return jsonb_build_object('erro','ja_enviado'); end if;
    if p_entrada_esfriou is not null then return jsonb_build_object('erro','tentativa_encerrada'); end if;
    -- Um clique ainda vale se a configuracao ou a raia invalidou uma reserva
    -- automatica. O lease antigo perde a autorizacao junto com a reserva.
    v_cancelar_auto:=v_job.solicitado_por is null and v_job.iniciado_em is null
      and v_job.estado in ('pendente','reservado')
      and public.recusa_lembrete_proposta_whatsapp(p_lead_id,v_tipo,p_proposta_enviado_em,
        v_lead.pdf_url,public.destinatario_whatsapp_br(v_lead.whatsapp),v_agora) is not null;
    if v_job.estado in ('pendente','reservado','enviando') and not v_cancelar_auto then
      return jsonb_build_object('id',v_job.id,'estado',v_job.estado,'reutilizado',true); end if;
    if v_job.estado='indeterminado' or v_job.iniciado_em is not null then
      return jsonb_build_object('erro','envio_indeterminado'); end if;
    if v_job.proposta_pdf_url is distinct from v_lead.pdf_url
      or v_job.destinatario is distinct from public.destinatario_whatsapp_br(v_lead.whatsapp) then
      return jsonb_build_object('erro','proposta_alterada'); end if;
    if not v_cancelar_auto and (v_job.estado<>'cancelado' or v_job.ultimo_codigo is null or v_job.ultimo_codigo not in
      ('inactivity_recent','inactivity_unverified','proposta_condicao_alterada',
        'historico_em_sincronizacao','historico_incompleto','historico_indisponivel','identidade_nao_confirmada')) then
      return jsonb_build_object('erro','tentativa_encerrada'); end if;
    if v_job.lote_legado_id is not null and not exists(select 1 from public.whatsapp_lote_legado_itens i
      where i.lote_id=v_job.lote_legado_id and i.job_id=v_job.id and i.estado='bloqueado') then
      return jsonb_build_object('erro','tentativa_encerrada'); end if;
    -- Outro clique pode refazer apenas o que NUNCA recebeu started/MCP.
    -- Mantem o ID para evitar qualquer colisao com recibos/ledger ja existentes.
    update public.whatsapp_outbox set lote_legado_id=null,estado='pendente',ocorrido_em=v_agora,expira_em=v_agora+interval '24 hours',
      solicitado_em=v_agora,solicitado_por=p_solicitado_por,entrada_esfriou_automatica_em=null,
      proxima_tentativa_em=v_agora,
      lease_token=null,lease_ate=null,tentativas=0,ultimo_codigo=null,
      historico_verificado_em=null,historico_cobertura_inicio_em=null,ultima_interacao_em=null
      where id=v_job.id;
    return jsonb_build_object('id',v_job.id,'estado','pendente','reutilizado',true);
  end if;
  v_seq:=public.sequencia_lembrete_proposta(v_tipo,v_lead.pdf_url);
  select string_agg(p.value->>'message',E'\n\n' order by p.n) into v_texto
    from jsonb_array_elements(v_seq) with ordinality p(value,n);
  insert into public.whatsapp_outbox(lead_id,tipo,ocorrido_em,expira_em,destinatario,mensagem,sequencia,
    proposta_enviado_em,proposta_pdf_url,solicitado_em,solicitado_por,entrada_esfriou_automatica_em)
  values(p_lead_id,v_tipo,v_ocorrido_em,v_ocorrido_em+interval '24 hours',public.destinatario_whatsapp_br(v_lead.whatsapp),
    v_texto,v_seq,p_proposta_enviado_em,v_lead.pdf_url,v_ocorrido_em,p_solicitado_por,p_entrada_esfriou) returning * into v_job;
  return jsonb_build_object('id',v_job.id,'estado',v_job.estado,'reutilizado',false);
end;
$$;

create or replace function public.enfileirar_lembrete_proposta_whatsapp(
  p_lead_id uuid, p_marco integer, p_proposta_enviado_em timestamptz, p_solicitado_por uuid
)
returns jsonb language sql security invoker set search_path=pg_catalog as $$
  select public.enfileirar_lembrete_proposta_whatsapp_interno(
    p_lead_id,p_marco,p_proposta_enviado_em,p_solicitado_por,null,null);
$$;

create or replace function public.enfileirar_lembretes_proposta_automaticos_whatsapp()
returns integer language plpgsql security invoker set search_path=pg_catalog as $$
declare
  v_agora timestamptz:=statement_timestamp();
  v_ativada_em timestamptz;
  v_candidato record;
  v_resultado jsonb;
  v_total integer:=0;
begin
  perform public.esfriar_leads_parados_whatsapp(v_agora);
  select ativada_em into v_ativada_em from public.whatsapp_lembretes_proposta_config where id=1 and ativa;
  if not found then return 0; end if;

  for v_candidato in
    select l.id,l.enviado_em,l.esfriou_em,c.marco,c.prazo
    from public.leads l
    cross join lateral (
      select 7 as marco,'lembrete_proposta_7d' as tipo,
        greatest(l.enviado_em+interval '168 hours',l.esfriou_em)+interval '15 minutes' as prazo
      union all
      select 30,'lembrete_proposta_30d',
        greatest(l.enviado_em+interval '720 hours',l.esfriou_em,o.enviado_em+interval '360 hours')+interval '15 minutes'
      from public.whatsapp_outbox o
      where o.lead_id=l.id and o.tipo='lembrete_proposta_7d' and o.proposta_enviado_em=l.enviado_em
        and o.estado='enviado' and o.iniciado_em is not null and o.enviado_em is not null
        and o.proposta_pdf_url=l.pdf_url and o.destinatario=public.destinatario_whatsapp_br(l.whatsapp)
    ) c
    where l.status='esfriou' and l.esfriou_em is not null and l.enviado_em is not null
      and c.prazo between v_ativada_em and v_agora
      and c.prazo>v_agora-interval '24 hours'
      and public.recusa_lembrete_proposta_basico_whatsapp(
        l.id,c.tipo,l.enviado_em,l.pdf_url,public.destinatario_whatsapp_br(l.whatsapp),v_agora) is null
      and not exists(select 1 from public.whatsapp_outbox o where o.lead_id=l.id
                     and o.tipo=c.tipo and o.proposta_enviado_em=l.enviado_em)
    order by c.prazo,l.id limit 10 for update of l skip locked
  loop
    v_resultado:=public.enfileirar_lembrete_proposta_whatsapp_interno(
      v_candidato.id,v_candidato.marco,v_candidato.enviado_em,null,v_candidato.esfriou_em,v_candidato.prazo);
    if v_resultado->>'estado'='pendente' then v_total:=v_total+1; end if;
  end loop;
  return v_total;
end;
$$;

revoke execute on function
  public.carimbar_ativacao_lembretes_proposta(),public.registrar_entrada_esfriou(),
  public.esfriar_leads_parados_whatsapp(timestamptz),
  public.recusa_lembrete_proposta_basico_whatsapp(uuid,text,timestamptz,text,text,timestamptz),
  public.recusa_lembrete_proposta_whatsapp(uuid,text,timestamptz,text,text,timestamptz),
  public.enfileirar_lembrete_proposta_whatsapp_interno(uuid,integer,timestamptz,uuid,timestamptz,timestamptz),
  public.enfileirar_lembrete_proposta_whatsapp(uuid,integer,timestamptz,uuid),
  public.enfileirar_lembretes_proposta_automaticos_whatsapp()
  from public,anon,authenticated;
grant execute on function
  public.esfriar_leads_parados_whatsapp(timestamptz),
  public.recusa_lembrete_proposta_basico_whatsapp(uuid,text,timestamptz,text,text,timestamptz),
  public.recusa_lembrete_proposta_whatsapp(uuid,text,timestamptz,text,text,timestamptz),
  public.enfileirar_lembrete_proposta_whatsapp_interno(uuid,integer,timestamptz,uuid,timestamptz,timestamptz),
  public.enfileirar_lembrete_proposta_whatsapp(uuid,integer,timestamptz,uuid),
  public.enfileirar_lembretes_proposta_automaticos_whatsapp()
  to service_role;

commit;
