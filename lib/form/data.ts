/** A apresentação usa pontos; respostas e coluna Postgres continuam em ISO. */
export function dataISOValida(valor: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return false;
  const [, a, mes, dia] = m;
  const ano = Number(a), mm = Number(mes), dd = Number(dia);
  if (ano < 1 || mm < 1 || mm > 12 || dd < 1) return false;
  const bissexto = ano % 4 === 0 && (ano % 100 !== 0 || ano % 400 === 0);
  return dd <= [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mm - 1];
}

export function dataComPontos(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : valor;
}

export function mascararData(valor: string): string {
  const digitos = dataComPontos(valor).replace(/\D/g, "").slice(0, 8);
  if (digitos.length <= 2) return digitos;
  if (digitos.length <= 4) return `${digitos.slice(0, 2)}.${digitos.slice(2)}`;
  return `${digitos.slice(0, 2)}.${digitos.slice(2, 4)}.${digitos.slice(4)}`;
}

/** Parcial/inválida continua parcial para a validação impedir o avanço. */
export function dataDaEntrada(valor: string): string {
  const exibida = mascararData(valor);
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(exibida);
  if (!m) return exibida;
  const iso = `${m[3]}-${m[2]}-${m[1]}`;
  return dataISOValida(iso) ? iso : exibida;
}
