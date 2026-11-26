/** Preferências locais do operador (conveniência; nada crítico vive aqui). */
export type ModoPalco = "2d" | "3d";

export interface Preferencias {
  modo: ModoPalco;
  leve: boolean;
}

const CHAVE = "roleta:preferencias";

/** `salvo` indica que o operador escolheu explicitamente (vale mais que a rota /3d/). */
export function lerPreferencias(): Preferencias & { salvo: boolean } {
  const padrao = { modo: "2d" as ModoPalco, leve: false, salvo: false };
  try {
    const bruto = localStorage.getItem(CHAVE);
    if (!bruto) return padrao;
    const p = JSON.parse(bruto) as Partial<Preferencias>;
    return { modo: p.modo === "3d" ? "3d" : "2d", leve: p.leve === true, salvo: true };
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
