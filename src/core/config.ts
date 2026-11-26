import { ConfigBrindes, validarConfig } from "./regras";

export interface ResultadoConfig {
  config: ConfigBrindes | null;
  erros: string[];
  /** true quando o arquivo real não existe e usamos o exemplo */
  exemplo: boolean;
}

/** Lê public/brindes.json (sem cache). Sem ele, usa brindes.exemplo.json e avisa. */
export async function carregarConfig(): Promise<ResultadoConfig> {
  for (const [arquivo, exemplo] of [
    ["/brindes.json", false],
    ["/brindes.exemplo.json", true],
  ] as const) {
    try {
      const r = await fetch(arquivo, { cache: "no-store" });
      if (!r.ok) continue;
      let bruto: unknown;
      try {
        bruto = await r.json();
      } catch {
        return { config: null, erros: [`${arquivo}: JSON inválido (confira vírgulas e aspas).`], exemplo };
      }
      const { config, erros } = validarConfig(bruto);
      return { config, erros: erros.map((e) => `${arquivo}: ${e}`), exemplo };
    } catch {
      /* tenta o próximo */
    }
  }
  return { config: null, erros: ["Nenhum arquivo de brindes encontrado (brindes.json)."], exemplo: false };
}
