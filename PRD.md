# PRD: Sistema de Propostas Automatizadas | Mel Simão Storymaker

| Campo | Valor |
|---|---|
| Versão | 1.0 (MVP) |
| Owner | Henrique |
| Operadora | Mel Simão |
| Prazo | 2 dias |
| Domínio | melstorymaker.com.br (Registro.br) |
| Custo alvo de infra | R$ 0/mês (free tiers, domínio já registrado) |
| Status | Aprovado para desenvolvimento |

---

## 1. Contexto e problema

A Mel é storymaker e recebe todos os leads pelo WhatsApp. Hoje o processo é 100% manual: ela conversa com o lead, coleta as informações do evento uma a uma, abre a proposta padrão no Figma, troca nome, data, local e horário, exporta em PDF e envia por e-mail.

Isso gera três problemas: tempo gasto por lead, risco de erro na personalização (nome errado em proposta é perda de venda) e demora entre o interesse do lead e o recebimento da proposta.

## 2. Objetivo do MVP

Automatizar o caminho entre "lead interessado" e "proposta na caixa de entrada", mantendo a Mel no controle da aprovação final.

Fluxo alvo: Mel envia 1 link pelo WhatsApp > lead preenche formulário em menos de 2 minutos > sistema gera PDF fiel à arte do Figma > Mel revisa e aprova em 2 cliques > proposta chega no e-mail do lead.

## 3. Decisões de produto travadas

Estas decisões já foram tomadas e não devem ser reabertas durante o desenvolvimento:

1. **Figma é fonte de arte, não runtime.** A arte de cada categoria é exportada do Figma como PDF base. O texto dinâmico é aplicado por cima via `pdf-lib` usando coordenadas fixas. Fidelidade 1:1 com o design original, zero dependência de API do Figma.
2. **Human-in-the-loop obrigatório.** Nenhuma proposta sai sem a Mel aprovar no painel admin.
3. **Envio ao lead por e-mail.** Complementado por botão `wa.me` no painel para a Mel encaminhar o link do PDF pelo WhatsApp dela (canal onde o lead já está). Sem API de WhatsApp, custo zero.
4. **E-mail pelo Gmail da Mel, via SMTP.** Nodemailer + App Password, atrás da interface `MailAdapter`. Sem serviço transacional: a conta Google Workspace entrega 2.000 destinatários/dia, muito acima do volume da Mel, e não custa nada. O Google reescreve o remetente para a conta autenticada, então a proposta chega do endereço configurado em `GMAIL_USER`.
5. **Form engine próprio com árvore declarativa em JSON.** Uma pergunta por tela, estilo Typeform, mobile-first. Sem Typeform/mensalidade.
6. **Contato em duas etapas obrigatórias.** WhatsApp com DDD é a primeira pergunta de todo fluxo, para permitir contato mesmo em caso de abandono. O e-mail validado é a última pergunta, necessário para enviar a proposta por e-mail.
7. **Preço e pacotes ficam na arte estática.** Os valores já estão desenhados na proposta de cada categoria. Nenhuma lógica de precificação no MVP.
8. **Lead parcial com telefone é lead.** Escolher a categoria não grava nada. O registro nasce no primeiro avanço, depois de responder um WhatsApp válido, já com essa resposta; os avanços seguintes salvam as respostas parciais para a Mel fazer follow-up.

## 4. Escopo

### Dentro do MVP

1. Formulário público multi-etapas em `/formulario` com 4 categorias (5 artes) e ramificações
2. Autosave de respostas parciais (lead incompleto fica salvo)
3. Painel admin protegido por login para a Mel
4. Geração de PDF personalizado por categoria (arte exportada do Figma + campos dinâmicos)
5. Preview do PDF no painel antes do envio
6. Envio por e-mail com PDF anexo + link
7. Botão de envio via WhatsApp (`wa.me` com mensagem pronta e link do PDF)
8. Edição das respostas do lead pelo painel antes de gerar/regerar o PDF
9. Landing page de venda de casamento em `/casamento` (pedido do owner em 01/10/2026), destino dos anúncios do Instagram: os Reels de casamento da Mel como prova, pacotes sem preço, FAQ e CTA para o formulário em modo casamento (`/formulario?evento=casamento`). Regras em "LP de venda" no CLAUDE.md

### Fora do MVP (v2)

1. Checagem de agenda / conflito de datas
2. Aceite digital da proposta e pagamento (o contrato saiu desta lista em 29/09/2026: ver seção 19, item 3)
3. Notificações em tempo real para a Mel
4. Analytics de funil e abandono por etapa
5. Editor de template para a Mel (arte é controlada pelo Henrique via PR)
6. Tracking de abertura de proposta
7. Multiusuário no admin
8. Upload de arquivos pelo lead
9. Fluxos de consentimento/LGPD (decisão de escopo do owner: não implementar banners nem telas de consentimento)

## 5. Fluxo end-to-end

Quem chega pelo anúncio de casamento passa antes pela LP `/casamento` e entra no formulário por `/formulario?evento=casamento`: as mesmas duas portas, mas "Quero um orçamento" pula a escolha de categoria (vai direto à pergunta do WhatsApp) e "Falar com a Mel" abre o WhatsApp com a mensagem de casamento. O resto do fluxo é o mesmo.

