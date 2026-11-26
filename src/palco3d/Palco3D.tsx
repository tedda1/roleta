"use client";
import { RefObject, useEffect, useRef } from "react";
import type { Fatia } from "@/core/geometria";
import type { Fase, TotemStore } from "@/core/totem";
import { Cena } from "./cena";
import { avaliarWebGL } from "./deteccao";

interface Props {
  store: TotemStore;
  fatias: Fatia[];
  fase: Fase;
  leve: boolean;
  celulaRef: RefObject<HTMLDivElement | null>;
  aoFalhar: (motivo: string) => void;
}

export default function Palco3D({ store, fatias, fase, leve, celulaRef, aoFalhar }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const cenaRef = useRef<Cena | null>(null);
  const fatiasRef = useRef(fatias);
  const faseRef = useRef(fase);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const av = avaliarWebGL();
    if (!av.ok) {
      aoFalhar(av.motivo ?? "WebGL indisponível");
      return;
    }
    let cena: Cena;
    try {
      cena = new Cena(host, store, {
        leve,
        obterCelula: () => celulaRef.current?.getBoundingClientRect() ?? null,
        aoFalhar,
      });
    } catch (e) {
      aoFalhar(e instanceof Error ? e.message : "falha ao criar a cena 3D");
      return;
    }
    cena.definirFatias(fatiasRef.current);
    cena.definirFase(faseRef.current);
    cenaRef.current = cena;
    return () => {
      cena.destruir();
      cenaRef.current = null;
    };
  }, [store, leve, celulaRef, aoFalhar]);

  useEffect(() => {
    fatiasRef.current = fatias;
    cenaRef.current?.definirFatias(fatias);
  }, [fatias]);

  useEffect(() => {
    faseRef.current = fase;
    cenaRef.current?.definirFase(fase);
  }, [fase]);

  return <div ref={hostRef} style={{ position: "fixed", inset: 0, zIndex: 0 }} aria-hidden />;
}
