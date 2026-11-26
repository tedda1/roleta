/**
 * Convenção única de ângulos (vale para 2D e 3D):
 *
 * - Ângulos da roleta são medidos em radianos, a partir das 12h, no sentido HORÁRIO.
 * - A fatia i ocupa [inicio, inicio + largura) no referencial da roleta.
 * - theta é a rotação da roleta, positiva no sentido horário (igual ao CSS rotate()).
 * - O ponteiro é fixo às 12h. Com rotação theta, o ponteiro aponta para o ângulo
 *   mod(-theta, 2π) da roleta.
 *
 * No three.js, rotation.z positivo é anti-horário visto pela câmera: use -theta.
 */

export const TAU = Math.PI * 2;

export function modPositivo(a: number, m: number): number {
  return ((a % m) + m) % m;
}

export function limitar(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export interface ItemFatia {
  id: string;
  nome: string;
  rotulo: string;
  peso: number;
}

export interface Fatia extends ItemFatia {
  indice: number;
  inicio: number;
  largura: number;
}

export function montarFatias(itens: readonly ItemFatia[]): Fatia[] {
  const total = itens.reduce((s, i) => s + i.peso, 0);
  if (total <= 0) return [];
  let acumulado = 0;
  return itens.map((item, indice) => {
    const inicio = (acumulado / total) * TAU;
    acumulado += item.peso;
    const fim = (acumulado / total) * TAU;
    return { ...item, indice, inicio, largura: fim - inicio };
  });
}

/** Índice da fatia sob o ponteiro para a rotação theta (-1 se não houver fatias). */
export function fatiaSobPonteiro(fatias: readonly Fatia[], theta: number): number {
  if (fatias.length === 0) return -1;
  const phi = modPositivo(-theta, TAU);
  for (const f of fatias) {
    if (phi >= f.inicio && phi < f.inicio + f.largura) return f.indice;
  }
  return fatias[fatias.length - 1].indice;
}

/** Ângulo (referencial da roleta) do ponto onde o ponteiro deve parar. */
export function anguloAlvo(fatia: Fatia, fracao: number): number {
  return fatia.inicio + fatia.largura * limitar(fracao, 0, 0.999999);
}

export interface PlanoGiro {
  theta0: number;
  thetaFinal: number;
  /** duração em segundos */
  T: number;
  /** expoente da desaceleração */
  p: number;
}

export interface OpcoesGiro {
  theta0: number;
  /** ângulo alvo no referencial da roleta */
  alvo: number;
  /** +1 horário, -1 anti-horário */
  sentido: number;
  /** velocidade inicial desejada (rad/s, módulo) */
  w0: number;
  tAlvo?: number;
  tMin?: number;
  tMax?: number;
  voltasMin?: number;
  p?: number;
}

/**
 * Planeja um giro que termina EXATAMENTE com o ponteiro sobre `alvo`.
 * thetaFinal ≡ -alvo (mod 2π), no sentido pedido, com pelo menos `voltasMin` voltas.
 */
export function planejarGiro(o: OpcoesGiro): PlanoGiro {
  const p = o.p ?? 3;
  const tAlvo = o.tAlvo ?? 5.5;
  const tMin = o.tMin ?? 4;
  const tMax = o.tMax ?? 7.5;
  const voltasMin = o.voltasMin ?? 3;
  const s = o.sentido < 0 ? -1 : 1;
  const w0 = limitar(Math.abs(o.w0) || 9, 2, 30);

  const delta = modPositivo(s * (-o.alvo - o.theta0), TAU);
  const desejado = (w0 * tAlvo) / p; // percurso que daria velocidade inicial w0 em tAlvo
  const k = Math.max(voltasMin, Math.round((desejado - delta) / TAU));
  const D = TAU * k + delta;
  const T = limitar((p * D) / w0, tMin, tMax);
  return { theta0: o.theta0, thetaFinal: o.theta0 + s * D, T, p };
}

/** Ângulo no instante t (segundos desde o início). Exato em t >= T; sem NaN fora do intervalo. */
export function anguloNoGiro(plano: PlanoGiro, t: number): number {
  const u = limitar(t / plano.T, 0, 1);
  if (u >= 1) return plano.thetaFinal;
  const fator = 1 - Math.pow(1 - u, plano.p);
  return plano.theta0 + (plano.thetaFinal - plano.theta0) * fator;
}

export type Rotacao =
  | { tipo: "ocioso"; base: number; t0: number; omega: number }
  | { tipo: "parado"; theta: number }
  | { tipo: "giro"; plano: PlanoGiro; t0: number };

/** Ângulo atual a partir do relógio (ms de performance.now()). */
export function anguloAtual(r: Rotacao, agoraMs: number): number {
  switch (r.tipo) {
    case "parado":
      return r.theta;
    case "ocioso":
      return r.base + r.omega * ((agoraMs - r.t0) / 1000);
    case "giro":
      return anguloNoGiro(r.plano, (agoraMs - r.t0) / 1000);
  }
}
