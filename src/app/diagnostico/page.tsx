"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { avaliarWebGL } from "@/palco3d/deteccao";

interface Linha {
  item: string;
  valor: string;
  ok: boolean | null;
}

function medirQuadros(ms: number): Promise<number> {
  return new Promise((resolve) => {
    const tempos: number[] = [];
    let ultimo = 0;
    const inicio = performance.now();
    const passo = (t: number) => {
      if (ultimo) tempos.push(t - ultimo);
      ultimo = t;
      if (t - inicio < ms) requestAnimationFrame(passo);
      else {
        tempos.sort((a, b) => a - b);
        resolve(tempos[Math.floor(tempos.length / 2)] ?? 0);
      }
    };
    requestAnimationFrame(passo);
  });
}

/** Página para rodar no PC do evento ANTES da festa e decidir 2D/3D com dados reais. */
export default function Diagnostico() {
  const [linhas, setLinhas] = useState<Linha[]>([]);

  useEffect(() => {
    void (async () => {
      const l: Linha[] = [];
      const ua = navigator.userAgent;
      const chrome = /Chrome\/(\d+)/.exec(ua);
      const versao = chrome ? Number(chrome[1]) : 0;
      l.push({ item: "Navegador", valor: ua, ok: versao >= 111 });
      l.push({ item: "Endereço", valor: location.origin, ok: location.hostname === "localhost" || location.protocol === "https:" });
      l.push({ item: "Tela", valor: `${screen.width}×${screen.height} · janela ${innerWidth}×${innerHeight} · DPR ${devicePixelRatio}`, ok: null });
      l.push({ item: "Toque", valor: `${navigator.maxTouchPoints} pontos`, ok: navigator.maxTouchPoints > 0 });
      l.push({ item: "WebCrypto", valor: globalThis.crypto?.subtle ? "disponível" : "INDISPONÍVEL", ok: !!globalThis.crypto?.subtle });
      l.push({ item: "IndexedDB", valor: typeof indexedDB !== "undefined" ? "disponível" : "INDISPONÍVEL", ok: typeof indexedDB !== "undefined" });
      const persistido = await navigator.storage?.persisted?.().catch(() => false);
      l.push({ item: "Armazenamento persistente", valor: persistido ? "sim" : "não (o Chrome pode conceder ao abrir a roleta)", ok: persistido ?? null });
      l.push({ item: "Wake Lock (tela acesa)", valor: "wakeLock" in navigator ? "disponível" : "indisponível", ok: "wakeLock" in navigator });
      const gl = avaliarWebGL();
      l.push({ item: "WebGL 2 / GPU", valor: gl.ok ? (gl.renderizador ?? "ok") : (gl.motivo ?? "falhou"), ok: gl.ok });
      setLinhas([...l]);
      const mediana = await medirQuadros(2000);
      l.push({ item: "Quadro (página ociosa)", valor: `${mediana.toFixed(1)} ms (≈${Math.round(1000 / Math.max(1, mediana))} Hz)`, ok: mediana < 20 });
      l.push({
        item: "Recomendação",
        valor: !gl.ok ? "Use a versão 2D." : mediana < 20 ? "2D ok. Teste a 3D em /3d/ e veja se fica fluida." : "Use a versão 2D com modo leve.",
        ok: null,
      });
      setLinhas([...l]);
    })();
  }, []);

  return (
    <main style={{ position: "fixed", inset: 0, overflow: "auto", padding: 32, fontFamily: "system-ui, sans-serif", background: "#0a2248", color: "#fff", userSelect: "text", touchAction: "pan-y" }}>
      <h1 style={{ marginTop: 0 }}>Diagnóstico do PC do evento</h1>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 18 }}>
        <tbody>
          {linhas.map((x) => (
            <tr key={x.item} style={{ borderBottom: "1px solid #374254" }}>
              <td style={{ padding: 8, width: 32 }}>{x.ok === null ? "•" : x.ok ? "✅" : "⚠️"}</td>
              <td style={{ padding: 8, fontWeight: 600, whiteSpace: "nowrap" }}>{x.item}</td>
              <td style={{ padding: 8, wordBreak: "break-word" }}>{x.valor}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ display: "flex", gap: 16, marginTop: 24 }}>
        <Link href="/" style={{ color: "#ffd23f", fontSize: 20 }}>
          Abrir roleta 2D
        </Link>
        <Link href="/3d/" style={{ color: "#ffd23f", fontSize: 20 }}>
          Abrir roleta 3D
        </Link>
      </p>
    </main>
  );
}
