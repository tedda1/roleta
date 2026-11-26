import { describe, expect, it } from "vitest";
import { cpfValido } from "./cpf";
import { CONFIG_DEMO, EXTRAS_DEMO, gerarCpfTeste, proximoBrindeExtra } from "./demo";
import { LIMITE_BRINDES, validarConfig } from "./regras";

describe("dados de exemplo", () => {
  it("a configuração de demonstração é válida", () => {
    expect(validarConfig(CONFIG_DEMO).erros).toEqual([]);
  });

  it("brindes extras não repetem ids e cabem no limite da roleta", () => {
    const ids = CONFIG_DEMO.brindes.map((b) => b.id);
    while (ids.length < LIMITE_BRINDES) ids.push(proximoBrindeExtra(ids).id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(validarConfig({ ...CONFIG_DEMO, brindes: [...CONFIG_DEMO.brindes, ...EXTRAS_DEMO] }).erros).toEqual([]);
  });

  it("gera sempre CPFs válidos", () => {
    for (let i = 0; i < 2000; i++) expect(cpfValido(gerarCpfTeste())).toBe(true);
  });
});