```
[Mel no WhatsApp] envia link melstorymaker.com.br/formulario
        v
[Lead] abre no navegador in-app do WhatsApp (cenário principal: mobile)
        v
Tela de boas-vindas: duas portas
        |                    (esquerda: wa.me da Mel, e o fluxo acaba aqui)
        v
Escolhe categoria          (nada gravado ainda)
        v
Responde o WhatsApp        (lead criado no banco, status: incompleto)
        v
Responde perguntas da categoria (autosave a cada passo)
        v
E-mail
        v
Tela de confirmação        (status: aguardando_revisao)
        v
[Mel no /admin] vê o lead novo > confere/edita respostas > "Gerar proposta"
        v                    (PDF gerado, salvo no Storage, preview no painel)
Mel revisa o PDF > "Enviar por e-mail" e/ou "Enviar via WhatsApp"
        v                    (e-mail marca enviado; WhatsApp só abre a conversa,
                              e a Mel marca como enviado no painel)
[Lead] recebe e-mail com PDF anexo + link
```

## 6. Formulário: árvore de perguntas

Fonte única de verdade em `/lib/form/arvore.json`. O engine renderiza a partir deste JSON. Mudança de pergunta = mudança no JSON, sem refactor.

```json
{
  "boas_vindas": {
    "titulo": "Oi! Eu sou a Mel ✨",
    "texto": "Vamos eternizar o seu momento? Escolhe por onde você prefere começar.",
    "cta_whatsapp": { "rotulo": "Falar com a Mel", "detalhe": "Tirar dúvidas agora, no WhatsApp" },
    "cta_formulario": { "rotulo": "Quero um orçamento", "detalhe": "Proposta agilizada" }
  },
  "categoria": {
    "tipo": "escolha_unica",
    "pergunta": "Que momento vamos eternizar? ✨",
    "opcoes": [
      { "valor": "debutante", "rotulo": "Festa de 15 anos" },
      { "valor": "aniversario", "rotulo": "Aniversário" },
      { "valor": "casamento", "rotulo": "Casamento" },
      { "valor": "corporativo", "rotulo": "Evento corporativo" }
    ]
  },
  "fluxos": {
    "debutante": [
      { "id": "nome", "tipo": "texto", "pergunta": "Como você se chama? ✨", "obrigatorio": true },
      { "id": "debutante", "tipo": "texto", "pergunta": "Nome da debutante ✨", "obrigatorio": true },
      { "id": "data", "tipo": "data", "pergunta": "Data da festa", "obrigatorio": true, "min": "hoje" },
      { "id": "horario", "tipo": "hora", "pergunta": "Horário do convite", "obrigatorio": true, "a_definir": "Decidir isso depois" },
      { "id": "local", "tipo": "texto", "pergunta": "Local da festa", "obrigatorio": true, "a_definir": "Ainda não decidi" },
      { "id": "making_of", "tipo": "escolha_unica", "pergunta": "Quer registrar o making of?", "opcoes": ["Sim", "Não"], "obrigatorio": true },
      { "id": "local_making_of", "tipo": "texto", "pergunta": "Local do making of", "obrigatorio": true, "exibir_se": { "making_of": "Sim" }, "a_definir": "Ainda não decidi" },
      { "id": "entrega", "tipo": "escolha_unica", "pergunta": "Como você prefere a entrega?", "opcoes": ["Em tempo real", "Em até 1 semana"], "obrigatorio": true }
    ],
    "aniversario": [
      { "id": "nome", "tipo": "texto", "pergunta": "Como você se chama? ✨", "obrigatorio": true },
      { "id": "aniversariante", "tipo": "texto", "pergunta": "Nome do(a) aniversariante ✨", "obrigatorio": true },
      { "id": "idade", "tipo": "numero", "pergunta": "Quantos anos vai completar? ✨", "obrigatorio": true, "min": 1, "max": 120 },
      { "id": "data", "tipo": "data", "pergunta": "Data da festa", "obrigatorio": true, "min": "hoje" },
      { "id": "horario", "tipo": "hora", "pergunta": "Horário do convite", "obrigatorio": true, "a_definir": "Decidir isso depois" },
      { "id": "local", "tipo": "texto", "pergunta": "Local da festa", "obrigatorio": true, "a_definir": "Ainda não decidi" },
      { "id": "entrega", "tipo": "escolha_unica", "pergunta": "Como você prefere a entrega?", "opcoes": ["Em tempo real", "Em até 1 semana"], "obrigatorio": true }
    ],
    "casamento": [
      { "id": "nome", "tipo": "texto", "pergunta": "Como você se chama? ✨", "obrigatorio": true },
      { "id": "noivos", "tipo": "texto", "pergunta": "Nome dos noivos ✨", "placeholder": "Ex: Ana & João", "obrigatorio": true },
      { "id": "data", "tipo": "data", "pergunta": "Data do casamento", "obrigatorio": true, "min": "hoje" },
      { "id": "horario", "tipo": "hora", "pergunta": "Horário do convite", "obrigatorio": true, "a_definir": "Decidir isso depois" },
      { "id": "local_cerimonia", "tipo": "texto", "pergunta": "Local da cerimônia", "obrigatorio": true, "a_definir": "Ainda não decidi" },
      { "id": "local_festa", "tipo": "texto", "pergunta": "Local da festa", "obrigatorio": true, "a_definir": "Ainda não decidi" },
      { "id": "making_of", "tipo": "escolha_unica", "pergunta": "Quer registrar o making of?", "opcoes": ["Sim", "Não"], "obrigatorio": true },
      { "id": "local_making_of", "tipo": "texto", "pergunta": "Local do making of", "obrigatorio": true, "exibir_se": { "making_of": "Sim" }, "a_definir": "Ainda não decidi" },
      { "id": "entrega", "tipo": "escolha_unica", "pergunta": "Como você prefere a entrega?", "opcoes": ["Em tempo real", "Em até 1 semana"], "obrigatorio": true }
    ],
    "corporativo": [
      { "id": "nome", "tipo": "texto", "pergunta": "Como você se chama? ✨", "obrigatorio": true },
      { "id": "empresa", "tipo": "texto", "pergunta": "Nome da empresa", "obrigatorio": true },
      { "id": "tipo_evento", "tipo": "texto", "pergunta": "Que tipo de evento vamos cobrir?", "obrigatorio": true },
      { "id": "data", "tipo": "data", "pergunta": "Data do evento", "obrigatorio": true, "min": "hoje" },
      { "id": "horario", "tipo": "hora", "pergunta": "Horário do evento", "obrigatorio": true, "a_definir": "Decidir isso depois" },
      { "id": "local", "tipo": "texto", "pergunta": "Local do evento", "obrigatorio": true, "a_definir": "Ainda não decidi" }
    ]
  },
  "contato": {
    "abertura": [
      { "id": "contato_whatsapp", "tipo": "telefone", "pergunta": "Qual o seu WhatsApp? É por lá que a proposta chega ✨", "obrigatorio": true, "mascara": "(00) 00000-0000" }
    ],
    "fechamento": [
      { "id": "contato_email", "tipo": "email", "pergunta": "E o seu e-mail?", "obrigatorio": true }
    ]
  },
  "confirmacao": {
    "titulo": "Prontinho! ✨",
    "texto": "Recebi tudo com carinho. Em breve sua proposta personalizada chega no seu e-mail.",
    "cta_whatsapp": "Falar com a Mel agora"
  }
}
```

