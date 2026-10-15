-- Única automação aos leads autorizada em 15/10/2026: lembrete do formulário.
-- Aplicar manualmente, em transação, depois de whatsapp-lembrete-formulario.sql.
-- Não ativa flags, não envia mensagens e preserva o histórico já finalizado.

-- Clientes antigos deixam de conseguir criar confirmações, mesmo após rollback.
create or replace function public.registrar_confirmacao_whatsapp(
  p_lead_id uuid, p_destinatario text, p_mensagem text, p_ocorrido_em timestamptz
)
returns uuid language sql security invoker set search_path = pg_catalog
as $$ select null::uuid; $$;
revoke execute on function public.registrar_confirmacao_whatsapp(uuid, text, text, timestamptz)
  from anon, authenticated, public;
grant execute on function public.registrar_confirmacao_whatsapp(uuid, text, text, timestamptz)
  to service_role;

update public.whatsapp_outbox set estado = 'cancelado',
  lease_token = null, lease_ate = null, ultimo_codigo = 'tipo_nao_autorizado'
  where tipo <> 'lembrete_formulario_24h' and estado in ('pendente', 'reservado');

-- Nenhum outro tipo pode entrar ou voltar ao circuito de envio. Registros
-- históricos enviados/indeterminados/cancelados/expirados continuam válidos.
alter table public.whatsapp_outbox drop constraint if exists whatsapp_outbox_somente_lembrete_ativo;
alter table public.whatsapp_outbox add constraint whatsapp_outbox_somente_lembrete_ativo
  check (tipo = 'lembrete_formulario_24h'
    or estado not in ('pendente', 'reservado', 'enviando'));
