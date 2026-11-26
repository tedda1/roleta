/**
 * Céu da identidade "Constelação": azul profundo, poeira de estrelas, nós ligados por linhas,
 * bokeh dourado e fitas luminosas. Desenhado UMA vez por redimensionamento (DPR 1):
 * todo o brilho é "assado" no bitmap, nada de filter/blur em tempo real.
 */
import { LUZES, PALETA } from "./paleta";
import { hexAlfa } from "./face";

function gerador(semente: number) {
  let s = semente % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function brilho(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, cor: string, a: number) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, hexAlfa("#ffffff", a));
  g.addColorStop(0.2, hexAlfa(cor, a * 0.7));
  g.addColorStop(1, hexAlfa(cor, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

/** Fita translúcida: várias passadas de traço com largura e alfa decrescentes (glow barato). */
function fita(
  ctx: CanvasRenderingContext2D,
  pontos: [number, number][],
  cores: [string, string],
  largura: number,
) {
  const [p0, p1, p2, p3] = pontos;
  const grad = ctx.createLinearGradient(p0[0], p0[1], p3[0], p3[1]);
  grad.addColorStop(0, hexAlfa(cores[0], 1));
  grad.addColorStop(1, hexAlfa(cores[1], 1));
  const passadas: [number, number][] = [
    [largura * 3.2, 0.05],
    [largura * 1.8, 0.09],
    [largura, 0.18],
    [largura * 0.35, 0.55],
    [largura * 0.08, 0.9],
  ];
  for (const [w, a] of passadas) {
    ctx.globalAlpha = a;
    ctx.strokeStyle = grad;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(p0[0], p0[1]);
    ctx.bezierCurveTo(p1[0], p1[1], p2[0], p2[1], p3[0], p3[1]);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export interface OpcoesCeu {
  semente?: number;
  /** desenha as fitas (desligar no modo leve não muda o custo por quadro, só o visual) */
  fitas?: boolean;
}

export function desenharCeu(canvas: HTMLCanvasElement, largura: number, altura: number, opcoes: OpcoesCeu = {}): void {
  const w = Math.max(1, Math.round(largura));
  const h = Math.max(1, Math.round(altura));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const rnd = gerador(opcoes.semente ?? 2026);
  const m = Math.min(w, h);

  // fundo
  const fundo = ctx.createRadialGradient(w * 0.5, h * 0.45, m * 0.1, w * 0.5, h * 0.5, Math.max(w, h) * 0.8);
  fundo.addColorStop(0, "#12306a");
  fundo.addColorStop(0.45, PALETA.azulProfundo);
  fundo.addColorStop(0.8, PALETA.noite);
  fundo.addColorStop(1, PALETA.meiaNoite);
  ctx.fillStyle = fundo;
  ctx.fillRect(0, 0, w, h);

  // nebulosas suaves
  ctx.globalCompositeOperation = "lighter";
  for (const [x, y, r, cor, a] of [
    [0.18, 0.2, 0.55, "#3b3fb0", 0.18],
    [0.85, 0.75, 0.6, "#1f6fb5", 0.16],
    [0.7, 0.15, 0.4, "#7a3fb0", 0.1],
  ] as const) {
    const g = ctx.createRadialGradient(w * x, h * y, 0, w * x, h * y, m * r);
    g.addColorStop(0, hexAlfa(cor, a));
    g.addColorStop(1, hexAlfa(cor, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // fitas luminosas (cruzando no topo e embaixo, como na capa)
  if (opcoes.fitas !== false) {
    const L = m * 0.022;
    fita(ctx, [[-0.1 * w, 0.18 * h], [0.25 * w, -0.15 * h], [0.55 * w, 0.45 * h], [1.1 * w, 0.05 * h]], [LUZES[0], LUZES[2]], L);
    fita(ctx, [[-0.05 * w, -0.05 * h], [0.3 * w, 0.35 * h], [0.65 * w, 0.32 * h], [1.05 * w, 0.28 * h]], [LUZES[1], LUZES[4]], L * 0.9);
    fita(ctx, [[0.35 * w, -0.1 * h], [0.6 * w, 0.25 * h], [0.9 * w, 0.1 * h], [1.1 * w, 0.4 * h]], [LUZES[3], LUZES[0]], L * 0.6);
    fita(ctx, [[-0.1 * w, 0.75 * h], [0.25 * w, 0.95 * h], [0.6 * w, 0.85 * h], [1.1 * w, 1.05 * h]], [LUZES[0], LUZES[1]], L);
    fita(ctx, [[-0.1 * w, 0.95 * h], [0.3 * w, 0.7 * h], [0.7 * w, 1.15 * h], [1.1 * w, 0.85 * h]], [LUZES[2], LUZES[5]], L * 0.75);
  }

  // bokeh dourado
  for (let i = 0; i < 26; i++) {
    const canto = i % 2 === 0;
    const x = canto ? rnd() * w * 0.35 : w - rnd() * w * 0.3;
    const y = canto ? h * (0.45 + rnd() * 0.5) : h * (0.05 + rnd() * 0.35);
    const r = m * (0.004 + rnd() * 0.014);
    brilho(ctx, x, y, r * 2.2, "#ffb347", 0.35 + rnd() * 0.4);
  }

  // poeira de estrelas
  for (let i = 0; i < Math.round((w * h) / 2600); i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.12 + rnd() * 0.55})`;
    const r = rnd() < 0.92 ? 0.5 + rnd() * 0.8 : 1.2 + rnd() * 1.2;
    ctx.beginPath();
    ctx.arc(rnd() * w, rnd() * h, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // constelações: nós brilhantes ligados por linhas finas
  for (let grupo = 0; grupo < 4; grupo++) {
    const cx = w * (grupo % 2 === 0 ? 0.08 + rnd() * 0.25 : 0.68 + rnd() * 0.25);
    const cy = h * (grupo < 2 ? 0.1 + rnd() * 0.3 : 0.6 + rnd() * 0.3);
    const nos: [number, number][] = [];
    const qtd = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < qtd; k++) nos.push([cx + (rnd() - 0.5) * m * 0.38, cy + (rnd() - 0.5) * m * 0.3]);
    ctx.strokeStyle = "rgba(180,200,255,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 1; k < nos.length; k++) {
      ctx.moveTo(nos[k - 1][0], nos[k - 1][1]);
      ctx.lineTo(nos[k][0], nos[k][1]);
    }
    ctx.stroke();
    nos.forEach(([x, y], k) => brilho(ctx, x, y, m * (0.008 + (k % 3) * 0.004), LUZES[(grupo + k) % LUZES.length], 0.95));
  }
  ctx.globalCompositeOperation = "source-over";
}
