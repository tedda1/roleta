import { describe, expect, it } from "vitest";
import { cpfValido } from "./cpf";
import { CONFIG_DEMO, gerarCpfTeste } from "./demo";
import { validarConfig } from "./regras";

describe("dados de exemplo", () => {
  it("a configuração de demonstração é válida", () => {
    expect(validarConfig(CONFIG_DEMO).erros).toEqual([]);
  });

  it("gera sempre CPFs válidos", () => {
    for (let i = 0; i < 2000; i++) expect(cpfValido(gerarCpfTeste())).toBe(true);
  });
});
