import { describe, expect, it } from "vitest";
import { fracaoNaFatia, inteiroUniforme, sortearPonderado } from "./sorteio";

const fila = (valores: number[]) => {
  let i = 0;
  return () => valores[i++];
};

/** xorshift32 determinístico: testes estatísticos reprodutíveis, sem intermitência. */
function xorshift(semente: number) {
  let x = semente >>> 0 || 1;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>>= 0);
  };
}

describe("inteiroUniforme", () => {
  it("usa o resto quando abaixo do limite", () => {
    expect(inteiroUniforme(3, fila([7]))).toBe(1);
    expect(inteiroUniforme(1, fila([123456]))).toBe(0);
  });

  it("rejeita valores acima do limite (sem viés de módulo)", () => {
    // n = 3: limite = floor(2^32/3)*3 = 4294967295 -> o valor 4294967295 é descartado
    expect(inteiroUniforme(3, fila([4294967295, 5]))).toBe(2);
    // n = 2^31 + 1: limite = 2^31 + 1; tudo acima é descartado
    expect(inteiroUniforme(2 ** 31 + 1, fila([2 ** 31 + 1, 2 ** 32 - 1, 10]))).toBe(10);
  });

  it("cada resíduo tem exatamente a mesma quantidade de pré-imagens aceitas", () => {
    for (const n of [1, 2, 3, 5, 7, 12, 24, 1000]) {
      const limite = Math.floor(2 ** 32 / n) * n;
      expect(limite % n).toBe(0);
      expect(2 ** 32 - limite).toBeLessThan(n);
    }
  });

  it("recusa n inválido", () => {
    expect(() => inteiroUniforme(0)).toThrow();
    expect(() => inteiroUniforme(2.5)).toThrow();
  });

  it("distribuição empírica plana (semente fixa)", () => {
    const fonte = xorshift(2026);
    const n = 7;
    const contagem = new Array(n).fill(0);
    const total = 70_000;
    for (let i = 0; i < total; i++) contagem[inteiroUniforme(n, fonte)]++;
    for (const c of contagem) expect(Math.abs(c - total / n)).toBeLessThan(total / n * 0.05);
  });
});

describe("sortearPonderado", () => {
  it("mapeia as faixas de peso corretamente", () => {
    const pesos = [1, 2, 3];
    const esperado = [0, 1, 1, 2, 2, 2];
    for (let r = 0; r < 6; r++) expect(sortearPonderado(pesos, fila([r]))).toBe(esperado[r]);
  });

  it("pesos iguais = chance igual por item", () => {
    const fonte = xorshift(99);
    const contagem = [0, 0, 0, 0];
    for (let i = 0; i < 40_000; i++) contagem[sortearPonderado([1, 1, 1, 1], fonte)]++;
    for (const c of contagem) expect(Math.abs(c - 10_000)).toBeLessThan(500);
  });

  it("recusa lista vazia ou peso inválido", () => {
    expect(() => sortearPonderado([])).toThrow();
    expect(() => sortearPonderado([1, 0])).toThrow();
  });
});

describe("fracaoNaFatia", () => {
  it("fica longe das bordas", () => {
    expect(fracaoNaFatia(fila([0]))).toBeCloseTo(0.15);
    expect(fracaoNaFatia(fila([2 ** 32 - 1]))).toBeLessThan(0.85);
  });
});
