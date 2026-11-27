begin;

-- Consentimento é por telefone e nunca é inferido de um orçamento.
create table public.campanha_whatsapp_consentimentos (
  telefone text primary key check (public.destinatario_whatsapp_br(telefone) is not distinct from telefone),
  autorizado boolean not null,
  evidencia text not null check (length(btrim(evidencia)) between 1 and 500),
  registrado_por uuid not null,
  registrado_em timestamptz not null default now()
);

create table public.campanhas_whatsapp (
  id uuid primary key,
  nome text not null check (length(btrim(nome)) between 1 and 120),
  modo text not null check (modo in ('simulacao','teste','real')),
  status text not null default 'ativa' check (status in ('ativa','pausada','cancelada','concluida')),
  filtros jsonb not null,
  mensagens text[] not null check (cardinality(mensagens) > 0),
  modelos jsonb not null default '[]',
  imagem text,
  intervalo_min int check (intervalo_min between 1 and 30),
  proximo_em timestamptz not null default now(),
  criada_em timestamptz not null default now(),
  criada_por uuid not null
);

create table public.campanha_whatsapp_destinatarios (
  id uuid primary key default gen_random_uuid(),
  campanha_id uuid not null references public.campanhas_whatsapp(id),
  lead_id uuid not null, -- Snapshot preservado mesmo quando o card é excluído.
  nome text,
  telefone text not null,
  variante int not null check (variante > 0),
  status text not null default 'pendente'
    check (status in ('pendente','processando','enviado','simulado','falha','ignorado')),
  tentativas int not null default 0,
  atualizado_em timestamptz,
  motivo text,
  provedor_id text,
  unique (campanha_id, telefone)
);

create table public.campanha_whatsapp_tentativas (
  destinatario_id uuid not null references public.campanha_whatsapp_destinatarios(id),
  tentativa int not null,
  modo text not null,
  iniciada_em timestamptz not null,
  resultado text,
  motivo text,
  finalizada_em timestamptz,
  retomar_em timestamptz,
  primary key (destinatario_id, tentativa)
);

create index campanha_whatsapp_criadas_idx on public.campanhas_whatsapp(criada_em desc, id desc);
create index campanha_whatsapp_ativas_idx on public.campanhas_whatsapp(proximo_em, criada_em) where status = 'ativa';
create index campanha_whatsapp_fila_idx on public.campanha_whatsapp_destinatarios(campanha_id, status, id);
create index campanha_whatsapp_processando_idx on public.campanha_whatsapp_destinatarios(atualizado_em) where status = 'processando';
create index campanha_whatsapp_limites_idx on public.campanha_whatsapp_tentativas(coalesce(finalizada_em,iniciada_em) desc) where modo <> 'simulacao';
create index campanha_whatsapp_backoff_idx on public.campanha_whatsapp_tentativas(retomar_em desc) where retomar_em is not null;
create index if not exists leads_data_evento_campanhas_idx on public.leads(data_evento) where data_evento is not null;

alter table public.campanha_whatsapp_consentimentos enable row level security;
alter table public.campanhas_whatsapp enable row level security;
alter table public.campanha_whatsapp_destinatarios enable row level security;
alter table public.campanha_whatsapp_tentativas enable row level security;

revoke all on public.campanha_whatsapp_consentimentos, public.campanhas_whatsapp,
  public.campanha_whatsapp_destinatarios, public.campanha_whatsapp_tentativas from public, anon, authenticated;
grant select, insert, update on public.campanha_whatsapp_consentimentos, public.campanhas_whatsapp,
  public.campanha_whatsapp_destinatarios, public.campanha_whatsapp_tentativas to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('campanhas-whatsapp', 'campanhas-whatsapp', false, 3000000, array['image/jpeg','image/png']);