Regras do engine:

1. `exibir_se` define a ramificação: o passo só é renderizado se a condição bater com resposta anterior. Se não bater, o engine pula para o próximo passo do array.
2. A ordem do array é a ordem das telas.
3. `contato` é o bloco que vale para todas as categorias e vem partido em dois: `abertura` entra ANTES do fluxo da categoria, `fechamento` depois dele. A fila de telas é `contato.abertura` + fluxo da categoria + `contato.fechamento`, encerrando em `confirmacao`.
3b. **O WhatsApp é a primeira pergunta de todo fluxo.** É a única resposta que continua servindo quando o lead abandona no meio: perguntado no fim, todo abandono virava um registro que a Mel não tinha como contatar. O e-mail continua fechando, porque só é preciso na hora de enviar a proposta.
4. A tela de abertura tem DUAS portas, não um "Começar": `cta_whatsapp` abre `https://wa.me/{MEL_WHATSAPP}` com a primeira mensagem já escrita, e `cta_formulario` entra na escolha de categoria. Quem já sabe o que quer fala na hora; quem quer número preenche. Sem `MEL_WHATSAPP` configurada, sobra só a segunda porta.
5. `cta_whatsapp` da confirmação abre `https://wa.me/{MEL_WHATSAPP}` (env var), mantendo a conversa quente.
6. **Categoria e arte não são a mesma coisa.** `aniversario` é uma categoria só no banco, mas resolve entre duas artes conforme a resposta de `idade`: **14 anos ou menos = infantil, 15 ou mais = adulto**. São 4 categorias e 5 artes. Acrescentar arte não mexe no enum do Postgres, logo não gera migration.
7. **Horário e local aceitam "decidir depois".** `a_definir` põe embaixo do campo uma caixa com aquele rótulo ("Decidir isso depois" no horário, "Ainda não decidi" nos locais, inclusive o do making of). Marcada, a resposta grava "A definir" e vale como respondida. Existe em todo horário e todo local, e só em perguntas de texto ou hora que não vão para a arte do PDF nem para coluna do banco. Motivo: quem ainda não sabe a hora ou o local travava ali e abandonava o formulário.

## 7. Requisitos funcionais

