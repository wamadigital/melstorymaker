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
    // Nao e lido por nenhuma rota: o link do PDF vem do Storage do Supabase.
    // Serve aos scripts (e2e) e fica aqui porque o PRD a lista. Se um dia
    // alguma tela precisar montar URL absoluta, e daqui que ela sai.
    APP_URL: z.string().url(),
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
