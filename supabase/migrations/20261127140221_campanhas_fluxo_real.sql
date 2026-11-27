begin;

-- A autorização confirmada na revisão pertence à campanha. Não modifica os
-- registros individuais de autorização ou descadastro.
alter table public.campanhas_whatsapp add column autorizacao_confirmada_em timestamptz;

create or replace function public.campanha_whatsapp_publico(p_filtros jsonb, p_modo text, p_pagina int default 0)
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
      and not exists (
        select from jsonb_array_elements_text(case jsonb_typeof(p_filtros->'excluirStatus')
          when 'array' then p_filtros->'excluirStatus'
          when 'string' then jsonb_build_array(p_filtros->'excluirStatus')
          else '[]'::jsonb end) as exclusao(valor)
        where exclusao.valor = l.status::text
      )
      and (p_filtros->>'qualificado' is null or (l.qualificado_em is not null) = (p_filtros->>'qualificado')::boolean)
  ), classificados as (
    select c.id, c.nome, c.telefone, c.telefone_original, c.data_evento, c.status, c.categoria,
      case
        when c.telefone is null then 'invalido'
        when p_modo in ('teste','simulacao') and c.telefone <> '5519988763916' then 'fora_do_teste'
        when p_modo = 'real' and a.autorizado is false then 'descadastrado'
        when p_modo = 'teste' and a.autorizado is distinct from true then 'sem_consentimento'
        when row_number() over (partition by c.telefone order by c.created_at desc, c.id) > 1 then 'duplicado'
        else 'apto'
      end as resultado
    from cards c
    left join public.campanha_whatsapp_consentimentos a on a.telefone = c.telefone
  ), totais as (
    select count(*) as cards,
      count(*) filter (where resultado = 'apto') as aptos,
      count(*) filter (where resultado = 'invalido') as invalidos,
      count(*) filter (where resultado = 'descadastrado') as descadastrados,
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

create or replace function public.campanha_whatsapp_iniciar(
  p_id uuid, p_autor uuid, p_nome text, p_modo text, p_filtros jsonb, p_revisao text,
  p_mensagens text[], p_modelos jsonb, p_imagem text, p_intervalo int
) returns text language plpgsql security invoker set search_path = pg_catalog as $$
declare publico jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_id::text, 142));
  if exists (select from public.campanhas_whatsapp where id = p_id) then return 'existente'; end if;
  if p_modo = 'real' and (p_filtros->'autorizacaoConfirmada') is distinct from 'true'::jsonb
    then return 'confirmacao_necessaria'; end if;
  -- A mesma leitura produz a revisão conferida e as linhas congeladas.
  publico := public.campanha_whatsapp_publico(p_filtros, p_modo, null);
  if publico->>'revisao' is distinct from p_revisao then return 'publico_alterado'; end if;
  if (publico->>'aptos')::int = 0 then return 'sem_destinatarios'; end if;

  insert into public.campanhas_whatsapp(id, nome, modo, filtros, mensagens, modelos, imagem, intervalo_min, criada_por, autorizacao_confirmada_em)
  values (p_id, p_nome, p_modo, p_filtros - 'autorizacaoConfirmada', p_mensagens, p_modelos, p_imagem, p_intervalo, p_autor,
    case when p_modo = 'real' then now() end);

  insert into public.campanha_whatsapp_destinatarios(campanha_id, lead_id, nome, telefone, variante)
  select p_id, d.id, d.nome, d.telefone, 1 + floor(random() * cardinality(p_mensagens))::int
  from jsonb_to_recordset(publico->'itens') as d(id uuid, nome text, telefone text, resultado text)
  where d.resultado = 'apto';
  return 'criada';
end;
$$;

create or replace function public.campanha_whatsapp_reivindicar(p_limite int, p_cadencia int)
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
        and not case when c.modo = 'teste' then public.campanha_whatsapp_teste_autorizado(de.telefone)
          else coalesce((select a.autorizado from public.campanha_whatsapp_consentimentos a
            where a.telefone = de.telefone), c.autorizacao_confirmada_em is not null) end;
    -- O modo antigo com anexo não é convertido em um texto que o usuário não revisou.
    if c.imagem is not null then
      update public.campanha_whatsapp_destinatarios set status = 'ignorado', motivo = 'formato_anterior', atualizado_em = agora
        where campanha_id = c.id and status = 'pendente';
    end if;
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
  return jsonb_build_object('id', d.id, 'tentativa', d.tentativas, 'recipient', d.telefone,
    'modo', c.modo, 'message', c.mensagens[d.variante], 'expiresAt', agora + interval '75 seconds');
end;
$$;

-- Testes antigos permanecem acessíveis pelo histórico individual.
create or replace function public.campanha_whatsapp_progresso(p_id uuid, p_pagina int, p_limite int default 0, p_cadencia int default 60)
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
  from (select * from public.campanhas_whatsapp where (p_id is null and modo = 'real') or id = p_id
    order by criada_em desc, id desc limit 26
    offset case when p_id is null then p_pagina::bigint * 25 else 0 end) c cross join limite;
$$;

commit;