create function public.campanha_whatsapp_publico(p_filtros jsonb, p_modo text, p_pagina int default 0)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  with cards as (
    select l.id, coalesce(nullif(btrim(l.respostas->>'nome'), ''), l.nome_display) as nome,
      public.destinatario_whatsapp_br(l.whatsapp) as telefone, l.whatsapp as telefone_original,
      l.data_evento, l.status, l.categoria,
      l.created_at
    from public.leads l
    where l.data_evento is not null
      and (p_filtros->>'inicio' is null or l.data_evento >= (p_filtros->>'inicio')::date)
      and (p_filtros->>'fim' is null or l.data_evento <= (p_filtros->>'fim')::date)
      and (p_filtros->>'categoria' is null or l.categoria = (p_filtros->>'categoria')::public.lead_categoria)
      and (p_filtros->>'status' is null or l.status = (p_filtros->>'status')::public.lead_status)
      and (p_filtros->>'excluirStatus' is null or l.status <> (p_filtros->>'excluirStatus')::public.lead_status)
      and (p_filtros->>'qualificado' is null or (l.qualificado_em is not null) = (p_filtros->>'qualificado')::boolean)
  ), classificados as (
    select c.id, c.nome, c.telefone, c.telefone_original, c.data_evento, c.status, c.categoria,
      case
        when c.telefone is null then 'invalido'
        when p_modo in ('teste','simulacao') and c.telefone <> '5519988763916' then 'fora_do_teste'
        when p_modo <> 'simulacao' and a.autorizado is distinct from true then 'sem_consentimento'
        when row_number() over (partition by c.telefone order by c.created_at desc, c.id) > 1 then 'duplicado'
        else 'apto'
      end as resultado
    from cards c
    left join public.campanha_whatsapp_consentimentos a on a.telefone = c.telefone
  ), totais as (
    select count(*) as cards,
      count(*) filter (where resultado = 'apto') as aptos,
      count(*) filter (where resultado = 'invalido') as invalidos,
      count(*) filter (where resultado = 'sem_consentimento') as "semConsentimento",
      count(*) filter (where resultado = 'duplicado') as duplicados,
      count(*) filter (where resultado = 'fora_do_teste') as "foraDoTeste",
      md5(coalesce(string_agg(jsonb_build_array(id,nome,telefone)::text, ',' order by id)
        filter (where resultado = 'apto'), '')) as revisao
    from classificados
  )
  select to_jsonb(totais) || jsonb_build_object(
    'itens', coalesce((
      select jsonb_agg(to_jsonb(p) order by (p.resultado <> 'apto'), p.data_evento, p.id)
      from (
        select * from classificados where p_pagina is not null or resultado = 'apto'
        order by (resultado <> 'apto'), data_evento, id
        limit case when p_pagina is not null then 25 end offset coalesce(p_pagina, 0)::bigint * 25
      ) p
    ), '[]'::jsonb)
  )
  from totais;
$$;

create function public.campanha_whatsapp_iniciar(
  p_id uuid, p_autor uuid, p_nome text, p_modo text, p_filtros jsonb, p_revisao text,
  p_mensagens text[], p_modelos jsonb, p_imagem text, p_intervalo int
) returns text language plpgsql security invoker set search_path = pg_catalog as $$
declare publico jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 142));
  if exists (select from public.campanhas_whatsapp where id = p_id) then return 'existente'; end if;
  -- A mesma leitura produz a revisão conferida e as linhas congeladas.
  publico := public.campanha_whatsapp_publico(p_filtros, p_modo, null);
  if publico->>'revisao' is distinct from p_revisao then return 'publico_alterado'; end if;
  if (publico->>'aptos')::int = 0 then return 'sem_destinatarios'; end if;

  insert into public.campanhas_whatsapp(id, nome, modo, filtros, mensagens, modelos, imagem, intervalo_min, criada_por)
  values (p_id, p_nome, p_modo, p_filtros, p_mensagens, p_modelos, p_imagem, p_intervalo, p_autor);

  insert into public.campanha_whatsapp_destinatarios(campanha_id, lead_id, nome, telefone, variante)
  select p_id, d.id, d.nome, d.telefone, 1 + floor(random() * cardinality(p_mensagens))::int
  from jsonb_to_recordset(publico->'itens') as d(id uuid, nome text, telefone text, resultado text)
  where d.resultado = 'apto';
  return 'criada';
end;
$$;

-- Espaçamento e orçamento compartilhados pelo mesmo remetente, inclusive para campanhas recém-criadas.
create function public.campanha_whatsapp_limite_disponivel(p_limite int, p_cadencia int, p_agora timestamptz)
returns timestamptz language sql stable security invoker set search_path = pg_catalog as $$
  select case when p_limite > 0 then greatest(
    p_agora,
    (select coalesce(finalizada_em,iniciada_em) + make_interval(secs => greatest(10,p_cadencia))
      from public.campanha_whatsapp_tentativas where modo <> 'simulacao'
      order by coalesce(finalizada_em,iniciada_em) desc limit 1),
    (select coalesce(finalizada_em,iniciada_em) + interval '24 hours' from public.campanha_whatsapp_tentativas
      where modo <> 'simulacao' and coalesce(finalizada_em,iniciada_em) > p_agora - interval '24 hours'
      order by coalesce(finalizada_em,iniciada_em) desc limit 1 offset greatest(0,p_limite - 1)),
    (select retomar_em from public.campanha_whatsapp_tentativas where retomar_em is not null
      order by retomar_em desc limit 1)
  ) end;
$$;

