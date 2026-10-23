-- Eventos anteriores a hoje: encerrar leads comerciais sem apagar dados.
-- Aplicar depois de formulario-orcar.sql; reaplicavel. Nao altera flags, textos,
-- cadencias, recibos ou o registro de clientes/contratos assinados.
begin;

create index if not exists leads_encerrar_eventos_idx
  on public.leads(data_evento,id)
  where data_evento is not null
    and status in ('incompleto','aguardando_revisao','enviado','esfriou');

-- Dia civil de Brasilia; o evento de hoje permanece ativo ate a meia-noite.
create or replace function public.evento_ja_passou(p_data date,p_agora timestamptz)
returns boolean language sql immutable security invoker set search_path=pg_catalog
as $$
  select coalesce(isfinite(p_agora)
    and p_data<(p_agora at time zone 'America/Sao_Paulo')::date,false);
$$;

-- Protege tambem autosave, movimentacao manual e ACK tardio da proposta inicial.
-- O ACK continua registrando o envio real, mas nao reabre um evento encerrado.
create or replace function public.preservar_encerramento_evento()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  if new.status in ('incompleto','aguardando_revisao','enviado','esfriou')
    and public.evento_ja_passou(new.data_evento,statement_timestamp())
    and not exists(select 1 from public.contratos c where c.lead_id=new.id
      and (c.status='assinado' or c.assinatura_status='concluido' or c.assinado_em is not null)) then
    new.status:='perdido';
  end if;
  return new;
end;
$$;
drop trigger if exists leads_preservar_encerramento_evento on public.leads;
create trigger leads_preservar_encerramento_evento
  before insert or update of status,data_evento on public.leads
  for each row execute function public.preservar_encerramento_evento();

-- Assinatura e encerramento usam o MESMO lock do lead. O contrato so vira
-- assinado depois de adquirir esse lock; nao altera o card nem reabre Perdido.
create or replace function public.sincronizar_assinatura_encerramento_evento()
returns trigger language plpgsql security invoker set search_path=pg_catalog
as $$
begin
  if new.status='assinado' or new.assinatura_status='concluido' or new.assinado_em is not null then
    perform 1 from public.leads l where l.id=new.lead_id for update;
  end if;
  return new;
end;
$$;
drop trigger if exists contratos_sincronizar_encerramento_evento on public.contratos;
create trigger contratos_sincronizar_encerramento_evento
  before insert or update of status,assinatura_status,assinado_em on public.contratos
  for each row execute function public.sincronizar_assinatura_encerramento_evento();

create or replace function public.encerrar_eventos_passados()
returns table(id uuid) language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_hoje date:=(statement_timestamp() at time zone 'America/Sao_Paulo')::date;
  v_ids uuid[]; v_candidatos uuid[];
begin
  -- A segunda consulta precisa de snapshot novo apos o lock. PostgREST usa
  -- READ COMMITTED; em isolamento mais forte a RPC recusa em vez de arquivar
  -- com uma visao antiga de um contrato que acabou de ser assinado.
  if current_setting('transaction_isolation')<>'read committed' then
    raise exception 'encerramento_exige_read_committed' using errcode='25000';
  end if;
  -- Mesma ordem do worker: lead -> preparo -> outbox. Um lead ocupado fica
  -- para a proxima rodada; os gates abaixo impedem envio mesmo antes da rodada.
  select coalesce(array_agg(c.id order by c.id),array[]::uuid[]) into v_candidatos from(
    select l.id from public.leads l where l.data_evento<v_hoje
      and l.status in ('incompleto','aguardando_revisao','enviado','esfriou')
      order by l.id for update of l skip locked
  ) c;
  -- Statement separado: contrato confirmado antes de adquirirmos o lock ja
  -- aparece nesta leitura. Se a assinatura vier depois, seu trigger aguarda.
  with encerrados as(
    update public.leads l set status='perdido'
      where l.id=any(v_candidatos) and l.data_evento<v_hoje
        and l.status in ('incompleto','aguardando_revisao','enviado','esfriou')
        and not exists(select 1 from public.contratos ct where ct.lead_id=l.id
          and (ct.status='assinado' or ct.assinatura_status='concluido' or ct.assinado_em is not null))
      returning l.id
  ) select coalesce(array_agg(e.id order by e.id),array[]::uuid[]) into v_ids from encerrados e;
  update public.whatsapp_propostas_automaticas p set estado='cancelada',ultimo_codigo='evento_passado',
    lease_token=null,lease_ate=null where p.lead_id=any(v_ids) and p.estado in ('agendada','gerando','enfileirada')
      and not exists(select 1 from public.whatsapp_outbox o where o.lead_id=p.lead_id
        and o.tipo='proposta_inicial_15m' and o.iniciado_em is not null);
  update public.whatsapp_outbox o set estado='cancelado',ultimo_codigo='evento_passado',
    lease_token=null,lease_ate=null where o.lead_id=any(v_ids)
      and o.estado in ('pendente','reservado') and o.iniciado_em is null;
  -- Nunca mexe em lease/token de envio iniciado; resultados terminais continuam
  -- reconciliaveis e o proximo STARTED revalida a data antes de cada parte.
  return query select unnest(v_ids);