| ID | Requisito | Critério de aceite |
|---|---|---|
| RF-01 | Formulário público em `/formulario`, sem login | Link abre direto na tela de boas-vindas em qualquer navegador mobile, com as duas portas (falar com a Mel / pedir orçamento) lado a lado |
| RF-02 | O lead nasce quando a pessoa responde o WhatsApp e avança | Escolher a categoria não grava nada; o registro aparece com `status = incompleto`, o WhatsApp no jsonb e a coluna `whatsapp` promovida, já na criação |
| RF-03 | Uma pergunta por tela, avanço por clique ou Enter, botão voltar, barra de progresso | Navegável 100% por teclado no desktop e por toque no mobile |
| RF-04 | Autosave a cada avanço de passo, com recuperação de alterações pendentes | O primeiro avanço exige rede para criar o lead. Depois disso, o rascunho pendente preserva categoria, respostas e passo no mesmo navegador. Na recarga, a retomada consulta o servidor e reaplica o rascunho somente se o lead continua em Novo; uma falha preserva o identificador e oferece retentativa sem criar outro lead. Falha de rede/servidor é tentada novamente ao voltar a conexão ou a aba; conflito entre abas preserva o rascunho e exige escolha explícita. O painel recebe só o estado confirmado, e o envio final aguarda a fila de autosave. Cada confirmação limpa apenas o que foi salvo; submit confirmado limpa somente o rascunho do lead atual |
| RF-05 | Ramificação do making of | Responder "Não" pula direto para a pergunta de entrega; "Sim" exibe o local do making of |
| RF-06 | WhatsApp obrigatório e com máscara BR na primeira pergunta; e-mail obrigatório e validado na última | WhatsApp vazio, DDD ou formato inválido bloqueiam o primeiro avanço; o lead nasce só depois dessa validação. E-mail vazio ou inválido bloqueia a conclusão com mensagem clara |
| RF-07 | Submit final muda status e confirma | `status = aguardando_revisao`, tela de confirmação exibida com CTA de WhatsApp da Mel |
| RF-08 | Admin protegido por login (Supabase Auth), sem tela de signup | Usuária única da Mel criada via seed/dashboard; rota `/admin` inacessível sem sessão |
| RF-09 | Kanban de leads com seis status, busca por nome e filtros por categoria e período de chegada | As raias são Novo, Aguardando revisão, Enviado, Virou cliente, Esfriou e Lead perdido. Os filtros e a busca ficam na URL; o cartão de Novo mostra a pergunta em que o lead parou. Cada raia ordena pela chegada, do mais novo para o mais antigo, e informa quando o teto de 50 cartões corta resultados |
| RF-10 | Detalhe do lead com respostas editáveis | Mel corrige um nome com erro de digitação e salva antes de gerar o PDF |
| RF-11 | Geração de PDF por categoria | Botão "Gerar proposta" aplica os campos dinâmicos no template da categoria, salva no Storage e exibe preview embedado no painel |
| RF-12 | Envio por e-mail | Botão "Enviar por e-mail" dispara mensagem com PDF anexo + link; `status = enviado` com timestamp |
| RF-13 | Envio via WhatsApp | Botão abre `wa.me` com mensagem pré-preenchida + link público do PDF; com número do lead vai direto pro contato, sem número abre o seletor de conversa |
| RF-14 | Regerar PDF após edição | Novo PDF sobrescreve o anterior (mesma URL, cache-bust no preview) |
| RF-15 | Formatação pt-BR no PDF | Data em **DD/MM/AAAA** ("14/03/2026") e horário no padrão "19h30" |
| RF-20 | Cobrança de lead sem retorno: aos 7 dias o lead vai para "Esfriou" (cinza) com "Relembrar cliente"; aos 30, o cartão fica vermelho com "Última tentativa" | Botão abre o WhatsApp do lead com a mensagem e o link da proposta, e carimba o lembrete; cobrado, o cartão silencia e mostra "Lembrado aos N dias". Toda coluna ordena pela chegada do lead, o mais novo em cima. Cartão que ficou em "Enviado" além dos 7 dias por ter tido update aparece azul-claro com "Relembrar cliente" |
| RF-21 | Coluna "Lead perdido" como 6ª raia do quadro | A Mel move o cartão pelo arraste ou pelo menu; nada vira perdido sozinho. No celular a raia nasce recolhida |
| RF-22 | Botão "Chamar no WhatsApp" no lead de "Novo" que deixou telefone | Aparece no cartão do quadro e no detalhe do lead; abre a conversa do lead com a caixa vazia — a Mel escreve manualmente. Some sem telefone, fora de "Novo", e no detalhe quando já há proposta gerada. No cartão do quadro, ao lado do botão, uma caixa "já chamei": a Mel marca depois de chamar, o botão apaga e fica sem link até ela desmarcar |
| RF-23 | Botão "Lembrar por e-mail" no lead de "Novo" que deixou e-mail | Fica no cartão do quadro, embaixo do "Chamar no WhatsApp". O clique da Mel envia na hora um e-mail com o link para continuar o formulário de onde o lead parou (e o WhatsApp da Mel), e o botão trava por 7 dias com "Lembrete enviado · Libera de novo em N dias" — a trava também é conferida no servidor. Nunca sai sem o clique. Some sem e-mail e fora de "Novo" |
| RF-24 | Coluna "Esfriou" (cinza) entre "Virou cliente" e "Lead perdido" | O lead fica no máximo 7 dias em "Enviado": passou disso sem update, vai sozinho para "Esfriou", com "Relembrar cliente"; aos 30 dias do envio o cartão fica vermelho com "Última tentativa". A Mel pode trazê-lo de volta para "Enviado" (ganha mais 7 dias), fechar ou marcar como perdido |

## 8. Painel admin

Rotas:

```
/admin/login          Login (e-mail + senha, Supabase Auth)
/admin                Quadro Kanban de leads
/admin/leads/[id]     Detalhe + ações
```

Quadro (`/admin`):

| Elemento | Comportamento |
|---|---|
| Raias | Novo, Aguardando revisão, Enviado, Virou cliente, Esfriou e Lead perdido, nessa ordem |
| Cartão | Sujeito do evento, categoria, data do evento, data de chegada e sinais de PDF/e-mail/WhatsApp; em Novo, mostra onde o preenchimento parou |
| Busca e filtros | Busca pelo nome do sujeito do evento, categoria e período de chegada (Todo o período, Hoje, Esta semana, Este mês), mantidos na URL. A semana começa na segunda-feira e os cortes usam São Paulo |
| Ordem e limite | Mais novos primeiro em todas as raias; até 50 cartões por raia, com contagem total e aviso quando existem outros resultados |
| Movimentação | Arraste ou menu do cartão; não permite voltar para Novo. Enviado e Esfriou exigem PDF; Cliente e Perdido não exigem. Uma tela desatualizada recebe aviso e recarrega o estado real |
| Desktop e celular | Seis colunas no desktop, duas no tablet e seções recolhíveis empilhadas no celular. Lead perdido começa recolhida no celular; Esfriou começa aberta |
| Cores | Novo em slate, revisão em âmbar, Enviado em azul, Cliente em verde, Esfriou em cinza frio e Perdido em stone. Aos 30 dias do envio, cobrança pendente deixa o cartão vermelho |
| Contato de abandono | Em Novo e com WhatsApp válido, a conversa abre vazia; a caixa “já chamei” silencia o botão. Com e-mail, o lembrete explícito da Mel permite continuar o formulário e trava por sete dias |
| Cobrança da proposta | Somente em Enviado e Esfriou, aos sete e 30 dias do envio. Cobrança marcada silencia o cartão; reenviar por e-mail reinicia a contagem sem apagar os carimbos anteriores, que deixam de silenciar o novo envio |
| Falha de leitura | Cada raia apresenta seu próprio erro e ação de tentar novamente; a falha de uma não derruba as outras |