create function public.campanha_whatsapp_progresso(p_id uuid, p_pagina int, p_limite int default 0, p_cadencia int default 60)
returns jsonb language sql stable security invoker set search_path = pg_catalog as $$
  with limite as materialized (
    select public.campanha_whatsapp_limite_disponivel(p_limite,p_cadencia,now()) as disponivel
  )
  select coalesce(jsonb_agg(to_jsonb(c) - 'criada_por' - 'modelos' - 'imagem' ||
      jsonb_build_object('tem_imagem', c.imagem is not null,
        'proximo_em', case when c.status <> 'ativa' then null
          when c.modo = 'simulacao' then greatest(c.proximo_em,now())
          when limite.disponivel is not null then greatest(c.proximo_em,limite.disponivel) end,
        'contadores', (select jsonb_build_object(
          'total', count(*),
          'enviados', count(*) filter (where status = 'enviado'),
          'simulados', count(*) filter (where status = 'simulado'),
          'pendentes', count(*) filter (where status in ('pendente','processando')),
          'processando', count(*) filter (where status = 'processando'),
          'falhas', count(*) filter (where status = 'falha'),
          'ignorados', count(*) filter (where status = 'ignorado'))
          from public.campanha_whatsapp_destinatarios where campanha_id = c.id),
        'historico', case when p_id is not null then (
          select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]')
          from (
            select x.*, (select coalesce(jsonb_agg(to_jsonb(t) - 'destinatario_id' - 'modo' - 'retomar_em'
                order by t.tentativa), '[]')
              from public.campanha_whatsapp_tentativas t where t.destinatario_id = x.id) as eventos
            from (select id, nome, telefone, variante, status, tentativas, atualizado_em, motivo
              from public.campanha_whatsapp_destinatarios where campanha_id = c.id
              order by id limit 25 offset p_pagina::bigint * 25) x
          ) d
        ) else '[]'::jsonb end
      ) order by c.criada_em desc, c.id desc), '[]')
  from (select * from public.campanhas_whatsapp where p_id is null or id = p_id
    order by criada_em desc, id desc limit 26
    offset case when p_id is null then p_pagina::bigint * 25 else 0 end) c cross join limite;
$$;

create function public.campanha_whatsapp_controlar(p_id uuid, p_acao text)
returns text language plpgsql security invoker set search_path = pg_catalog as $$
declare atual text;
begin
  select status into atual from public.campanhas_whatsapp where id = p_id for update;
  if not found then return null; end if;
  if p_acao = 'pausar' and atual = 'ativa' then
    atual := 'pausada';
  elsif p_acao = 'retomar' and atual = 'pausada' then
    atual := 'ativa';
  elsif p_acao = 'cancelar' and atual in ('ativa','pausada') then
    atual := 'cancelada';
    update public.campanha_whatsapp_destinatarios
      set status = 'ignorado', motivo = 'cancelado', atualizado_em = now()
      where campanha_id = p_id and status = 'pendente';
  end if;
  update public.campanhas_whatsapp set status = atual where id = p_id;
  return atual;
end;
$$;

-- Cada autorização de envio é consumida antes do POST ao provedor.
-- Se o worker parar após a reserva, o resultado fica indeterminado e não é reenviado.
create function public.campanha_whatsapp_reivindicar(p_limite int, p_cadencia int)
returns jsonb language plpgsql security invoker set search_path = pg_catalog as $$
declare
  c public.campanhas_whatsapp;
  d public.campanha_whatsapp_destinatarios;
  agora timestamptz := clock_timestamp();
  disponivel timestamptz;
