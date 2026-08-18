#!/usr/bin/env bash
#
# Envia as variáveis do .env.local para a Vercel, com os overrides de produção.
#
#   vercel login          # uma vez, abre o navegador
#   npm run vercel:env
#
# Overrides aplicados de propósito (o resto vai igual ao .env.local):
#   MAIL_DRY_RUN=0        em produção o e-mail sai de verdade
#   APP_URL               o domínio final, não o localhost
#
# Idempotente: remove a variável antes de recriar, então rodar de novo
# atualiza em vez de duplicar.

set -euo pipefail

PROJETO="melstorymaker"
ESCOPO="wamadigitals-projects"
APP_URL_PROD="https://melstorymaker.com.br"

cd "$(dirname "$0")/.."

if [ ! -f .env.local ]; then
  echo "  .env.local não encontrado." >&2
  exit 1
fi

if ! vercel whoami --scope "$ESCOPO" >/dev/null 2>&1; then
  echo ""
  echo "  Não autenticado. Rode primeiro:"
  echo ""
  echo "      vercel login"
  echo ""
  exit 1
fi

echo ""
echo "  Vinculando ao projeto $PROJETO…"
vercel link --yes --project "$PROJETO" --scope "$ESCOPO" >/dev/null

# NEXT_PUBLIC_* precisa existir também em preview/development, senão o build de
# preview gera bundle sem a URL do Supabase e o formulário quebra só lá.
AMBIENTES_PUBLICOS="production preview development"
AMBIENTES_SECRETOS="production"

enviar() {
  local nome="$1" valor="$2" ambientes="$3"
  [ -z "$valor" ] && { printf "  \033[33m—\033[0m %-32s vazia, pulada\n" "$nome"; return; }

  for amb in $ambientes; do
    vercel env rm "$nome" "$amb" --yes --scope "$ESCOPO" >/dev/null 2>&1 || true
    printf '%s' "$valor" | vercel env add "$nome" "$amb" --scope "$ESCOPO" >/dev/null 2>&1
  done
  printf "  \033[32m✓\033[0m %-32s %s\n" "$nome" "$ambientes"
}

echo ""
while IFS= read -r linha; do
  case "$linha" in ''|'#'*) continue ;; esac
  [[ "$linha" != *=* ]] && continue

  nome="${linha%%=*}"
  valor="${linha#*=}"
  # tira aspas que o dotenv aceita mas a Vercel guardaria literalmente
  valor="${valor%\"}"; valor="${valor#\"}"

  case "$nome" in
    MAIL_DRY_RUN) valor="0" ;;
    APP_URL)      valor="$APP_URL_PROD" ;;
  esac

  case "$nome" in
    NEXT_PUBLIC_*) enviar "$nome" "$valor" "$AMBIENTES_PUBLICOS" ;;
    *)             enviar "$nome" "$valor" "$AMBIENTES_SECRETOS" ;;
  esac
done < .env.local

echo ""
echo "  Pronto. Um novo deploy é necessário para as variáveis valerem:"
echo "      vercel --prod --scope $ESCOPO"
echo ""
