"use client";
/**
 * Roleta 2D com detalhes 3D. Custo por quadro: UMA escrita de transform no disco
 * (e no ponteiro quando ele balança). Sem repaint: a face é um canvas pré-desenhado.
 */
import { useEffect, useRef } from "react";
import { desenharFace } from "@/arte/face";
import { Fatia, anguloAtual, fatiaSobPonteiro } from "@/core/geometria";
import type { Fase, TotemStore } from "@/core/totem";
import s from "./Palco2D.module.css";

interface Props {
  store: TotemStore;
  fatias: Fatia[];
  fase: Fase;
  leve: boolean;
}

export default function Palco2D({ store, fatias, fase, leve }: Props) {
  const raizRef = useRef<HTMLDivElement>(null);
  const faceRef = useRef<HTMLCanvasElement>(null);
  const ponteiroRef = useRef<HTMLDivElement>(null);
  const fatiasRef = useRef(fatias);

  // Redesenha a face só quando as fatias ou o tamanho mudam.
  useEffect(() => {
    fatiasRef.current = fatias;
    const raiz = raizRef.current;
    const face = faceRef.current;
    if (!raiz || !face) return;
    const desenhar = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, leve ? 1 : 1.5);
      desenharFace(face, fatias, Math.min(1400, raiz.clientWidth * dpr));
    };
    desenhar();
    const ro = new ResizeObserver(desenhar);
    ro.observe(raiz);
    let vivo = true;
    document.fonts?.ready.then(() => vivo && desenhar());
    return () => {
      vivo = false;
      ro.disconnect();
    };
  }, [fatias, leve]);

  // Laço de animação.
  useEffect(() => {
    const face = faceRef.current;
    const ponteiro = ponteiroRef.current;
    if (!face || !ponteiro) return;
    let quadro = 0;
    let ultimo = "";
    let indice = -2;
    let fatiasVistas = fatiasRef.current;
    let balanco = 0;
    const passo = () => {
      const theta = anguloAtual(store.rotacao, performance.now());
      const t = `rotate(${theta.toFixed(4)}rad)`;
      if (t !== ultimo) {
        face.style.transform = t;
        ultimo = t;
      }
      if (fatiasVistas !== fatiasRef.current) {
        fatiasVistas = fatiasRef.current;
        indice = -2;
      }
      const i = fatiaSobPonteiro(fatiasVistas, theta);
      if (i !== indice) {
        if (indice !== -2 && store.rotacao.tipo !== "ocioso") {
          balanco = 1;
          store.emitirTique();
        }
        indice = i;
      }
      if (balanco > 0.01) {
        balanco *= 0.84;
        ponteiro.style.transform = `rotate(${(-18 * balanco).toFixed(2)}deg)`;
      } else if (balanco !== 0) {
        balanco = 0;
        ponteiro.style.transform = "";
      }
      quadro = requestAnimationFrame(passo);
    };
    quadro = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(quadro);
  }, [store]);

  const classe = [s.raiz, leve ? s.leve : "", fase === "resultado" ? s.vitoria : "", fase === "pronto" ? s.pronto : ""].join(" ");

  return (
    <div ref={raizRef} className={classe} aria-hidden>
      <div className={s.halo} />
      <div className={s.sombra} />
      <div className={s.inclinado}>
        <div className={`${s.espessura} ${s.e2}`} />
        <div className={`${s.espessura} ${s.e1}`} />
        <canvas ref={faceRef} className={s.face} />
        <div className={s.aro} />
        <div className={s.brilho} />
        <div className={s.pulso} />
        <div className={s.cubo}>
          <span className={s.estrela} />
        </div>
        <div ref={ponteiroRef} className={s.ponteiro}>
          <span className={s.cristal} />
        </div>
      </div>
    </div>
  );
}