O quadro executa a passagem de leads parados para Esfriou antes das consultas. A mesma regra roda no cron diário: abrir o painel também atualiza esses status no banco.

Detalhe (`/admin/leads/[id]`):

| Elemento | Comportamento |
|---|---|
| Respostas | Campos editáveis derivados da árvore do formulário e botão Salvar respostas; editar não substitui sozinho o PDF existente |
| Contato | E-mail e WhatsApp do lead; Chamar no WhatsApp somente em Novo, com número válido e sem proposta gerada |
| Proposta | Gerar/Regerar, preview, enviar por e-mail, enviar via WhatsApp e baixar PDF. E-mail exige PDF e endereço cadastrado; WhatsApp da proposta exige PDF |
| Preview | Visualizador nativo em iframe no desktop; PDF paginado em canvas abaixo de 640px, com abertura em tela cheia |
| Histórico | Datas de geração e envio, no fuso de São Paulo |
| Status | Um botão de próximo passo e ação separada de Lead perdido; usam as mesmas regras de movimentação do quadro |
| Contrato | Dados, texto, PDF e assinatura eletrônica, em seção própria; não altera o status do lead automaticamente. Ao terminar a assinatura, oferece mover para Virou cliente |
| Exclusão | Confirmação informa proposta, contrato e arquivos que serão removidos; contrato desconhecido exige aviso conservador sobre assinado, trilha e envio ainda aberto |
| Falha de leitura | Lead ilegível mostra erro e retentativa; lead realmente inexistente retorna 404. Contrato ilegível bloqueia sua seção e mantém lead/proposta acessíveis |

Estados do lead:

| Status | Raia | Entrada e regra |
|---|---|---|
| `incompleto` | Novo | Criado ao responder WhatsApp válido e avançar; somente aqui o formulário público aceita alterações. Nenhum outro estado volta para Novo |
| `aguardando_revisao` | Aguardando revisão | Submit final do lead; a Mel também pode retornar um cartão para revisão pelo quadro |
| `enviado` | Enviado | Envio por e-mail ou marcação manual da Mel após enviar por WhatsApp. Exige PDF; a primeira entrada registra `enviado_em`, e reenviar por e-mail atualiza essa data |
| `virou_cliente` | Virou cliente | Decisão da Mel pelo quadro ou detalhe; permite registrar fechamento sem PDF |
| `esfriou` | Esfriou | Passagem automática quando `enviado_em` e `updated_at` completam sete dias, somente a partir de Enviado; também aceita movimentação manual com PDF. Voltar para Enviado renova o prazo pelo último update |
| `perdido` | Lead perdido | Somente decisão da Mel pelo quadro ou detalhe; nunca é marcado automaticamente |

## 9. Pipeline da proposta (PDF)

### Insumos (exportados do Figma, versionados no repo)

```
/assets/templates/debutante.2026.pdf              arte final, espaços em branco nos campos dinâmicos
/assets/templates/aniversario_infantil.2026.pdf   até 14 anos
/assets/templates/aniversario_adulto.2026.pdf     15 anos ou mais
/assets/templates/casamento.2026.pdf
/assets/templates/corporativo.2026.pdf
/assets/fonts/*.ttf                               Fontes da marca (necessárias pro pdf-lib desenhar texto idêntico ao design)
```

São **5 artes para 4 categorias**: o nome do arquivo é o `TemplateId`, não a categoria.

O sufixo é a **tabela de preço**, e o jogo completo de 5 artes se repete a cada
tabela (`<arte>.<tabela>.pdf`). O preço está desenhado na arte, então reajustar
preço é publicar outra arte — nunca mexer em variável. Qual tabela vale sai do
**ano do evento**; vigências e valores aprovados em `/lib/pdf/precos.ts`.

Exportar do Figma com imagens comprimidas. Alvo: cada PDF base abaixo de 4MB (vai por anexo de e-mail).

### Geração

Biblioteca: `pdf-lib` + `@pdf-lib/fontkit`. Puro JS, roda em serverless da Vercel sem Chromium, geração em menos de 3s.

Config de coordenadas por categoria em `/lib/pdf/templates.config.ts`:

