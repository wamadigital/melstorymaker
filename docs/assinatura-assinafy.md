# Assinatura de contratos — Assinafy

Troca autorizada em 20/10/2026. O painel mantém o fluxo: gerar texto, conferir
PDF, conferir destinatários e **Confirmar envio**. Nenhum contrato é enviado por
cron, WhatsApp ou conclusão do formulário.

## Configuração do servidor

| Variável | Uso |
| --- | --- |
| `ASSINATURA_PROVEDOR` | `assinafy` para novos envios; é o default |
| `ASSINAFY_API_KEY` | Chave privada da conta Assinafy, nunca `NEXT_PUBLIC_` |
| `ASSINAFY_ACCOUNT_ID` | ID do workspace da Mel |
| `ASSINAFY_AMBIENTE` | `production` ou `sandbox`, default `production` |
| `ASSINATURA_DRY_RUN` | `1` no desenvolvimento: não faz chamada à plataforma |

A chave do ambiente deve corresponder ao workspace e ao host configurados.
Não colar chaves em issues, PRs, logs ou mensagens. Configurar por canal seguro
nas variáveis do servidor. Preservar `ILOVEAPI_PUBLIC_KEY`/`ILOVEAPI_SECRET_KEY`
para envios anteriores; ausência dessas chaves não libera tokens antigos para
outra plataforma.

Não há migration: provedor e token já são texto no registro privado existente.
Sem credenciais Assinafy, o botão fica indisponível; não existe fallback
silencioso para a iLoveAPI. `ASSINATURA_PROVEDOR=ilovepdf` é rollback explícito
somente para novos envios. Tokens `dry-`, `assinafy-v1|...` e iLove legados
continuam consultados/cancelados no provedor original, independente do seletor.

## Envio e custo

Upload multipart do mesmo PDF cujo SHA foi conferido. Estimativa de custo antes
de criar o convite, signatários correspondidos pelo e-mail exato e confirmação
do nome. Reutilizar cadastro existente sem alterar o nome global de uma pessoa
que já assinou outro contrato. Divergência exige conferência pela operadora.

Assignment `virtual`, `verification_method: Email` e
`notification_methods: [Email]`. A assinatura usa o certificado da plataforma;
não coloca imagens de assinatura nas linhas do PDF original. O certificado é
baixado separadamente. O convite usa a mensagem atual do contrato; a API não
oferece campo de assunto de e-mail nesse endpoint. Validade padrão: 30 dias.

A conta precisa de um documento incluído no plano e estimativa de zero créditos
extras. Recusar quando a estimativa indicar documento adicional ou canal pago.
A API não oferece reserva de franquia ou teto de custo atômico: outros envios
simultâneos no mesmo workspace podem mudar o saldo entre estimativa e pedido.
Não manter recarga automática para este fluxo. O plano grátis anunciado em
20/10/2026 inclui 10 documentos/mês;
o saldo real e a estimativa da conta prevalecem. Não comprar ou fazer upgrade.

Antes do POST de assignment, persistir o token opaco consultável por CAS da
reserva. Se essa gravação falha, não notificar; remover o rascunho quando o
processamento da Assinafy já permite. Escritas não têm retentativa automática.
Timeout, 5xx ou resposta sem confirmação após o POST mantém o pedido reservado
com token para consultar/cancelar, sem anunciar sucesso ou liberar outro envio.

## Consulta, conclusão e cancelamento

A seção consulta ao abrir e pelo botão **Atualizar status**. Sem webhook novo.
A conclusão usa a data da atividade `document_ready`, não `updated_at`.
`certificating` e todos os signatários completos ainda não encerram o contrato.
Somente `certificated` permite baixar os dois PDFs reais e imutáveis:

| Arquivo privado | Artefato da API | Rótulo no painel |
| --- | --- | --- |
| `assinado_path` | `certificated` | Contrato assinado |
| `trilha_path` | `certificate-page` | Certificado de assinatura |

Downloads usam paths fixos no host oficial, sem seguir redirects e sem usar URLs
arbitrárias devolvidas pelo provedor. A chave nunca acompanha redirecionamento.
Cada PDF tem teto de 10 MB, como o bucket privado existente.

Cancelar usa `DELETE /documents/{id}` apenas em estado que permite remoção;
confirmar ausência/encerramento antes de destravar. Documento certificado não
pode ser cancelado. Falha de cancelamento mantém o bloqueio. Contrato não move
o lead de coluna automaticamente nem reinicia o relógio da proposta.

## Validação antes da ativação

Rodar testes offline do adapter, dos dois provedores e do fluxo/CAS, lint,
typecheck e build. Para teste real, usar sandbox e destinatários aprovados,
mediante autorização específica; não enviar contrato de cliente para testar.
Confirmar recebimento, assinatura e download de ambos os PDFs em teste real
antes de declarar o fluxo ponta a ponta validado. Publicação e credenciais
configuradas são estados distintos desse teste.

Fontes oficiais: [API](https://api.assinafy.com.br/v1/docs),
[OpenAPI](https://api.assinafy.com.br/v1/docs/openapi.json),
[SDK](https://github.com/assinafy/typescript-sdk),
[planos](https://www.assinafy.com.br/planos).
