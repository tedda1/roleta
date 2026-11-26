"use client";
import { useEffect } from "react";
import { som } from "@/audio/som";

/** Travas de totem: sem menu de contexto, zoom, arrastar imagens; tela sempre acesa. */
export function useKiosk(): void {
  useEffect(() => {
    const impedir = (e: Event) => e.preventDefault();
    const roda = (e: WheelEvent) => {
      if (e.ctrlKey) e.preventDefault();
    };
    const teclas = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && ["+", "-", "=", "0"].includes(e.key)) e.preventDefault();
    };

    let trava: WakeLockSentinel | null = null;
    const pedirTela = async () => {
      try {
        if (document.visibilityState === "visible" && "wakeLock" in navigator && (!trava || trava.released)) {
          trava = await navigator.wakeLock.request("screen");
          trava.addEventListener("release", () => {
            trava = null;
          });
        }
      } catch {
        trava = null;
      }
    };
    const visibilidade = () => {
      if (document.visibilityState === "visible") void pedirTela();
    };

    // A cada toque: destrava o áudio, garante tela acesa e volta à tela cheia se alguém saiu dela.
    const primeiroToque = () => {
      som.desbloquear();
      if (!trava) void pedirTela();
      const telaDeTeste = location.pathname.startsWith("/teste-3d") || location.search.includes("janela");
      if (process.env.NODE_ENV === "production" && !document.fullscreenElement && !telaDeTeste) {
        document.documentElement.requestFullscreen?.().catch(() => {});
      }
    };

    document.addEventListener("contextmenu", impedir);
    document.addEventListener("dragstart", impedir);
    document.addEventListener("gesturestart", impedir);
    document.addEventListener("wheel", roda, { passive: false });
    document.addEventListener("keydown", teclas);
    document.addEventListener("visibilitychange", visibilidade);
    document.addEventListener("pointerdown", primeiroToque, { capture: true });
    void pedirTela();
    return () => {
      document.removeEventListener("contextmenu", impedir);
      document.removeEventListener("dragstart", impedir);
      document.removeEventListener("gesturestart", impedir);
      document.removeEventListener("wheel", roda);
      document.removeEventListener("keydown", teclas);
      document.removeEventListener("visibilitychange", visibilidade);
      document.removeEventListener("pointerdown", primeiroToque, { capture: true });
      void trava?.release().catch(() => {});
    };
  }, []);
}