```ts
export const templates: Record<Categoria, TemplateConfig> = {
  debutante: {
    basePdf: "assets/templates/debutante.pdf",
    campos: [
      { chave: "nome",    fonte: "respostas.nome",    pagina: 0, x: 140, y: 520, font: "BrandSerif-Bold", tamanho: 32, cor: "#3A2E2A", maxLargura: 420 },
      { chave: "data",    fonte: "respostas.data",    pagina: 1, x: 90,  y: 610, font: "BrandSans-Regular", tamanho: 14, cor: "#3A2E2A", formato: "data_extenso" },
      { chave: "horario", fonte: "respostas.horario", pagina: 1, x: 90,  y: 580, font: "BrandSans-Regular", tamanho: 14, cor: "#3A2E2A", formato: "hora_br" },
      { chave: "local",   fonte: "respostas.local",   pagina: 1, x: 90,  y: 550, font: "BrandSans-Regular", tamanho: 14, cor: "#3A2E2A", maxLargura: 380 }
    ]
  }
  // aniversario, casamento e corporativo seguem a mesma estrutura,
  // casamento inclui local_cerimonia e local_festa como campos separados
};
```

Notas de implementação (importantes pro agente de código):

1. **Origem do eixo Y no pdf-lib é o canto inferior esquerdo da página.** Coordenadas do Figma (origem superior esquerda) precisam ser convertidas: `y_pdf = alturaPagina - y_figma - tamanhoFonte`.
2. Criar rota de calibração `/admin/debug-template?template=X` que gera o PDF base com um grid de coordenadas a cada 20pt sobreposto. Corta o tempo de ajuste fino de horas para minutos. O parâmetro é o `TemplateId` (5 valores), não a categoria.
3. Registrar fontkit e embutir as fontes da marca antes de desenhar qualquer texto.
4. `maxLargura`: se o texto exceder, reduzir o tamanho da fonte proporcionalmente até caber (nunca quebrar linha em campo de nome).
5. Respostas de `idade`, `making_of` e `entrega` não são impressas no PDF: a idade serve para escolher a arte, as outras aparecem no painel como contexto da Mel. `tipo_evento` (corporativo) É impresso — a arte reserva espaço para ele.
6. A resolução da arte é `resolverTemplateId(categoria, respostas)`, não um acesso direto por categoria. Idade ausente ou ilegível devolve `null` e a geração é **recusada**, em vez de chutar uma arte — o painel mostra à Mel qual arte foi usada quando dá certo, e o que falta quando não dá.
7. **Geração recusa dado incompleto.** Qualquer campo do template sem resposta aborta com HTTP 422 e a lista de perguntas faltantes; nada é gravado. Proposta com espaço em branco no lugar do nome não pode chegar ao lead.

### Armazenamento

Supabase Storage, bucket `propostas` (público). Arquivo: `{leadId}.pdf`. Regerar sobrescreve o mesmo arquivo (URL estável para o link do WhatsApp).

## 10. Envio: e-mail + WhatsApp

### Adapter de e-mail

```ts
interface MailAdapter {
  send(opts: {
    to: string;
    subject: string;
    html: string;
    attachments?: { filename: string; content: Buffer }[];
  }): Promise<void>;
}
```

Implementação única: `GmailAdapter` (Nodemailer, SMTP `smtp.gmail.com:465`, auth via `GMAIL_USER` + `GMAIL_APP_PASSWORD`; exige 2FA ativo na conta Google). A interface existe mesmo com um provider só: é ela que mantém o `DryRunAdapter` como troca de uma linha e permitiria plugar outro serviço sem tocar em nenhuma rota.

**Por que não um serviço transacional:** o volume não justifica. A conta Workspace da Mel entrega 2.000 destinatários/dia; o plano gratuito dos serviços transacionais fica em torno de 100/dia. Reavaliar só se o volume mudar de ordem de grandeza.

**Consequência a conhecer:** o Google reescreve o endereço do remetente para a conta autenticada. O nome de exibição (`Mel Simão | Storymaker`) sobrevive e é o que a maioria dos leads vê na caixa de entrada, mas o endereço será o de `GMAIL_USER`.

### E-mail ao lead

PDF em anexo (`Proposta - Mel Simão.pdf`) + link público do PDF no corpo (redundância caso o anexo caia em filtro).

### Botão WhatsApp no painel

```
https://wa.me/55{whatsapp_lead}?text={mensagem_encoded}
```

Sem número do lead: `https://wa.me/?text={mensagem_encoded}` (abre o seletor de conversas da Mel).

## 11. Modelo de dados

**Fonte de execução:** [supabase/schema.sql](supabase/schema.sql). Esse arquivo contém os enums completos, tabelas, alterações idempotentes para bancos existentes, índices, trigger de `updated_at`, RLS e buckets. Deve ser aplicado manualmente conforme suas instruções; este PRD descreve o uso dos dados e não mantém uma segunda cópia do SQL.

| Grupo | Dados persistidos e finalidade |
|---|---|
| Identidade e datas do lead | `id`, `created_at`, `updated_at`; o trigger atualiza `updated_at` em toda alteração |
| Evento e funil | `categoria` tem quatro valores: `debutante`, `aniversario`, `casamento` e `corporativo`. `status` tem os seis estados da seção 8 |
| Formulário | `respostas` em jsonb e `passo_atual`; armazenam respostas e ponto de retomada do preenchimento |
| Colunas promovidas | `nome_display`, `data_evento`, `email`, `whatsapp`, extraídos das respostas para consulta do painel e contato |
| Proposta | `pdf_url`, `pdf_gerado_em`, `enviado_em`, `slug`; o código curto nasce ao gerar o PDF e mantém o link estável |
| Acompanhamento | `lembrete_7_em`, `lembrete_30_em`, `lembrete_email_em`, `chamado_whatsapp_em`; registram cobranças e ações explícitas da Mel |
| Atribuição Meta | `rastreio` em jsonb com identificadores do navegador/clique, user agent e IP; separado das respostas do formulário |
| Contrato | Uma linha em `contratos` por lead, com dados, documento, avisos, PDF e estado da assinatura. A linha é removida por cascade ao excluir o lead; os arquivos são removidos pela rota admin antes da exclusão |
| Storage | Bucket público `propostas` para os PDFs enviados ao lead; bucket privado `contratos` para rascunho, assinado e trilha, servidos pelas rotas autenticadas do admin |

