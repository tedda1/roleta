import { describe, expect, it } from "vitest";
import { TAU, anguloAlvo, anguloAtual, anguloNoGiro, fatiaSobPonteiro, montarFatias, planejarGiro } from "./geometria";

function lcg(semente: number) {
  let s = semente;
  return () => (s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296;
}

const itens = (pesos: number[]) => pesos.map((peso, i) => ({ id: `b${i}`, nome: `Brinde ${i}`, rotulo: `B${i}`, peso }));

describe("montarFatias", () => {
  it("cobre o círculo sem buracos", () => {
    const f = montarFatias(itens([1, 2, 1]));
    expect(f[0].inicio).toBe(0);
    expect(f[1].inicio).toBeCloseTo(TAU / 4);
    expect(f[2].inicio + f[2].largura).toBeCloseTo(TAU);
    expect(montarFatias([])).toEqual([]);
  });
});

describe("fatiaSobPonteiro", () => {
  it("com rotação 0, o ponteiro (12h) está no início da fatia 0", () => {
    const f = montarFatias(itens([1, 1, 1, 1]));
    expect(fatiaSobPonteiro(f, 0)).toBe(0);
    // girar no sentido horário traz a ÚLTIMA fatia para baixo do ponteiro
    expect(fatiaSobPonteiro(f, 0.1)).toBe(3);
    expect(fatiaSobPonteiro(f, -0.1)).toBe(0);
    expect(fatiaSobPonteiro(f, -TAU / 4 - 0.01)).toBe(1);
    expect(fatiaSobPonteiro([], 1)).toBe(-1);
  });
});

describe("planejarGiro (propriedade)", () => {
  it("sempre para na fatia sorteada, no sentido pedido, sem NaN", () => {
    const rnd = lcg(42);
    for (let caso = 0; caso < 5000; caso++) {
      const n = 1 + Math.floor(rnd() * 24);
      const pesos = Array.from({ length: n }, () => (caso % 2 ? 1 : 1 + Math.floor(rnd() * 9)));
      const fatias = montarFatias(itens(pesos));
      const indice = Math.floor(rnd() * n);
      const fracao = 0.15 + rnd() * 0.7;
      const theta0 = (rnd() - 0.5) * 400;
      const sentido = rnd() < 0.5 ? -1 : 1;
      const w0 = 1 + rnd() * 40;
      const plano = planejarGiro({ theta0, alvo: anguloAlvo(fatias[indice], fracao), sentido, w0 });

      expect(fatiaSobPonteiro(fatias, plano.thetaFinal)).toBe(indice);
      expect(Math.sign(plano.thetaFinal - plano.theta0)).toBe(sentido);
      expect(Math.abs(plano.thetaFinal - plano.theta0)).toBeGreaterThanOrEqual(3 * TAU);
      expect(plano.T).toBeGreaterThanOrEqual(4);
      expect(plano.T).toBeLessThanOrEqual(7.5);
      expect(anguloNoGiro(plano, plano.T)).toBe(plano.thetaFinal);
      expect(anguloNoGiro(plano, plano.T + 5)).toBe(plano.thetaFinal);
      expect(anguloNoGiro(plano, -1)).toBe(plano.theta0);
      const meio = anguloNoGiro(plano, plano.T / 2);
      expect(Number.isFinite(meio)).toBe(true);
    }
  });

  it("é monotônico (não volta para trás)", () => {
    const fatias = montarFatias(itens([1, 1, 1]));
    for (const sentido of [1, -1]) {
      const plano = planejarGiro({ theta0: 1, alvo: anguloAlvo(fatias[2], 0.5), sentido, w0: 9 });
      let anterior = plano.theta0;
      for (let t = 0; t <= plano.T; t += plano.T / 200) {
        const a = anguloNoGiro(plano, t);
        expect((a - anterior) * sentido).toBeGreaterThanOrEqual(-1e-12);
        anterior = a;
      }
    }
  });
});

describe("anguloAtual", () => {
  it("ocioso gira com o tempo; parado é fixo", () => {
    expect(anguloAtual({ tipo: "parado", theta: 2 }, 999)).toBe(2);
    expect(anguloAtual({ tipo: "ocioso", base: 1, t0: 1000, omega: 0.5 }, 3000)).toBeCloseTo(2);
  });
});
