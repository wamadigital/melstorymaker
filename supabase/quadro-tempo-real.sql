-- Quadro ao vivo: o banco avisa o painel de que algum lead mudou. Idempotente;
-- pode ir antes ou depois do deploy (sem o SQL o quadro so nao se atualiza
-- sozinho; sem o codigo o aviso sai e ninguem ouve). O mesmo bloco integra
-- schema.sql, fonte completa de execucao manual.
--
-- CAMPAINHA, NAO ENTREGA. O aviso vai vazio (o realtime.send so acrescenta um
-- id aleatorio) e o quadro, ao ouvir, faz router.refresh(): os dados continuam
-- vindo do servidor pela service role, como sempre. Por isso `leads` segue com
-- ZERO policies -- a unica policy nova e de LEITURA em realtime.messages, e so
-- neste topico. Postgres Changes ouvindo `leads` exigiria policy em `leads` e
-- mandaria a linha inteira (respostas, contato, rastreio) pelo WebSocket.
--
-- Topico e evento espelham lib/admin/tempo-real.ts (o teste confere).

create or replace function public.avisar_quadro()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  -- realtime.send ja engole os proprios erros (vira WARNING). Este bloco cobre o
  -- que sobra, como o schema realtime mudar numa atualizacao do Supabase: aviso
  -- perdido e um refresh a menos no quadro, erro aqui derrubaria o formulario.
  begin
    perform realtime.send('{}'::jsonb, 'mudou', 'quadro-leads', true);
  exception when others then
    raise warning 'avisar_quadro: %', sqlerrm;
  end;
  return null;
end;
$$;

revoke execute on function public.avisar_quadro() from anon, authenticated, public;
grant execute on function public.avisar_quadro() to service_role;

-- Por linha, e nao por statement: o trigger de statement dispara tambem quando
-- o UPDATE nao pega linha nenhuma, e o esfriarParados roda a CADA abertura do
-- quadro -- aviso, refresh, esfriar sem linha, aviso... em laco. Varias linhas
-- de uma vez (o esfriar em lote) viram varios avisos, e o quadro junta todos
-- num refresh so.
drop trigger if exists leads_avisar_quadro on public.leads;
create trigger leads_avisar_quadro
  after insert or update or delete on public.leads
  for each row execute function public.avisar_quadro();

-- Quem ouve: qualquer `authenticated`. E mais largo que o painel, que tambem
-- exige a conta no ADMIN_EMAILS (middleware): uma conta fora da lista ouviria
-- a campainha, mas ela sai vazia e o refresh que ela pede passa pelo
-- middleware. Sem policy de INSERT: ninguem do navegador publica neste
-- topico, so o banco.
drop policy if exists "painel ouve o aviso do quadro" on realtime.messages;
create policy "painel ouve o aviso do quadro"
  on realtime.messages
  for select
  to authenticated
  using (realtime.topic() = 'quadro-leads' and extension = 'broadcast');