Regras:

1. **Nenhuma policy pública.** Todo acesso do formulário passa por route handlers do Next.js usando a service role key (server-side). O client nunca fala direto com o Supabase para leads.
2. `respostas` em jsonb: mudanças na árvore de perguntas não exigem migration.
3. `nome_display`, `data_evento`, `email` e `whatsapp` são colunas promovidas, preenchidas junto das respostas na criação e no autosave. O quadro seleciona somente as colunas necessárias para o cartão.
4. Contratos também têm RLS sem policies públicas; os arquivos privados exigem sessão admin e respostas sem cache compartilhado.

## 12. Arquitetura e stack

| Camada | Escolha | Free tier |
|---|---|---|
| Framework | Next.js 14+ (App Router, TypeScript) | n/a |
| Hosting | Vercel Hobby | Suficiente |
| UI | Tailwind + shadcn/ui + Framer Motion (transições do form) | n/a |
| Banco/Auth/Storage | Supabase Free | 500MB DB, 1GB Storage, 50k MAU auth |
| PDF | pdf-lib + @pdf-lib/fontkit | Open source |
| E-mail | Gmail SMTP (Nodemailer), atrás de MailAdapter | Workspace: 2.000 destinatários/dia |
| WhatsApp | Links wa.me | Gratuito |

### Estrutura do repo

```
/app
  /formulario            Form público multi-etapas
  /admin                 Painel (login, quadro Kanban, detalhe)
  /api
    /leads               POST (criar), PATCH [id] (autosave), POST [id]/submit
    /admin/leads/[id]    POST gerar-pdf, POST enviar
/lib
  /form                  arvore.json, engine de renderização
  /pdf                   templates.config.ts, gerar.ts, formatadores pt-BR
  /mail                  adapter.ts, gmail.ts, templates de e-mail
/assets
  /templates             4 PDFs base exportados do Figma
  /fonts                 Fontes da marca
/supabase
  schema.sql
```

