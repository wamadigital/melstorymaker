-- Historico WhatsApp ao vivo no Kanban. Aplicar DEPOIS de quadro-tempo-real.sql
-- e whatsapp-outbox.sql, em transacao. O mesmo bloco encerra schema.sql.
-- Reutiliza a campainha privada e vazia: nenhum dado da outbox/lead vai ao canal,
-- nenhuma policy muda, e uma falha do Broadcast nao desfaz o ACK do WhatsApp.
-- ACK repetido, etapas intermediarias e simples correcao de carimbo nao avisam.
drop trigger if exists whatsapp_outbox_avisar_quadro on public.whatsapp_outbox;
create trigger whatsapp_outbox_avisar_quadro
  after update of estado, enviado_em on public.whatsapp_outbox
  for each row
  when (old.estado is distinct from 'enviado'
    and new.estado = 'enviado' and new.enviado_em is not null)
  execute function public.avisar_quadro();
