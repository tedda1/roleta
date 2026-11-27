/**
 * Níveis de qualidade da cena 3D.
 * - leve: igual ao modo leve de sempre (PC fraco).
 * - normal: texturas maiores, face 2048 px, cor de saída correta, MSAA.
 * - alta: tudo do normal + DPR até 2 (com teto de pixels). Só onde a GPU aguenta.
 * O avaliador de desempenho da cena só rebaixa (alta → normal → leve → 2D).
 */
export type NivelQualidade = "leve" | "normal" | "alta";
export type Qualidade = "auto" | NivelQualidade;

export interface PerfilQualidade {
  /** teto do devicePixelRatio */
  dprMax: number;
  /** teto de pixels do framebuffer (largura × altura × dpr²) */
  pixelsMax: number;
  antialias: boolean;
  /** lado da textura da face da roleta (px) */
  ladoFace: number;
  /** lado das texturas de brilho/estrela/raios (px) */
  ladoSprite: number;
  /** lado dos matcaps do metal (px) */
  ladoMatcap: number;
  anisotropia: number;
  /** pós-processamento com bloom real (UnrealBloomPass) + MSAA 4x + tone mapping */
  bloom: boolean;
}

export const PERFIS: Record<NivelQualidade, PerfilQualidade> = {
  leve: { dprMax: 1, pixelsMax: 1920 * 1080, antialias: false, ladoFace: 768, ladoSprite: 128, ladoMatcap: 128, anisotropia: 4, bloom: false },
  normal: { dprMax: 1.5, pixelsMax: 2560 * 1440, antialias: true, ladoFace: 2048, ladoSprite: 512, ladoMatcap: 512, anisotropia: 8, bloom: false },
  alta: { dprMax: 2, pixelsMax: 3840 * 2160, antialias: true, ladoFace: 2048, ladoSprite: 1024, ladoMatcap: 512, anisotropia: 16, bloom: true },
};

/** GPUs dedicadas conhecidas começam em "alta"; o resto em "normal" (o avaliador rebaixa se precisar). */
const DEDICADA = /nvidia|geforce|quadro|\brtx\b|\bgtx\b|radeon (rx|pro)|radeon\(tm\) rx|\barc\b.*a\d{3}|apple m\d (pro|max|ultra)/i;

export function nivelAutomatico(renderizador?: string): NivelQualidade {
  if (renderizador && DEDICADA.test(renderizador)) return "alta";
  return "normal";
}

export function resolverNivel(q: Qualidade, renderizador?: string): NivelQualidade {
  return q === "auto" ? nivelAutomatico(renderizador) : q;
}

export const NOMES_QUALIDADE: Record<Qualidade, string> = {
  auto: "Automática",
  leve: "Leve",
  normal: "Normal",
  alta: "Alta",
};

export function proximaQualidade(q: Qualidade): Qualidade {
  const ordem: Qualidade[] = ["auto", "leve", "normal", "alta"];
  return ordem[(ordem.indexOf(q) + 1) % ordem.length];
}
