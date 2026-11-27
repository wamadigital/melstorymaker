-- Rodar após schema.sql e as duas migrações de Campanhas, somente em banco descartável.
begin;

insert into public.leads(categoria, status, data_evento, whatsapp, qualificado_em, respostas)
values
 ('casamento','enviado','2028-02-01','(19) 98876-3916',now(),'{"nome":"Henrique — fixture"}'),
 ('casamento','enviado','2028-02-29','+55 19 98876-3916',now(),'{}'),
 ('casamento','enviado','2028-02-15','19900000001',now(),'{}'),
 ('casamento','enviado','2028-02-15','19900000002',now(),'{}'),
 ('casamento','enviado','2028-02-15','19900000003',now(),'{}'),
 ('casamento','enviado','2028-02-15','00900000004',now(),'{}'),
 ('casamento','enviado',null,'19900000005',now(),'{}'),
 ('casamento','enviado','2028-02-15','19900000006',null,'{}'),
 ('casamento','perdido','2028-02-15','19900000007',now(),'{}'),
 ('corporativo','enviado','2028-02-15','19900000008',now(),'{}'),
 ('casamento','enviado','2028-03-01','19900000009',now(),'{}');

insert into public.campanha_whatsapp_consentimentos (telefone, autorizado, evidencia, registrado_por)
select telefone, true, 'fixture local', 'b1000000-0000-4000-8000-000000000001'
from unnest(array['5519988763916', '5519900000001', '5519900000002']) telefone;

set local role service_role;
do $$
declare
  filtros jsonb := '{"inicio":"2028-02-01","fim":"2028-02-29","categoria":"casamento","status":"enviado","excluirStatus":"perdido","qualificado":true}';
  autor uuid := 'b1000000-0000-4000-8000-000000000001';
  campanha uuid := 'b1000000-0000-4000-8000-000000000002';
  simulacao uuid := 'b1000000-0000-4000-8000-000000000003';
  teste uuid := 'b1000000-0000-4000-8000-000000000005';
  r jsonb;
  job jsonb;
  novo jsonb;
  c jsonb;
  variante_original int;
  variante_repetida int;
  primeiro_id uuid;
  cancelavel uuid := 'b1000000-0000-4000-8000-000000000004';
