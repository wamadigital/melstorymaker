-- Copy aprovada em 15/10/2026: terceira mensagem passa a
-- "Suas respostas estao salvas, acesse o link:" (texto exato abaixo).
-- Aplicar manualmente apos whatsapp-somente-lembrete.sql (transacao incluida).
-- Nao ativa flags, nao enfileira leads e nao altera snapshots ja finalizados.
-- A troca e atomica para inserts/claims/ACKs concorrentes.
begin;
lock table public.whatsapp_outbox in share row exclusive mode;
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_sequencia_check;

-- Snapshot aprovado: chaves, textos, pausas e URL individual sao fechados.
-- Extracao JSON tolera entradas malformadas sem casts/erros em CHECK/RPC.
create or replace function public.sequencia_lembrete_formulario_valida(
  p_sequencia jsonb, p_lead_id uuid, p_mensagem text
)
returns boolean
language plpgsql immutable security invoker
set search_path = pg_catalog
as $$
declare
  v_link text := p_sequencia #>> '{3,message}';
  v_aprovadas jsonb := jsonb_build_array(
    jsonb_build_object('message', 'Olá! Aqui é a Mel Storymaker 👋', 'delayBeforeSeconds', 0),
    jsonb_build_object('message', 'Ficou alguma dúvida para finalizar o formulário? Se precisar de ajuda, pode me chamar por aqui 😊', 'delayBeforeSeconds', 2),
    jsonb_build_object('message', 'Suas respostas estão salvas, acesse o link:', 'delayBeforeSeconds', 3));
begin
  return coalesce(
    v_link ~ ('^https://[^[:space:]/?#@]+/continuar/' || p_lead_id::text || '$')
    and p_sequencia = v_aprovadas || jsonb_build_array(
      jsonb_build_object('message', v_link, 'delayBeforeSeconds', 2))
    and p_mensagem = (p_sequencia #>> '{0,message}') || E'\n\n'
      || (p_sequencia #>> '{1,message}') || E'\n\n'
      || (p_sequencia #>> '{2,message}') || E'\n\n' || v_link
    and length(p_mensagem) between 1 and 2000, false);
end;
$$;
revoke execute on function public.sequencia_lembrete_formulario_valida(jsonb, uuid, text)
  from anon, authenticated, public;
grant execute on function public.sequencia_lembrete_formulario_valida(jsonb, uuid, text) to service_role;

-- Snapshots antigos nao voltam ao circuito de envio. Nao reescrever texto,
-- sequencia ou carimbos historicos. Um envio antigo iniciado fica indeterminado
-- com o MESMO token, para aceitar apenas o ACK tardio, sem continuar a sequencia.
update public.whatsapp_outbox set estado = 'cancelado',
  lease_token = null, lease_ate = null, ultimo_codigo = 'copy_lembrete_substituida'
  where tipo = 'lembrete_formulario_24h' and estado in ('pendente', 'reservado')
    and not public.sequencia_lembrete_formulario_valida(sequencia, lead_id, mensagem);
update public.whatsapp_outbox set estado = 'indeterminado',
  ultimo_codigo = 'copy_lembrete_substituida'
  where tipo = 'lembrete_formulario_24h' and estado = 'enviando'
    and not public.sequencia_lembrete_formulario_valida(sequencia, lead_id, mensagem);
-- Somente a copy atual e aceita em qualquer estado ativo. A excecao e apenas
-- historica/terminal: nao torna a copy antiga valida para INSERT/claim/started.
alter table public.whatsapp_outbox add constraint whatsapp_outbox_sequencia_check check (
  (tipo = 'confirmacao_recebimento' and sequencia is null)
  or (tipo = 'lembrete_formulario_24h' and (
    estado not in ('pendente', 'reservado', 'enviando')
    or public.sequencia_lembrete_formulario_valida(sequencia, lead_id, mensagem))));

commit;
