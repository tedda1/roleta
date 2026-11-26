import { ItemFatia } from "./geometria";

export type ModoSorteio = "porTipo" | "porUnidade";

export interface Brinde {
  id: string;
  nome: string;
  /** texto curto que vai na fatia (até ~16 caracteres) */
  rotulo: string;
  quantidade: number;
  /** false = desativado pelo administrador (já saiu em jogadas, então não é apagado); não entra na roleta */
  ativo?: boolean;
}

/** Arquivo public/brindes.json editado pelo organizador. */
export interface ConfigBrindes {
  evento: string;
  pin: string;
  modoSorteio: ModoSorteio;
  som: boolean;
  brindes: Brinde[];
}

export interface Evento {
  id: string;
  nome: string;
  criadoEm: number;
  /** sal (base64) da derivação da chave do CPF */
  sal: string;
  iteracoes: number;
  pinHash: string;
  modoSorteio: ModoSorteio;
  som: boolean;
  /** lista do evento, na ordem das fatias (o administrador pode editar durante o evento) */
  brindes: Brinde[];
}

export type StatusJogada = "sorteado" | "revelado" | "estornado";

export interface Jogada {
  id: string;
  seq: number;
  /** chave derivada do CPF; única entre jogadas não estornadas */
  cpfChave: string;
  avulsa: boolean;
  brindeId: string;
  brindeNome: string;
  /** retrato das fatias no momento do sorteio (ordem e pesos) */
  fatias: ItemFatia[];
  indice: number;
  fracao: number;
  status: StatusJogada;
  /** em estornos: true devolve a unidade ao estoque */
  devolvido?: boolean;
  criadoEm: number;
  reveladoEm?: number;
  estornadoEm?: number;
}

export interface Ajuste {
  id: string;
  brindeId: string;
  delta: number;
  motivo: string;
  criadoEm: number;
}

export class ErroRegra extends Error {
  constructor(
    public codigo: "cpfUsado" | "esgotado" | "semEvento" | "invalido",
    mensagem: string,
  ) {
    super(mensagem);
    this.name = "ErroRegra";
  }
}

export const LIMITE_BRINDES = 24;
/** Texto da fatia digitado no cadastro (vazio = usa o nome). */
export const LIMITE_ROTULO = 16;
export const LIMITE_NOME = 60;

/** Brinde que pode entrar na roleta (desativados ficam só no histórico). */
export function brindeAtivo(b: Brinde): boolean {
  return b.ativo !== false;
}

/** "Caneca Constelação" -> "caneca-constelacao" (sem acentos, só letras, números e hífen). */
export function slug(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
}

/** Id novo para um brinde: slug do nome + sufixo curto aleatório, nunca repetido em `existentes`. */
export function idBrinde(nome: string, existentes: Iterable<string>): string {
  const usados = new Set(existentes);
  const base = slug(nome) || "brinde";
  for (;;) {
    const id = `${base}-${novoId().slice(0, 4)}`;
    if (!usados.has(id)) return id;
  }
}

