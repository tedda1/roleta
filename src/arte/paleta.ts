/** Paleta oficial da Convenção 2026 (PDF de identidade visual). */
export const PALETA = {
  branco: "#ffffff",
  azulClaro: "#6982b0",
  cinzaAzulado: "#616d85",
  ardosia: "#4c5262",
  grafite: "#374254",
  azulProfundo: "#0a2248",
  noite: "#11203d",
  meiaNoite: "#1c2134",
} as const;

/** Bases das fatias: azuis profundos da paleta, alternados. */
export const BASES_FATIA = [PALETA.azulProfundo, PALETA.noite, PALETA.grafite, PALETA.meiaNoite] as const;

/**
 * Luzes das fitas da capa (tiradas da arte, não fazem parte da paleta oficial):
 * usadas só como brilho/acento para diferenciar fatias, nunca como fundo.
 */
export const LUZES = ["#38c6ff", "#ff8a2a", "#c77dff", "#7ddc5a", "#ffd23f", "#ff6fae"] as const;

export const FONTE_TITULO = "Resagokr, var(--fonte-titulo-reserva), system-ui, sans-serif";
export const FONTE_TEXTO = "var(--fonte-texto), Georgia, serif";

/** Nome da família que o canvas deve usar (precisa estar carregada antes de desenhar). */
export function familiaCanvasTitulo(): string {
  if (typeof document === "undefined") return "sans-serif";
  const reserva = getComputedStyle(document.documentElement).getPropertyValue("--fonte-titulo-reserva").trim();
  return `Resagokr, ${reserva || "sans-serif"}, sans-serif`;
}