begin
  if not pg_try_advisory_xact_lock(389412117) then return null; end if;
  -- Trava sempre campanha antes de destinatários, inclusive no resgate.
  for c in select ca.* from public.campanhas_whatsapp ca
    where exists (select from public.campanha_whatsapp_destinatarios de
      where de.campanha_id = ca.id and de.status = 'processando'
        and de.atualizado_em < agora - interval '2 minutes') for update of ca skip locked
  loop
    with expirados as (
      update public.campanha_whatsapp_destinatarios
        set status = 'falha', motivo = 'resultado_indeterminado', atualizado_em = agora
        where campanha_id = c.id and status = 'processando' and atualizado_em < agora - interval '2 minutes'
        returning id, tentativas
    )
    update public.campanha_whatsapp_tentativas t
      set resultado = 'falha', motivo = 'resultado_indeterminado', finalizada_em = agora
      from expirados e where t.destinatario_id = e.id and t.tentativa = e.tentativas;
    if c.status in ('ativa','pausada') and not exists (select from public.campanha_whatsapp_destinatarios
      where campanha_id = c.id and status in ('pendente','processando')) then
      update public.campanhas_whatsapp set status = 'concluida' where id = c.id;
    elsif c.status in ('ativa','pausada') then
      update public.campanhas_whatsapp set proximo_em = agora + make_interval(mins => coalesce(c.intervalo_min,0))
        where id = c.id;
    end if;
  end loop;

  if exists (select from public.campanha_whatsapp_destinatarios where status = 'processando') then
    return null;
  end if;
  disponivel := public.campanha_whatsapp_limite_disponivel(p_limite,p_cadencia,agora);
  select ca.* into c from public.campanhas_whatsapp ca
    where ca.status = 'ativa' and ca.proximo_em <= agora
    and (ca.modo = 'simulacao' or disponivel <= agora)
    order by ca.proximo_em, ca.criada_em, ca.id limit 1 for update skip locked;
  if not found then return null; end if;

  if c.modo <> 'simulacao' then
    update public.campanha_whatsapp_destinatarios de
      set status = 'ignorado', motivo = 'consentimento_revogado', atualizado_em = agora
      where de.campanha_id = c.id and de.status = 'pendente'
        and not exists (select from public.campanha_whatsapp_consentimentos a
          where a.telefone = de.telefone and a.autorizado);
  end if;

  select * into d from public.campanha_whatsapp_destinatarios
    where campanha_id = c.id and status = 'pendente' order by id limit 1 for update;
  if not found then
    update public.campanhas_whatsapp set status = 'concluida' where id = c.id;
    return null;
  end if;
  update public.campanha_whatsapp_destinatarios
    set status = 'processando', tentativas = tentativas + 1, atualizado_em = agora, motivo = null
    where id = d.id returning * into d;
  insert into public.campanha_whatsapp_tentativas(destinatario_id, tentativa, modo, iniciada_em)
    values (d.id, d.tentativas, c.modo, agora);
  update public.campanhas_whatsapp set proximo_em = agora + make_interval(mins => coalesce(c.intervalo_min,0))
    where id = c.id;
  return jsonb_build_object('id', d.id, 'tentativa', d.tentativas, 'telefone', d.telefone,
    'modo', c.modo, 'modelo', c.modelos->(d.variante - 1), 'imagem', c.imagem);
end;
$$;

create function public.campanha_whatsapp_finalizar(
  p_id uuid, p_tentativa int, p_status text, p_motivo text, p_provedor_id text, p_espera int
) returns boolean language plpgsql security invoker set search_path = pg_catalog as $$
declare
  c public.campanhas_whatsapp;
  resultado text := p_status;
  motivo_resultado text := p_motivo;
  agora timestamptz := clock_timestamp();
begin
  select ca.* into c from public.campanhas_whatsapp ca
    join public.campanha_whatsapp_destinatarios d on d.campanha_id = ca.id
    where d.id = p_id for update of ca;
  if p_status = 'repetir' then
    resultado := case when c.status = 'cancelada' then 'ignorado'
      when p_tentativa >= 3 then 'falha' else 'pendente' end;
    if resultado = 'ignorado' then motivo_resultado := 'cancelado'; end if;
  end if;
  update public.campanha_whatsapp_destinatarios
    set status = resultado, motivo = motivo_resultado, provedor_id = p_provedor_id, atualizado_em = agora
    where id = p_id and status = 'processando' and tentativas = p_tentativa;
  if not found then return false; end if;
  update public.campanha_whatsapp_tentativas set resultado = p_status, motivo = p_motivo, finalizada_em = agora,
    retomar_em = case when p_status = 'repetir'
      then agora + make_interval(secs => greatest(60,p_espera)) end
    where destinatario_id = p_id and tentativa = p_tentativa;

  if c.status in ('ativa','pausada') then
    if exists (select from public.campanha_whatsapp_destinatarios where campanha_id = c.id and status = 'pendente') then
      update public.campanhas_whatsapp set proximo_em = agora + make_interval(mins => coalesce(c.intervalo_min,0))
        where id = c.id;
    else
      update public.campanhas_whatsapp set status = 'concluida' where id = c.id;
    end if;
  end if;
  return true;
end;
$$;

revoke execute on function
  public.campanha_whatsapp_publico(jsonb,text,int),
  public.campanha_whatsapp_iniciar(uuid,uuid,text,text,jsonb,text,text[],jsonb,text,int),
  public.campanha_whatsapp_limite_disponivel(int,int,timestamptz),
  public.campanha_whatsapp_progresso(uuid,int,int,int),
  public.campanha_whatsapp_controlar(uuid,text),
  public.campanha_whatsapp_reivindicar(int,int),
  public.campanha_whatsapp_finalizar(uuid,int,text,text,text,int)
  from public, anon, authenticated;
grant execute on function
  public.campanha_whatsapp_publico(jsonb,text,int),
  public.campanha_whatsapp_iniciar(uuid,uuid,text,text,jsonb,text,text[],jsonb,text,int),
  public.campanha_whatsapp_limite_disponivel(int,int,timestamptz),
  public.campanha_whatsapp_progresso(uuid,int,int,int),
  public.campanha_whatsapp_controlar(uuid,text),
  public.campanha_whatsapp_reivindicar(int,int),
  public.campanha_whatsapp_finalizar(uuid,int,text,text,text,int)
  to service_role;

commit;