end;
$$;
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

create or replace function public.reivindicar_preparo_proposta_whatsapp(p_ativo boolean)
returns setof public.whatsapp_propostas_automaticas language plpgsql security invoker set search_path=pg_catalog
as $$
declare v_agora timestamptz:=statement_timestamp(); v_lead public.leads%rowtype;
begin
  if p_ativo is not true then return; end if;
  select l.* into v_lead from public.leads l join public.whatsapp_propostas_automaticas p on p.lead_id=l.id
    where l.status::text='aguardando_revisao' and l.enviado_em is null
      and l.origem_formulario<>'orcar'
      and not public.evento_ja_passou(l.data_evento,v_agora)
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
  if public.evento_ja_passou(v_lead.data_evento,v_agora) or v_lead.origem_formulario='orcar' or v_lead.status::text<>'aguardando_revisao' or v_lead.enviado_em is not null
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
  if found and public.evento_ja_passou(l.data_evento,p_agora) then return 'evento_passado'; end if;
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
        and not public.evento_ja_passou(l.data_evento,v_agora)
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
      and o.estado in('pendente','reservado') and (public.evento_ja_passou(l.data_evento,v_agora) or l.status::text<>'incompleto' or l.created_at<p_inicio_em
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
      and not public.evento_ja_passou(l.data_evento,v_agora)
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
  elsif public.evento_ja_passou(l.data_evento,v_agora) then
    v_recusa:='evento_passado';
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

revoke execute on function public.evento_ja_passou(date,timestamptz),
  public.preservar_encerramento_evento(),public.sincronizar_assinatura_encerramento_evento(),
  public.encerrar_eventos_passados(),
  public.recusa_lembrete_proposta_whatsapp(uuid,text,timestamptz,text,text,timestamptz),
  public.reivindicar_preparo_proposta_whatsapp(boolean),
  public.concluir_preparo_proposta_whatsapp(uuid,uuid,text,text,text),
  public.recusa_proposta_inicial_whatsapp(uuid,timestamptz),
  public.enfileirar_lembretes_formulario_whatsapp_v6(timestamptz,jsonb,text),
  public.reivindicar_whatsapp_v6(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v6(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  from public,anon,authenticated;
grant execute on function public.evento_ja_passou(date,timestamptz),
  public.preservar_encerramento_evento(),public.sincronizar_assinatura_encerramento_evento(),
  public.encerrar_eventos_passados(),
  public.recusa_lembrete_proposta_whatsapp(uuid,text,timestamptz,text,text,timestamptz),
  public.reivindicar_preparo_proposta_whatsapp(boolean),
  public.concluir_preparo_proposta_whatsapp(uuid,uuid,text,text,text),
  public.recusa_proposta_inicial_whatsapp(uuid,timestamptz),
  public.enfileirar_lembretes_formulario_whatsapp_v6(timestamptz,jsonb,text),
  public.reivindicar_whatsapp_v6(boolean,timestamptz,boolean,boolean),
  public.resultado_whatsapp_v6(uuid,uuid,text,text,boolean,timestamptz,boolean,boolean,timestamptz,timestamptz,timestamptz,boolean)
  to service_role;
commit;
