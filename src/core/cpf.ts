/** Regras de CPF: normalização, dígitos verificadores e máscara de exibição. */

export function somenteDigitos(valor: string): string {
  return valor.replace(/\D/g, "");
}

/** Valida os dois dígitos verificadores e rejeita sequências repetidas (000..., 111..., ...). */
export function cpfValido(valor: string): boolean {
  const cpf = somenteDigitos(valor);
  if (cpf.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(cpf)) return false;

  const d = Array.from(cpf, Number);
  for (const posicao of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < posicao; i++) soma += d[i] * (posicao + 1 - i);
    let resto = (soma * 10) % 11;
    if (resto === 10) resto = 0;
    if (resto !== d[posicao]) return false;
  }
  return true;
}

/** Formata progressivamente: "123" -> "123", "1234" -> "123.4", ... -> "123.456.789-09". */
export function formatarCpf(digitos: string): string {
  const d = somenteDigitos(digitos).slice(0, 11);
  let saida = "";
  for (let i = 0; i < d.length; i++) {
    if (i === 3 || i === 6) saida += ".";
    if (i === 9) saida += "-";
    saida += d[i];
  }
  return saida;
}
