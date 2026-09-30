import "server-only";
import { z } from "zod";

// Validar as envs no import quebraria `next build` em qualquer maquina sem
// .env.local. A validacao roda na PRIMEIRA leitura de `env`, ou seja, no
// primeiro request que precisa de fato de uma chave -- com mensagem clara,
// em vez de um `undefined` silencioso na hora de gerar o PDF do primeiro lead.

const schema = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),

    MAIL_FROM: z.string().min(1),
    MAIL_REPLY_TO: z.string().email().optional(),
    // Aceita "1" ou "true": nao depende de como a Vercel serializa o valor.
    MAIL_DRY_RUN: z
      .string()
      .optional()
      .transform((v) => v === "1" || v?.toLowerCase() === "true"),
    GMAIL_USER: z.string().optional(),
    GMAIL_APP_PASSWORD: z.string().optional(),

    MEL_WHATSAPP: z
      .string()
      .regex(/^\d{12,13}$/, "deve ser so digitos com DDI. Ex: 5519999999999"),
    // Base do link publico da proposta (/proposta/{id}.pdf), que vai por
    // WhatsApp para o lead. Se estiver errada, o link chega quebrado no
    // celular de quem recebeu -- em producao precisa ser o dominio real.
    APP_URL: z.string().url(),

    // --- Notificacao de lead novo no WhatsApp da Mel (CallMeBot) -----------
    // Os tres sao opcionais: sem a APIKEY a notificacao simplesmente nao dispara
    // (o submit do lead nunca depende dela). NOTIFICA_DRY_RUN=1 loga a mensagem
    // em vez de enviar -- o padrao do desenvolvimento.
    //
    // NOTIFICA_WHATSAPP_FONE so e necessario para mandar a notificacao para um
    // numero DIFERENTE do MEL_WHATSAPP; sem ele, o adapter usa aquele.
    NOTIFICA_WHATSAPP_FONE: z
      .string()
      .regex(/^\d{12,13}$/, "so digitos com DDI. Ex: 5519999999999")
      .optional(),
    NOTIFICA_WHATSAPP_APIKEY: z.string().min(1).optional(),
    NOTIFICA_DRY_RUN: z
      .string()
      .optional()
      .transform((v) => v === "1" || v?.toLowerCase() === "true"),

    // --- Meta Pixel + Conversions API ---------------------------------------
    // Todos opcionais e SEM validacao de formato aqui, de proposito: um id de
    // Pixel torto nao pode derrubar a validacao inteira e levar junto o PDF e o
    // e-mail. O formato e conferido na hora do uso (`configCapi`, `PixelMeta`),
    // e o que nao bate so desliga a Meta.
    META_PIXEL_ID: z.string().optional(),
    META_CAPI_TOKEN: z.string().optional(),
    META_CAPI_TEST_CODE: z.string().optional(),

    // --- Contrato: IA (Anthropic) --------------------------------------------
    // Opcional: sem ela o painel monta o contrato do mesmo jeito (o nucleo e
    // deterministico) e so desliga as tres ajudas da IA -- preencher quem assina
    // a partir de um texto colado, redigir as condicoes especiais e revisar.
    // Sem `.min(1)` de proposito, como as da Meta: o .env.example traz a linha
    // vazia, e "" aqui precisa significar "desligado", nao derrubar a validacao
    // inteira e levar junto o PDF da proposta e o e-mail.
    ANTHROPIC_API_KEY: z.string().optional(),

    // --- Contrato: assinatura eletronica (iLoveAPI) --------------------------
    // Todas opcionais. Sem a chave publica e com o dry run desligado, o botao
    // "Enviar para assinatura" fica desabilitado com explicacao, e a rota
    // responde 503. A secreta so seria usada para assinar o JWT localmente
    // (hoje o token vem de /v1/auth com a publica); existe aqui para entrar na
    // varredura de segredos do bundle desde ja.
    ILOVEAPI_PUBLIC_KEY: z.string().optional(),
    ILOVEAPI_SECRET_KEY: z.string().optional(),
    // Mesma trava e mesma leitura do MAIL_DRY_RUN ("1" ou "true"): ligado, o
    // envio loga um resumo sem PII e nada sai para o e-mail de ninguem. O
    // .env.example traz 1; na Vercel vai 0.
    ASSINATURA_DRY_RUN: z
      .string()
      .optional()
      .transform((v) => v === "1" || v?.toLowerCase() === "true"),
  })
  // As credenciais do Gmail so sao exigidas quando o envio e real: com
  // MAIL_DRY_RUN=1 o e-mail vai para o log e nao precisa de conta nenhuma.
  .superRefine((env, ctx) => {
    if (env.MAIL_DRY_RUN) return;

    if (!(env.GMAIL_USER && env.GMAIL_APP_PASSWORD)) {
      ctx.addIssue({
        code: "custom",
        path: ["GMAIL_USER"],
        message:
          "GMAIL_USER e GMAIL_APP_PASSWORD sao obrigatorias quando MAIL_DRY_RUN esta desligado",
      });
    }
  });

type Env = z.infer<typeof schema>;

let cache: Env | null = null;

function carregar(): Env {
  if (cache) return cache;

  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const detalhes = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(raiz)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Variaveis de ambiente invalidas:\n${detalhes}\n\nConfira o .env.example.`);
  }

  cache = parsed.data;
  return cache;
}

export const env = new Proxy({} as Env, {
  get: (_alvo, chave: string) => carregar()[chave as keyof Env],
});
