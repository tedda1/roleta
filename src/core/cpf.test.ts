import { describe, expect, it } from "vitest";
import { cpfValido, formatarCpf } from "./cpf";

/** Segunda implementação independente (fórmula "11 - resto") para teste de propriedade. */
function cpfValidoReferencia(cpf: string): boolean {
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) return false;
  const dv = (base: string) => {
    let soma = 0;
    for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (base.length + 1 - i);
    const r = 11 - (soma % 11);
    return r >= 10 ? 0 : r;
  };
  const d1 = dv(cpf.slice(0, 9));
  const d2 = dv(cpf.slice(0, 9) + d1);
  return cpf.endsWith(`${d1}${d2}`);
}

describe("cpfValido", () => {
  it.each([
    ["529.982.247-25", true],
    ["52998224725", true],
    ["000.000.001-91", true],
    ["000.000.006-04", true], // primeiro DV cai na regra resto 10 -> 0
    ["529.982.247-24", false],
    ["529.982.274-25", false],
    ["1234567890", false],
    ["123456789012", false],
    ["", false],
  ])("%s -> %s", (cpf, esperado) => {
    expect(cpfValido(cpf)).toBe(esperado);
  });

  it("rejeita as 10 sequências repetidas", () => {
    for (let d = 0; d <= 9; d++) expect(cpfValido(String(d).repeat(11))).toBe(false);
  });

  it("concorda com a implementação de referência em 20 mil números", () => {
    let s = 12345;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let n = 0; n < 20000; n++) {
      const base = Array.from({ length: 9 }, () => Math.floor(rnd() * 10)).join("");
      // metade com DVs corretos, metade aleatória
      let cpf = base + Array.from({ length: 2 }, () => Math.floor(rnd() * 10)).join("");
      if (n % 2 === 0) {
        for (let a = 0; a < 100; a++) {
          const c = base + String(a).padStart(2, "0");
          if (cpfValidoReferencia(c)) cpf = c;
        }
      }
      expect(cpfValido(cpf)).toBe(cpfValidoReferencia(cpf));
    }
  });
});

describe("formatarCpf", () => {
  it("formata progressivamente", () => {
    expect(formatarCpf("")).toBe("");
    expect(formatarCpf("529")).toBe("529");
    expect(formatarCpf("5299")).toBe("529.9");
    expect(formatarCpf("5299822")).toBe("529.982.2");
    expect(formatarCpf("5299822472")).toBe("529.982.247-2");
    expect(formatarCpf("52998224725")).toBe("529.982.247-25");
    expect(formatarCpf("5299822472599")).toBe("529.982.247-25");
  });
});