/** Valida o brindes.json. Retorna a lista de problemas (vazia = ok). */
export function validarConfig(bruto: unknown): { config: ConfigBrindes | null; erros: string[] } {
  const erros: string[] = [];
  if (!bruto || typeof bruto !== "object") return { config: null, erros: ["Arquivo vazio ou inválido."] };
  const c = bruto as Record<string, unknown>;
  const evento = typeof c.evento === "string" && c.evento.trim() ? c.evento.trim() : "Convenção 2026";
  const pin = typeof c.pin === "string" ? c.pin.trim() : String(c.pin ?? "");
  if (!/^\d{4,8}$/.test(pin)) erros.push("pin deve ter de 4 a 8 dígitos.");
  const modoSorteio: ModoSorteio = c.modoSorteio === "porUnidade" ? "porUnidade" : "porTipo";
  const som = c.som !== false;
  const lista = Array.isArray(c.brindes) ? c.brindes : null;
  if (!lista) erros.push("brindes deve ser uma lista.");
  const brindes: Brinde[] = [];
  const ids = new Set<string>();
  (lista ?? []).forEach((b, i) => {
    const item = (b ?? {}) as Record<string, unknown>;
    const id = typeof item.id === "string" ? item.id.trim() : "";
    const nome = typeof item.nome === "string" ? item.nome.trim() : "";
    const rotulo = typeof item.rotulo === "string" && item.rotulo.trim() ? item.rotulo.trim() : nome;
    const quantidade = Number(item.quantidade);
    if (!id) erros.push(`brinde ${i + 1}: id vazio.`);
    else if (ids.has(id)) erros.push(`brinde ${i + 1}: id "${id}" repetido.`);
    if (!nome) erros.push(`brinde ${i + 1}: nome vazio.`);
    if (!Number.isInteger(quantidade) || quantidade < 0) erros.push(`brinde ${i + 1}: quantidade inválida.`);
    if (item.ativo !== undefined && typeof item.ativo !== "boolean") erros.push(`brinde ${i + 1}: ativo deve ser true ou false.`);
    ids.add(id);
    const brinde: Brinde = { id, nome, rotulo, quantidade: Number.isInteger(quantidade) ? quantidade : 0 };
    if (item.ativo === false) brinde.ativo = false;
    brindes.push(brinde);
  });
  const ativos = brindes.filter(brindeAtivo).length;
  if (lista && brindes.length === 0) erros.push("Cadastre ao menos um brinde.");
  else if (lista && ativos === 0) erros.push("Todos os brindes estão desativados.");
  if (ativos > LIMITE_BRINDES) erros.push(`No máximo ${LIMITE_BRINDES} tipos de brinde.`);
  if (erros.length) return { config: null, erros };
  return { config: { evento, pin, modoSorteio, som, brindes }, erros };
}

/** Unidades que ainda contam como entregues/reservadas. Estorno com devolução libera a unidade. */
function consome(j: Jogada): boolean {
  return j.status !== "estornado" || j.devolvido === false;
}

/** Estoque derivado: inicial - jogadas que consomem + ajustes. */
export function calcularEstoque(evento: Evento, jogadas: readonly Jogada[], ajustes: readonly Ajuste[]): Map<string, number> {
  const estoque = new Map<string, number>();
  for (const b of evento.brindes) estoque.set(b.id, b.quantidade);
  for (const j of jogadas) {
    if (consome(j) && estoque.has(j.brindeId)) estoque.set(j.brindeId, estoque.get(j.brindeId)! - 1);
  }
  for (const a of ajustes) {
    if (estoque.has(a.brindeId)) estoque.set(a.brindeId, estoque.get(a.brindeId)! + a.delta);
  }
  for (const [id, n] of estoque) if (n < 0) estoque.set(id, 0);
  return estoque;
}

/** Fatias sorteáveis agora, na ordem do cadastro (sem os desativados). porTipo: peso 1; porUnidade: peso = estoque. */
export function itensSorteaveis(evento: Evento, jogadas: readonly Jogada[], ajustes: readonly Ajuste[]): ItemFatia[] {
  const estoque = calcularEstoque(evento, jogadas, ajustes);
  return evento.brindes
    .filter((b) => brindeAtivo(b) && (estoque.get(b.id) ?? 0) > 0)
    .map((b) => ({
      id: b.id,
      nome: b.nome,
      rotulo: b.rotulo || b.nome,
      peso: evento.modoSorteio === "porUnidade" ? estoque.get(b.id)! : 1,
    }));
}

/** CPF consumido por jogadas não estornadas. */
export function cpfJaUsado(jogadas: readonly Jogada[], cpfChave: string): boolean {
  return jogadas.some((j) => j.cpfChave === cpfChave && j.status !== "estornado");
}

export function codigoRetirada(seq: number): string {
  return "#" + String(seq).padStart(3, "0");
}

export function novoId(): string {
  const a = new Uint8Array(12);
  globalThis.crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, "0")).join("");
}
