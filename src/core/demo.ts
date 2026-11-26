/**
 * Dados de exemplo da tela de teste (/teste-3d/). Ficam num banco separado
 * ("roleta-constelacao-demo"): nada aqui afeta o evento real.
 */
import type { Brinde, ConfigBrindes } from "./regras";

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
    { id: "tablet", nome: "Tablet 10 polegadas", rotulo: "Tablet", quantidade: 1 },
    { id: "fone", nome: "Fone de ouvido Bluetooth", rotulo: "Fone Bluetooth", quantidade: 2 },
    { id: "caixa-som", nome: "Caixa de som portátil", rotulo: "Caixa de som", quantidade: 2 },
    { id: "cafeteira", nome: "Cafeteira de cápsulas", rotulo: "Cafeteira", quantidade: 2 },
    { id: "kit-spa", nome: "Kit spa relaxante", rotulo: "Kit spa", quantidade: 3 },
    { id: "vale-livro", nome: "Vale-livro R$ 100", rotulo: "Vale-livro", quantidade: 4 },
    { id: "power-bank", nome: "Carregador portátil (power bank)", rotulo: "Power bank", quantidade: 4 },
    { id: "garrafa", nome: "Garrafa térmica", rotulo: "Garrafa térmica", quantidade: 6 },
    { id: "caneca", nome: "Caneca Constelação", rotulo: "Caneca", quantidade: 10 },
  ],
};

/** Reserva para o botão "+ Brinde" da tela de teste (entra um por vez, na ordem). */
export const EXTRAS_DEMO: Brinde[] = [
  { id: "cinema", nome: "Par de ingressos de cinema", rotulo: "Cinema", quantidade: 3 },
  { id: "planta", nome: "Kit horta em casa", rotulo: "Kit horta", quantidade: 2 },
  { id: "mochila", nome: "Mochila executiva", rotulo: "Mochila", quantidade: 2 },
  { id: "luminaria", nome: "Luminária de estrelas", rotulo: "Luminária", quantidade: 2 },
  { id: "massagem", nome: "Sessão de massagem", rotulo: "Massagem", quantidade: 1 },
  { id: "vinho", nome: "Kit vinho e taças", rotulo: "Kit vinho", quantidade: 2 },
  { id: "chocolate", nome: "Cesta de chocolates", rotulo: "Chocolates", quantidade: 3 },
  { id: "camiseta", nome: "Camiseta Constelação", rotulo: "Camiseta", quantidade: 8 },
  { id: "agenda", nome: "Agenda 2027", rotulo: "Agenda 2027", quantidade: 6 },
  { id: "headset", nome: "Headset gamer", rotulo: "Headset", quantidade: 1 },
  { id: "drone", nome: "Mini drone", rotulo: "Mini drone", quantidade: 1 },
  { id: "kindle", nome: "Leitor de livros digitais", rotulo: "Leitor digital", quantidade: 1 },
];

/** Próximo brinde extra que ainda não está no evento; depois da reserva, cria "Brinde surpresa N". */
export function proximoBrindeExtra(idsNoEvento: readonly string[]): Brinde {
  const ids = new Set(idsNoEvento);
  const livre = EXTRAS_DEMO.find((b) => !ids.has(b.id));
  if (livre) return { ...livre };
  let n = 1;
  while (ids.has(`surpresa-${n}`)) n++;
  return { id: `surpresa-${n}`, nome: `Brinde surpresa ${n}`, rotulo: `Surpresa ${n}`, quantidade: 1 };
}

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
