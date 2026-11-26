/**
 * Sorteio sem viés. Toda decisão de resultado usa crypto.getRandomValues com
 * amostragem por rejeição (sem viés de módulo). Math.random nunca decide nada.
 */

export type FonteU32 = () => number;

export const u32Cripto: FonteU32 = () => {
  const a = new Uint32Array(1);
  globalThis.crypto.getRandomValues(a);
  return a[0];
};

const DOIS_32 = 2 ** 32;

/** Inteiro uniforme em [0, n). */
export function inteiroUniforme(n: number, fonte: FonteU32 = u32Cripto): number {
  if (!Number.isInteger(n) || n < 1 || n > DOIS_32) {
    throw new RangeError(`n inválido para sorteio: ${n}`);
  }
  const limite = Math.floor(DOIS_32 / n) * n;
  for (let tentativas = 0; tentativas < 1000; tentativas++) {
    const x = fonte() >>> 0;
    if (x < limite) return x % n;
  }
  throw new Error("Fonte aleatória degenerada");
}

/** Índice sorteado com probabilidade proporcional ao peso inteiro de cada item. */
export function sortearPonderado(pesos: readonly number[], fonte: FonteU32 = u32Cripto): number {
  if (pesos.length === 0) throw new RangeError("Nada para sortear");
  let total = 0;
  for (const p of pesos) {
    if (!Number.isInteger(p) || p < 1) throw new RangeError(`peso inválido: ${p}`);
    total += p;
  }
  let r = inteiroUniforme(total, fonte);
  for (let i = 0; i < pesos.length; i++) {
    if (r < pesos[i]) return i;
    r -= pesos[i];
  }
  return pesos.length - 1; // inalcançável
}

/** Posição cosmética dentro da fatia, longe das bordas: [0,15; 0,85). Não afeta o resultado. */
export function fracaoNaFatia(fonte: FonteU32 = u32Cripto): number {
  return 0.15 + 0.7 * ((fonte() >>> 0) / DOIS_32);
}
