/** Preferências locais do operador (conveniência; nada crítico vive aqui). */
import type { Qualidade } from "@/palco3d/qualidade";

export type ModoPalco = "2d" | "3d";

export interface Preferencias {
  modo: ModoPalco;
  qualidade: Qualidade;
}

const CHAVE = "roleta:preferencias";
const QUALIDADES: Qualidade[] = ["auto", "leve", "normal", "alta"];

/** `salvo` indica que o operador escolheu explicitamente (vale mais que a rota /3d/). */
export function lerPreferencias(): Preferencias & { salvo: boolean } {
  const padrao = { modo: "2d" as ModoPalco, qualidade: "auto" as Qualidade, salvo: false };
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return padrao;
    const p = JSON.parse(bruto) as Partial<Preferencias> & { leve?: boolean };
    // compatibilidade: versões antigas guardavam só "leve: true/false"
    const qualidade = QUALIDADES.includes(p.qualidade as Qualidade) ? (p.qualidade as Qualidade) : p.leve ? "leve" : "auto";
    return { modo: p.modo === "3d" ? "3d" : "2d", qualidade, salvo: true };
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
