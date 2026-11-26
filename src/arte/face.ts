/**
 * Desenha a face da roleta num canvas. A MESMA função alimenta o 2D (canvas girado por CSS)
 * e o 3D (CanvasTexture). Redesenhada só quando as fatias mudam, nunca por quadro.
 *
 * Convenção: fatia começa às 12h e cresce no sentido horário (ver core/geometria.ts).
 */
import type { Fatia } from "@/core/geometria";
import { BASES_FATIA, LUZES, PALETA, familiaCanvasTitulo } from "./paleta";

const MEIO_PI = Math.PI / 2;

function corBase(i: number, n: number): string {
  let c = i % BASES_FATIA.length;
  // evita duas fatias vizinhas iguais na emenda final
  if (n > 1 && i === n - 1 && c === 0) c = 2;
  return BASES_FATIA[c];
}

export function corLuz(i: number, n: number): string {
  let c = i % LUZES.length;
  if (n > 1 && i === n - 1 && c === 0) c = 3;
  return LUZES[c];
}

function estrela(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, cor = "#ffffff", alfa = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(255,255,255,${alfa})`);
  g.addColorStop(0.25, hexAlfa(cor, alfa * 0.8));
  g.addColorStop(1, hexAlfa(cor, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function hexAlfa(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/** Ajusta o rótulo ao espaço da fatia; reduz a fonte e, no limite, corta com reticências. */
function ajustarTexto(ctx: CanvasRenderingContext2D, texto: string, larguraMax: number, tamanho: number, minimo: number, familia: string) {
  let t = tamanho;
  ctx.font = `600 ${t}px ${familia}`;
  while (ctx.measureText(texto).width > larguraMax && t > minimo) {
    t -= 1;
    ctx.font = `600 ${t}px ${familia}`;
  }
  let s = texto;
  if (ctx.measureText(s).width > larguraMax) {
    while (s.length > 1 && ctx.measureText(s + "…").width > larguraMax) s = s.slice(0, -1);
    s = s.trimEnd() + "…";
  }
  return { texto: s, tamanho: t };
}

export function desenharFace(canvas: HTMLCanvasElement, fatias: readonly Fatia[], tamanhoPx: number): void {
  const lado = Math.max(64, Math.round(tamanhoPx));
  if (canvas.width !== lado || canvas.height !== lado) {
    canvas.width = lado;
    canvas.height = lado;
  }
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const c = lado / 2;
  const R = c * 0.985;
  const n = fatias.length;
  const familia = familiaCanvasTitulo();
  ctx.clearRect(0, 0, lado, lado);
  ctx.save();
  ctx.translate(c, c);

  // disco de fundo
  ctx.fillStyle = PALETA.meiaNoite;
  ctx.beginPath();
  ctx.arc(0, 0, R, 0, Math.PI * 2);
  ctx.fill();

  if (n === 0) {
    ctx.restore();
    return;
  }

  // fatias
  fatias.forEach((f, i) => {
    const a0 = f.inicio - MEIO_PI;
    const a1 = f.inicio + f.largura - MEIO_PI;
    const g = ctx.createRadialGradient(0, 0, R * 0.12, 0, 0, R);
    g.addColorStop(0, "#081430");
    g.addColorStop(0.55, corBase(i, n));
    g.addColorStop(1, corBase(i, n));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, a0, a1);
    ctx.closePath();
    ctx.fill();

    // véu de luz da fita na borda (brilho falso, desenhado uma vez)
    const luz = corLuz(i, n);
    const v = ctx.createRadialGradient(0, 0, R * 0.55, 0, 0, R);
    v.addColorStop(0, hexAlfa(luz, 0));
    v.addColorStop(1, hexAlfa(luz, 0.28));
    ctx.fillStyle = v;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, R, a0, a1);
    ctx.closePath();
    ctx.fill();

    // filete luminoso perto do aro
    ctx.lineCap = "round";
    const folga = n > 1 ? Math.min(0.03, f.largura * 0.08) : 0;
    ctx.strokeStyle = hexAlfa(luz, 0.25);
    ctx.lineWidth = R * 0.05;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.92, a0 + folga, a1 - folga);
    ctx.stroke();
    ctx.strokeStyle = hexAlfa(luz, 0.95);
    ctx.lineWidth = R * 0.012;
    ctx.beginPath();
    ctx.arc(0, 0, R * 0.92, a0 + folga, a1 - folga);
    ctx.stroke();
  });

  // poeira de estrelas determinística
  let s = 7 + n * 13;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let k = 0; k < 90; k++) {
    const ang = rnd() * Math.PI * 2;
    const rr = R * (0.2 + rnd() * 0.66);
    ctx.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.45})`;
    ctx.beginPath();
    ctx.arc(Math.cos(ang) * rr, Math.sin(ang) * rr, R * (0.002 + rnd() * 0.004), 0, Math.PI * 2);
    ctx.fill();
  }

  // divisórias (linhas de constelação)
  if (n > 1) {
    ctx.strokeStyle = hexAlfa(PALETA.azulClaro, 0.85);
    ctx.lineWidth = Math.max(1, R * 0.006);
    for (const f of fatias) {
      const a = f.inicio - MEIO_PI;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * R * 0.17, Math.sin(a) * R * 0.17);
      ctx.lineTo(Math.cos(a) * R * 0.97, Math.sin(a) * R * 0.97);
      ctx.stroke();
    }
  }

  // anel de constelação: nós (estrelas) no aro ligados por linha fina
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = Math.max(1, R * 0.003);
  ctx.beginPath();
  ctx.arc(0, 0, R * 0.975, 0, Math.PI * 2);
  ctx.stroke();
  const nos = n > 1 ? fatias.map((f) => f.inicio) : [0];
  nos.forEach((ang, i) => {
    const a = ang - MEIO_PI;
    estrela(ctx, Math.cos(a) * R * 0.975, Math.sin(a) * R * 0.975, R * 0.045, corLuz(i, n), 1);
  });
  // estrelas menores no meio de cada arco
  fatias.forEach((f, i) => {
    const a = f.inicio + f.largura / 2 - MEIO_PI;
    estrela(ctx, Math.cos(a) * R * 0.975, Math.sin(a) * R * 0.975, R * 0.022, corLuz(i, n), 0.8);
  });

  // rótulos ao longo do raio
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  fatias.forEach((f) => {
    const meio = f.inicio + f.largura / 2 - MEIO_PI;
    const rInterno = R * 0.24;
    const rExterno = R * 0.84;
    const corda = n > 1 ? 2 * (R * 0.55) * Math.sin(Math.min(f.largura, Math.PI) / 2) : R;
    const tamanho = Math.max(10, Math.min(R * 0.085, corda * 0.55));
    const ajuste = ajustarTexto(ctx, f.rotulo, rExterno - rInterno, tamanho, Math.max(9, R * 0.032), familia);
    ctx.save();
    ctx.rotate(meio);
    ctx.font = `600 ${ajuste.tamanho}px ${familia}`;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = ajuste.tamanho * 0.25;
    ctx.fillStyle = PALETA.branco;
    ctx.fillText(ajuste.texto, rExterno, 0);
    ctx.restore();
  });

  ctx.restore();
}
