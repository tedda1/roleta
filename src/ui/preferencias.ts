/** Preferências locais do operador (conveniência; nada crítico vive aqui). */
import type { Qualidade } from "@/palco3d/qualidade";

export type ModoPalco = "2d" | "3d";

/**
 * Animação de entrada da roleta no 3D. As quatro primeiras são coreografias das 9 estrelas
 * cadentes (mesma viagem pelo espaço); "estrela" é a estrela viajante.
 */
export const ENTRADAS = ["cadentes", "helice", "serpente", "raios", "estrela"] as const;
export type Entrada = (typeof ENTRADAS)[number];
export const NOMES_ENTRADA: Record<Entrada, string> = {
  cadentes: "Cadentes · revoada",
  helice: "Cadentes · hélice",
  serpente: "Cadentes · serpente",
  raios: "Cadentes · raios de estrela",
  estrela: "Estrela viajante",
};

/** Efeito sonoro de quando a roleta se forma. */
export const SONS_FORMACAO = ["acorde", "sinos", "cristal", "cosmico", "fanfarra"] as const;
export type SomFormacao = (typeof SONS_FORMACAO)[number];
export const NOMES_SOM: Record<SomFormacao, string> = {
  acorde: "Acorde brilhante",
  sinos: "Sinos",
  cristal: "Cristal mágico",
  cosmico: "Impacto cósmico",
  fanfarra: "Fanfarra",
};

export interface Preferencias {
  modo: ModoPalco;
  qualidade: Qualidade;
  entrada: Entrada;
  som: SomFormacao;
}

/** Próximo item de uma lista circular (botões que alternam opções). */
export function proximo<T>(lista: readonly T[], atual: T): T {
  return lista[(lista.indexOf(atual) + 1) % lista.length];
}

export const lerEntrada = (v: unknown): Entrada | null => (ENTRADAS.includes(v as Entrada) ? (v as Entrada) : null);
export const lerSom = (v: unknown): SomFormacao | null => (SONS_FORMACAO.includes(v as SomFormacao) ? (v as SomFormacao) : null);

const CHAVE = "roleta:preferencias";
const QUALIDADES: Qualidade[] = ["auto", "leve", "normal", "alta"];

/** `salvo` indica que o operador escolheu explicitamente (vale mais que a rota /3d/). */
export function lerPreferencias(): Preferencias & { salvo: boolean } {
  const padrao = { modo: "2d" as ModoPalco, qualidade: "auto" as Qualidade, entrada: "cadentes" as Entrada, som: "acorde" as SomFormacao, salvo: false };
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return padrao;
    const p = JSON.parse(bruto) as Partial<Preferencias> & { leve?: boolean };
    // compatibilidade: versões antigas guardavam só "leve: true/false"
    const qualidade = QUALIDADES.includes(p.qualidade as Qualidade) ? (p.qualidade as Qualidade) : p.leve ? "leve" : "auto";
    return {
      modo: p.modo === "3d" ? "3d" : "2d",
      qualidade,
      entrada: lerEntrada(p.entrada) ?? "cadentes",
      som: lerSom(p.som) ?? "acorde",
      salvo: true,
    };
  } catch {
    return padrao;
  }
}

export function salvarPreferencias(p: Preferencias): void {
  try {
    localStorage.setItem(CHAVE, JSON.stringify(p));
  } catch {
    /* ignora */
  }
}
