/**
 * Gesto da roleta (2D e 3D): agarrar e lançar com o dedo.
 * O gesto define só SENTIDO, FORÇA e DURAÇÃO do giro; o resultado já é sorteado no commit.
 * Abaixo do limiar de velocidade (ou pointercancel), nada é registrado.
 */
import { anguloAtual } from "@/core/geometria";
import type { TotemStore } from "@/core/totem";

export interface CentroRoleta {
  x: number;
  y: number;
  raio: number;
}

const LIMIAR_LANCE = 2.5; // rad/s
const ARRASTO_MINIMO = 0.6; // rad (~1/10 de volta) arrastados contam como giro ao soltar
const JANELA_MS = 110;

export function ligarGesto(el: HTMLElement, store: TotemStore, obterCentro: () => CentroRoleta | null): () => void {
  let ponteiro: number | null = null;
  let thetaInicio = 0;
  let angAnterior = 0;
  let acumulado = 0;
  let amostras: { t: number; theta: number }[] = [];

  const angulo = (e: PointerEvent, c: CentroRoleta) => Math.atan2(e.clientY - c.y, e.clientX - c.x);

  const baixo = (e: PointerEvent) => {
    if (ponteiro !== null) return;
    const c = obterCentro();
    if (!c) return;
    const d = Math.hypot(e.clientX - c.x, e.clientY - c.y);
    if (d > c.raio * 1.08) return;
    const fase = store.getEstado().fase;
    if (fase === "atracao") {
      store.comecar();
      return;
    }
    if (fase !== "pronto" || d < c.raio * 0.1) return;
    ponteiro = e.pointerId;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignora */
    }
    thetaInicio = anguloAtual(store.rotacao, performance.now());
    angAnterior = angulo(e, c);
    acumulado = 0;
    amostras = [{ t: e.timeStamp, theta: thetaInicio }];
    store.arrastar(thetaInicio);
  };

  const mover = (e: PointerEvent) => {
    if (e.pointerId !== ponteiro) return;
    const c = obterCentro();
    if (!c) return;
    const a = angulo(e, c);
    let d = a - angAnterior;
    if (d > Math.PI) d -= Math.PI * 2;
    if (d < -Math.PI) d += Math.PI * 2;
    angAnterior = a;
    acumulado += d;
    const theta = thetaInicio + acumulado;
    store.arrastar(theta);
    amostras.push({ t: e.timeStamp, theta });
    while (amostras.length > 2 && e.timeStamp - amostras[0].t > JANELA_MS) amostras.shift();
  };

  const encerrar = (e: PointerEvent, lancar: boolean) => {
    if (e.pointerId !== ponteiro) return;
    ponteiro = null;
    const ultimo = amostras[amostras.length - 1];
    const primeiro = amostras[0];
    const dt = (ultimo.t - primeiro.t) / 1000;
    const recente = e.timeStamp - ultimo.t < 80;
    const w = dt > 0.01 && recente ? (ultimo.theta - primeiro.theta) / dt : 0;
    if (lancar && Math.abs(acumulado) >= ARRASTO_MINIMO && Math.abs(w) < LIMIAR_LANCE) {
      // sem botão "Girar": arrastar um bom pedaço e soltar devagar também gira (no sentido do arrasto)
      void store.girar(7, Math.sign(acumulado));
    } else if (lancar && Math.abs(w) >= LIMIAR_LANCE) {
      void store.girar(Math.min(16, Math.max(5, Math.abs(w))), Math.sign(w));
    } else {
      store.soltarSemGiro();
    }
  };

  const cima = (e: PointerEvent) => encerrar(e, true);
  const cancelar = (e: PointerEvent) => encerrar(e, false);

  el.addEventListener("pointerdown", baixo);
  el.addEventListener("pointermove", mover);
  el.addEventListener("pointerup", cima);
  el.addEventListener("pointercancel", cancelar);
  el.addEventListener("lostpointercapture", cancelar);
  return () => {
    el.removeEventListener("pointerdown", baixo);
    el.removeEventListener("pointermove", mover);
    el.removeEventListener("pointerup", cima);
    el.removeEventListener("pointercancel", cancelar);
    el.removeEventListener("lostpointercapture", cancelar);
  };
}
