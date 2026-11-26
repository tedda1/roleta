/**
 * Dados de exemplo da tela de teste (/teste-3d/). Ficam num banco separado
 * ("roleta-constelacao-demo"): nada aqui afeta o evento real.
 */
import type { ConfigBrindes } from "./regras";

export const OPCOES_DEMO = { nomeDb: "roleta-constelacao-demo", nomeTrava: "roleta-constelacao-demo" };

/** Mistura de brindes únicos (somem logo, para ver a roleta encolher) e brindes com estoque. */
export const CONFIG_DEMO: ConfigBrindes = {
  evento: "Demonstração · Constelação OncologyGroup",
  pin: "1234",
  modoSorteio: "porTipo",
  som: true,
  brindes: [
    { id: "smartwatch", nome: "Smartwatch", rotulo: "Smartwatch", quantidade: 1 },
    { id: "jantar", nome: "Voucher jantar para dois", rotulo: "Jantar a dois", quantidade: 1 },
    { id: "dayoff", nome: "Day off (folga de um dia)", rotulo: "Day off", quantidade: 1 },
    { id: "fone", nome: "Fone de ouvido Bluetooth", rotulo: "Fone Bluetooth", quantidade: 2 },
    { id: "caixa-som", nome: "Caixa de som portátil", rotulo: "Caixa de som", quantidade: 2 },
    { id: "kit-spa", nome: "Kit spa relaxante", rotulo: "Kit spa", quantidade: 3 },
    { id: "garrafa", nome: "Garrafa térmica", rotulo: "Garrafa térmica", quantidade: 5 },
    { id: "caneca", nome: "Caneca Constelação", rotulo: "Caneca", quantidade: 8 },
  ],
};

function digitoVerificador(base: string): number {
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
  const r = (soma * 10) % 11;
  return r === 10 ? 0 : r;
}

/** CPF válido aleatório, só para testes (não decide nada do sorteio). */
export function gerarCpfTeste(aleatorio: () => number = Math.random): string {
  let base = "";
  do {
    base = Array.from({ length: 9 }, () => Math.floor(aleatorio() * 10)).join("");
  } while (/^(\d)\1{8}$/.test(base));
  const d1 = digitoVerificador(base);
  return base + d1 + digitoVerificador(base + d1);
}