begin
  assert not has_function_privilege('anon', 'public.campanha_whatsapp_publico(jsonb,text,int)', 'execute');
  assert not has_table_privilege('authenticated', 'public.campanha_whatsapp_destinatarios', 'select');
  r := public.campanha_whatsapp_publico(filtros, 'real', 0);
  assert r->>'cards' = '6' and r->>'aptos' = '3' and r->>'invalidos' = '1'
    and r->>'duplicados' = '1' and r->>'semConsentimento' = '1', r::text;
  assert public.campanha_whatsapp_publico(filtros || '{"status":"perdido"}', 'real', 0)->>'cards' = '0';
  assert public.campanha_whatsapp_publico(filtros || '{"status":null,"excluirStatus":["perdido","enviado"]}', 'real', 0)->>'cards' = '0';
  assert public.campanha_whatsapp_publico(filtros || '{"status":null,"excluirStatus":["perdido","esfriou"]}', 'real', 0)->>'cards' = '6';
  assert public.campanha_whatsapp_publico(filtros || '{"qualificado":false}', 'real', 0)->>'cards' = '1';
  assert public.campanha_whatsapp_publico(filtros, 'teste', 0)->>'aptos' = '1';

  assert public.campanha_whatsapp_iniciar(campanha, autor, 'Teste isolado', 'real', filtros,
    repeat('0',32), array['A','B'], '[{"nome":"a"},{"nome":"b"}]', null, 5) = 'publico_alterado';
  assert public.campanha_whatsapp_iniciar(campanha, autor, 'Teste isolado', 'real', filtros,
    r->>'revisao', array['A','B'], '[{"nome":"a"},{"nome":"b"}]', null, 5) = 'criada';
  assert public.campanha_whatsapp_iniciar(campanha, autor, 'Repetição da solicitação', 'real', filtros,
    r->>'revisao', array['C'], '[]', null, null) = 'existente';

  -- Um novo lead elegível no Kanban não entra na campanha iniciada.
  insert into public.leads(categoria, status, data_evento, whatsapp, qualificado_em)
    values ('casamento','enviado','2028-02-15','19900000010',now());
  insert into public.campanha_whatsapp_consentimentos (telefone, autorizado, evidencia, registrado_por)
    values ('5519900000010',true,'fixture posterior',autor);
  assert public.campanha_whatsapp_publico(filtros, 'real', 0)->>'aptos' = '4';
  c := public.campanha_whatsapp_progresso(campanha,0)->0;
  assert c#>>'{contadores,total}' = '3' and c#>>'{contadores,pendentes}' = '3';

  -- Retirar consentimento após a revisão exclui o número dos próximos envios.
  update public.campanha_whatsapp_consentimentos set autorizado=false where telefone='5519900000002';
  job := public.campanha_whatsapp_reivindicar(100, 10);
  assert job is not null and job->>'recipient' <> '5519900000002';
  assert public.campanha_whatsapp_reivindicar(100, 10) is null;
  primeiro_id := (job->>'id')::uuid;
  select variante into variante_original from public.campanha_whatsapp_destinatarios where id=primeiro_id;
  assert variante_original in (1,2);
  assert public.campanha_whatsapp_controlar(campanha,'pausar') = 'pausada';
  assert public.campanha_whatsapp_finalizar(primeiro_id,1,'repetir','limite_provedor',null,60);
  assert public.campanha_whatsapp_reivindicar(100,10) is null;
  assert public.campanha_whatsapp_controlar(campanha,'retomar') = 'ativa';
  assert public.campanha_whatsapp_controlar(campanha,'retomar') = 'ativa';
  assert public.campanha_whatsapp_reivindicar(100,10) is null, 'o intervalo persiste após retomada';

  -- Avançar os relógios do banco de teste sem esperar cinco minutos.
  update public.campanhas_whatsapp set proximo_em=now()-interval '1 minute' where id=campanha;
  update public.campanha_whatsapp_tentativas set iniciada_em=now()-interval '1 minute', finalizada_em=now()-interval '1 minute', retomar_em=null;
  assert public.campanha_whatsapp_reivindicar(1,10) is null, 'limite móvel de 24h';
  novo := public.campanha_whatsapp_reivindicar(100,10);
  assert novo->>'id' = job->>'id' and novo->>'tentativa' = '2' and novo->>'message' = job->>'message';
  select variante into variante_repetida from public.campanha_whatsapp_destinatarios where id=primeiro_id;
  assert variante_original = variante_repetida;
  assert not public.campanha_whatsapp_finalizar(primeiro_id,1,'enviado',null,'wamid.obsoleto',0);
  assert public.campanha_whatsapp_finalizar(primeiro_id,2,'enviado',null,'wamid.fixture',0);
  update public.campanhas_whatsapp set proximo_em=now()-interval '1 minute' where id=campanha;
  update public.campanha_whatsapp_tentativas set iniciada_em=now()-interval '1 minute', finalizada_em=now()-interval '1 minute', retomar_em=null;
  novo := public.campanha_whatsapp_reivindicar(100,10);
  assert novo is not null and novo->>'id' <> job->>'id';
  update public.campanha_whatsapp_destinatarios set atualizado_em=now()-interval '3 minutes'
    where id=(novo->>'id')::uuid;
  assert public.campanha_whatsapp_reivindicar(100,10) is null;
  c := public.campanha_whatsapp_progresso(campanha,0)->0;
  assert c->>'status' = 'concluida' and c#>>'{contadores,enviados}' = '1'
    and c#>>'{contadores,falhas}' = '1' and c#>>'{contadores,ignorados}' = '1'
    and c#>>'{contadores,pendentes}' = '0', c::text;

  r := public.campanha_whatsapp_publico(filtros, 'simulacao', 0);
  assert r->>'aptos' = '1';
  assert public.campanha_whatsapp_iniciar(cancelavel, autor, 'Cancelamento', 'simulacao', filtros,
    r->>'revisao', array['Única'], '[]', null, null) = 'criada';
  assert public.campanha_whatsapp_controlar(cancelavel,'cancelar') = 'cancelada';
  assert public.campanha_whatsapp_controlar(cancelavel,'retomar') = 'cancelada';
  assert public.campanha_whatsapp_progresso(cancelavel,0)->0#>>'{contadores,ignorados}' = '1';

  assert public.campanha_whatsapp_iniciar(simulacao, autor, 'Só Henrique', 'simulacao', filtros,
    r->>'revisao', array['Única'], '[]', null, null) = 'criada';
  novo := public.campanha_whatsapp_reivindicar(0,10);
  assert novo->>'modo' = 'simulacao' and novo->>'recipient' = '5519988763916';
  assert public.campanha_whatsapp_finalizar((novo->>'id')::uuid,1,'simulado',null,null,0);
  c := public.campanha_whatsapp_progresso(simulacao,0)->0;
  assert c->>'status' = 'concluida' and c#>>'{contadores,simulados}' = '1'
    and c#>>'{contadores,enviados}' = '0' and c#>>'{historico,0,variante}' = '1', c::text;

  -- Teste direto é independente de cards e usa exatamente a variação do cabeçalho.
  assert public.campanha_whatsapp_iniciar_teste(teste, autor, 'Rascunho', '5519900000077', 'Mensagem escolhida', 2) = 'sem_consentimento';
  assert public.campanha_whatsapp_iniciar_teste(teste, autor, 'Rascunho', '5519988763916', 'Mensagem escolhida', 2) = 'criada';
  assert public.campanha_whatsapp_iniciar_teste(teste, autor, 'Rascunho', '5519988763916', 'Mensagem diferente', 1) = 'existente';
  update public.campanha_whatsapp_tentativas set iniciada_em=now()-interval '1 minute', finalizada_em=now()-interval '1 minute';
  assert public.campanha_whatsapp_reivindicar(0,10) is null;
  job := public.campanha_whatsapp_reivindicar(100,10);
  assert job->>'modo' = 'teste' and job->>'recipient' = '5519988763916' and job->>'message' = 'Mensagem escolhida';
  primeiro_id := (job->>'id')::uuid;
  assert (select lead_id is null from public.campanha_whatsapp_destinatarios where id=primeiro_id);
  assert public.campanha_whatsapp_resultado_worker(primeiro_id,1,'enviado');
  assert public.campanha_whatsapp_resultado_worker(primeiro_id,1,'enviado');
  assert (select tentativas = 1 from public.campanha_whatsapp_destinatarios where id=primeiro_id);
  assert public.campanha_whatsapp_progresso(teste,0)->0#>>'{filtros,mensagem_teste}' = '2';
end;
$$;

rollback;
