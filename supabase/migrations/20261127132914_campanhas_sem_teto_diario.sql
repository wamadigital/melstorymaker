begin;

-- p_limite passa a indicar somente disponibilidade (> 0). A assinatura
-- existente mantém a aplicação compatível durante a publicação.
create or replace function public.campanha_whatsapp_limite_disponivel(
  p_limite int, p_cadencia int, p_agora timestamptz
)
returns timestamptz language sql stable security invoker set search_path = pg_catalog as $$
  select case when p_limite > 0 then greatest(
    p_agora,
    (select coalesce(finalizada_em,iniciada_em) + make_interval(secs => greatest(10,p_cadencia))
      from public.campanha_whatsapp_tentativas where modo <> 'simulacao'
      order by coalesce(finalizada_em,iniciada_em) desc limit 1),
    (select retomar_em from public.campanha_whatsapp_tentativas where retomar_em is not null
      order by retomar_em desc limit 1)
  ) end;
$$;

commit;