### Variáveis de ambiente

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
MAIL_FROM="Mel Simão | Storymaker <mel@wama.digital>"
MAIL_REPLY_TO=
MAIL_DRY_RUN=0
GMAIL_USER=
GMAIL_APP_PASSWORD=
MEL_WHATSAPP=5519XXXXXXXXX
APP_URL=https://melstorymaker.com.br
```

### DNS (painel do Registro.br)

Criar no Dia 1 de manhã, para a propagação correr em paralelo ao desenvolvimento:

1. Apontamento do apex `melstorymaker.com.br` para a Vercel (usar exatamente os registros que o painel da Vercel exibir ao adicionar o domínio ao projeto)
2. `www` com CNAME para a Vercel + redirect www para apex configurado na própria Vercel
3. Nenhum registro de e-mail é necessário: o envio sai pelo Gmail, que não usa o domínio melstorymaker.com.br

Não hardcodar IPs ou valores de DNS em código ou docs: o painel da Vercel é a fonte de verdade.

### Rotas públicas x protegidas

1. `/formulario` e `/api/leads/*`: públicas (rate limit básico por IP nos handlers)
2. `/admin/*` e `/api/admin/*`: middleware exigindo sessão Supabase Auth

## 13. Requisitos não funcionais

1. **Mobile-first real.** Viewport de referência: 360px. Cenário principal de uso é o navegador in-app do WhatsApp (testar nele desde o dia 1, ele tem quirks de viewport e teclado).
2. Performance: LCP < 2.5s em 4G na tela de boas-vindas; zero libs pesadas no bundle do form.
3. Transições entre perguntas suaves (slide + fade, 200-300ms), sem layout shift.
4. Geração de PDF em menos de 10s; PDF final abaixo de 5MB.
5. Idioma: 100% pt-BR, incluindo mensagens de erro e formatação de datas.
6. Estética alinhada à marca da Mel: extrair paleta, tipografia e tom diretamente da arte do Figma. O form é a primeira impressão da experiência de contratação.

## 14. Copies prontas

### E-mail ao lead (categorias pessoais)

Assunto: `Sua proposta chegou, {nome_display} ✨ | Mel Simão Storymaker`

```
Oi, {nome_display}!

Que alegria saber que você quer eternizar esse momento 🤍

Sua proposta personalizada está em anexo (e também nesse link, se preferir: {pdf_url}).

Dá uma olhada com carinho e, se pintar qualquer dúvida, é só me chamar no WhatsApp: {link_whatsapp_mel}

Mal posso esperar pra contar essa história com você!

Com carinho,
Mel Simão | Storymaker
```

### E-mail ao lead (corporativo)

Assunto: `Proposta de cobertura ✨ | Mel Simão Storymaker`

```
Olá!

Obrigada pelo interesse da {nome_display} 🤍

A proposta de cobertura do evento está em anexo (e nesse link: {pdf_url}).

Fico à disposição pra alinhar qualquer detalhe pelo WhatsApp: {link_whatsapp_mel}

Até já,
Mel Simão | Storymaker
```

### Mensagem pré-preenchida do botão WhatsApp (painel)

```
Oi, {primeiro_nome}! ✨ Preparei sua proposta com todo carinho. Dá uma olhada aqui: {pdf_url}

Qualquer dúvida, me chama! 🤍
```

**Quem preenche não é quem o evento homenageia.** A cerimonialista preenche o casamento; a mãe preenche os 15 anos da filha. Por isso são dois conceitos:

- `nome` — **sempre** quem está preenchendo o formulário. Vem depois do WhatsApp no fluxo e identifica quem recebe e lê o e-mail.
- Sujeito do evento — chave própria por categoria, com o mesmo nome da variável na arte do Figma: `{{debutante}}`, `{{aniversariante}}`, `{{noivos}}`, `{{empresa}}`.

Regras derivadas:

- `nome_display` (coluna promovida, quadro do admin e PDF) = **sujeito do evento**. É assim que a Mel identifica um lead: "o casamento da Ana & João".
- Saudação do e-mail e `primeiro_nome` do WhatsApp = **quem preencheu**. "Oi, Lúcia!" funciona seja ela a noiva, a mãe ou a cerimonialista.
- A copy corporativa é a exceção: "Obrigada pelo interesse da {empresa}" usa o sujeito, porque a frase é sobre a empresa.

## 15. Insumos necessários antes de codar (checklist Henrique/Mel)

1. [ ] 5 PDFs base exportados do Figma (com espaços em branco nos campos dinâmicos, < 4MB cada): `debutante`, `aniversario_infantil`, `aniversario_adulto`, `casamento`, `corporativo`
2. [ ] Arquivos .ttf/.otf das fontes da marca
3. [ ] Paleta de cores da marca (hex)
4. [ ] Acesso ao DNS de melstorymaker.com.br no painel do Registro.br
5. [ ] Conta Google da Mel com 2FA ativo + App Password gerada (é por ela que o e-mail sai)
7. [ ] Número de WhatsApp da Mel (formato internacional)
8. [ ] E-mail e senha para a conta admin da Mel no Supabase Auth

## 16. Riscos e mitigação

| Risco | Impacto | Mitigação |
|---|---|---|
| Ajuste fino das coordenadas do texto no PDF consumir tempo | Atraso no D2 | Rota de calibração com grid (item 2 da seção 9); conversão automatizada Figma > pdf-lib |
| PDFs exportados do Figma muito pesados | Anexo rejeitado / e-mail lento | Comprimir imagens no export; fallback: enviar só o link se > 8MB |
| Navegador in-app do WhatsApp com bugs de viewport/teclado | Form quebrado no cenário principal | Testar nele no primeiro deploy, não no último |
| DNS não propagar a tempo (domínio recém-registrado no Registro.br pode levar horas) | Site fora do ar no domínio final | Registros DNS criados logo no Dia 1 de manhã; o envio de e-mail não depende do DNS, porque sai pelo Gmail |
| Texto do lead maior que o espaço da arte (nomes longos) | PDF desalinhado | Auto-shrink de fonte via `maxLargura` |

## 17. Milestones (2 dias)

### Dia 1

Manhã:
1. DNS no Registro.br: apontar melstorymaker.com.br para a Vercel (a propagação corre em paralelo ao resto do dia)
2. Setup do repo (Next + TS + Tailwind + shadcn), projeto Supabase, `schema.sql` aplicado, usuária admin criada
3. Route handlers de leads (criar, autosave, submit) com service role

Tarde:
4. Form engine lendo `arvore.json`: telas, progresso, voltar, transições, `exibir_se`
5. Autosave + retomada via localStorage
6. Etapa de contato com validações
7. Deploy inicial na Vercel com o domínio ativo + teste no navegador do WhatsApp

### Dia 2

Manhã:
8. Export dos 4 PDFs base + fontes no repo
9. Pipeline pdf-lib: config de coordenadas, rota de calibração, geração + upload no Storage
10. Admin: login, lista com filtros, detalhe com edição

Tarde:
11. Preview do PDF, envio por e-mail pelo Gmail, botão wa.me
12. Polimento visual do form (marca da Mel)
13. Teste ponta a ponta das 4 categorias + ramificações
14. Deploy final + walkthrough gravado pra Mel

## 18. Definition of Done

O MVP está pronto quando este cenário roda sem intervenção técnica:

1. Mel envia o link pelo WhatsApp
2. Lead abre no celular, escolhe "Casamento", responde tudo (incluindo making of = Sim) em menos de 2 minutos
3. Lead que abandona no meio aparece no admin como incompleto, com as respostas parciais
4. Lead completo aparece como aguardando revisão
5. Mel loga, corrige um typo no nome dos noivos, gera o PDF e o preview é visualmente idêntico à arte do Figma
6. Mel envia por e-mail: lead recebe com anexo + link
7. Mel clica no botão de WhatsApp e a conversa abre com a mensagem e o link prontos
8. Status do lead vira "enviado" com timestamp
9. Custo de infra do mês: R$ 0

## 19. Roadmap v2 (não implementar agora)

1. Tracking de abertura de e-mail e da proposta (exigiria migrar para um serviço transacional)
2. Aceite da proposta na própria página (proposta como link web, PDF como derivado)
3. Cobrança do sinal (Stripe/Pix). O contrato em si entrou no escopo em 29/09/2026, a pedido do owner: gerado no painel a partir do lead, com IA para as condições especiais e assinatura eletrônica pela iLoveAPI. Regras no CLAUDE.md, regra 8c e seção "Contrato: gotchas obrigatórios".
4. Notificação de novo lead pra Mel
5. Funil de abandono por etapa pra otimizar as perguntas
6. Precificação dinâmica por pacote no formulário
