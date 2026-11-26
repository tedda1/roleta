"use client";
import { useEffect, useRef } from "react";
import { desenharCeu } from "@/arte/ceu";
import s from "./CeuFundo.module.css";

/** Céu desenhado uma vez + parallax leve (só transform) + algumas estrelas cintilando (só opacity). */
export function CeuFundo({ leve }: { leve: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camadaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const desenhar = () => {
      // DPR 1 de propósito: arte suave, bitmap pequeno, desenho único
      desenharCeu(canvas, window.innerWidth * 1.06, window.innerHeight * 1.06, { semente: 2026 });
    };
    desenhar();
    const redimensionar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(desenhar, 200);
    };
    window.addEventListener("resize", redimensionar);
    return () => {
      window.removeEventListener("resize", redimensionar);
      if (timer) clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (leve) return;
    const camada = camadaRef.current;
    if (!camada) return;
    let alvoX = 0;
    let alvoY = 0;
    let x = 0;
    let y = 0;
    let quadro = 0;
    const mover = (e: PointerEvent) => {
      alvoX = (e.clientX / window.innerWidth - 0.5) * -14;
      alvoY = (e.clientY / window.innerHeight - 0.5) * -10;
    };
    const passo = () => {
      x += (alvoX - x) * 0.04;
      y += (alvoY - y) * 0.04;
      camada.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0)`;
      quadro = requestAnimationFrame(passo);
    };
    window.addEventListener("pointermove", mover, { passive: true });
    quadro = requestAnimationFrame(passo);
    return () => {
      window.removeEventListener("pointermove", mover);
      cancelAnimationFrame(quadro);
    };
  }, [leve]);

  return (
    <div className={s.ceu} aria-hidden>
      <div ref={camadaRef} className={s.camada}>
        <canvas ref={canvasRef} className={s.canvas} />
      </div>
      {!leve && (
        <div className={s.cintilas}>
          {CINTILAS.map(([x, y, d, a], i) => (
            <span key={i} style={{ left: `${x}%`, top: `${y}%`, animationDelay: `${d}s`, width: a, height: a }} />
          ))}
        </div>
      )}
    </div>
  );
}

const CINTILAS: [number, number, number, number][] = [
  [8, 12, 0, 5], [22, 30, 1.3, 4], [36, 8, 2.1, 6], [48, 22, 0.6, 3], [63, 10, 3.2, 5],
  [77, 26, 1.8, 4], [90, 14, 2.7, 6], [12, 70, 0.9, 4], [28, 86, 2.4, 5], [55, 92, 1.1, 4],
  [70, 78, 3.6, 6], [86, 88, 0.3, 4], [94, 56, 2.9, 5], [4, 46, 1.6, 4],
];
