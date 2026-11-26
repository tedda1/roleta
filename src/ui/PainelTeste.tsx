"use client";
/**
 * Barra de controle da tela de teste (/teste-3d/): dados de exemplo, CPF de teste,
 * jogadas automáticas, reinício e medidor de quadros. Nunca aparece no totem real.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CONFIG_DEMO, gerarCpfTeste, proximoBrindeExtra } from "@/core/demo";
import { LIMITE_BRINDES } from "@/core/regras";
import type { EstadoTotem, TotemStore } from "@/core/totem";
import type { ModoPalco } from "./preferencias";
import s from "./PainelTeste.module.css";

interface Props {
  store: TotemStore;
  estado: EstadoTotem;
  modo: ModoPalco;
  leve: boolean;
  motivo3d: string | null;
  alternarModo: () => void;
  alternarLeve: () => void;
}

export function PainelTeste({ store, estado, modo, leve, motivo3d, alternarModo, alternarLeve }: Props) {
  const [aberto, setAberto] = useState(true);
  const [auto, setAuto] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fpsRef = useRef<HTMLSpanElement>(null);
  const { fase } = estado;

  const preencherCpf = useCallback(() => {
    const f = store.getEstado().fase;
    if (f === "atracao") store.comecar();
    if (store.getEstado().fase !== "cpf") return;
    store.limpar();
    for (const d of gerarCpfTeste()) store.digitar(d);
  }, [store]);

  const girar = useCallback(() => {
    // força e sentido aleatórios só para variar a animação; o resultado é sorteado no commit
    const w0 = 6 + Math.random() * 10;
    void store.girar(w0, Math.random() < 0.5 ? -1 : 1);
  }, [store]);

  const reiniciar = useCallback(async () => {
    try {
      await store.encerrarEvento();
      await store.abrirEvento(CONFIG_DEMO);
      setMsg("Demonstração reiniciada com os brindes de exemplo.");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, [store]);

  const adicionarBrinde = useCallback(async () => {
    const ev = store.getEstado().evento;
    if (!ev) return;
    const brinde = proximoBrindeExtra(ev.brindes.map((b) => b.id));
    try {
      await store.adicionarBrinde(brinde);
      setMsg(`Entrou na roleta: ${brinde.nome} (× ${brinde.quantidade}).`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    }
  }, [store]);

  // Jogadas automáticas: atração -> CPF -> girar -> resultado -> ... (reinicia ao esgotar)
  useEffect(() => {
    if (!auto) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    if (fase === "atracao") t = setTimeout(preencherCpf, 1500);
    else if (fase === "cpf" && !estado.verificando) t = setTimeout(preencherCpf, estado.aviso ? 1500 : 700);
    else if (fase === "pronto") t = setTimeout(girar, 1000);
    else if (fase === "resultado") t = setTimeout(() => store.fecharResultado(), 3500);
    else if (fase === "esgotado") t = setTimeout(() => void reiniciar(), 3000);
    return () => clearTimeout(t);
  }, [auto, fase, estado.verificando, estado.aviso, estado.digitos, preencherCpf, girar, reiniciar, store]);

  // Medidor de quadros: escreve direto no DOM a cada 0,5 s (sem re-render do React).
  useEffect(() => {
    let quadros = 0;
    let inicio = performance.now();
    let id = 0;
    const passo = (t: number) => {
      quadros++;
      if (t - inicio >= 500) {
        const fps = (quadros * 1000) / (t - inicio);
        if (fpsRef.current) {
          fpsRef.current.textContent = `${fps.toFixed(0)} fps`;
          fpsRef.current.dataset.nivel = fps >= 50 ? "bom" : fps >= 28 ? "medio" : "ruim";
        }
        quadros = 0;
        inicio = t;
      }
      id = requestAnimationFrame(passo);
    };
    id = requestAnimationFrame(passo);
    return () => cancelAnimationFrame(id);
  }, []);

  const restantes = [...estado.estoque.values()].reduce((a, b) => a + b, 0);
  const jogadas = estado.jogadas.filter((j) => j.status !== "estornado").length;

  if (!aberto) {
    return (
      <aside className={`${s.barra} ${s.fechada}`} data-ui>
        <span className={s.selo}>TESTE</span>
        <span ref={fpsRef} className={s.fps} />
        <button className={s.botao} onClick={() => setAberto(true)}>
          Controles
        </button>
      </aside>
    );
  }

  return (
    <aside className={s.barra} data-ui>
      <div className={s.topo}>
        <span className={s.selo}>MODO TESTE · dados de exemplo</span>
        <span ref={fpsRef} className={s.fps} />
        <span className={s.info}>
          {modo.toUpperCase()}
          {leve ? " leve" : ""} · fase <strong>{fase}</strong> · {estado.fatias.length} na roleta · {restantes} unid. · {jogadas} jogadas
        </span>
        <button className={s.mini} onClick={() => setAberto(false)} aria-label="Recolher controles">
          ▾
        </button>
      </div>
      <div className={s.botoes}>
        <button className={s.botao} disabled={fase !== "atracao" && fase !== "cpf"} onClick={preencherCpf}>
          CPF de teste
        </button>
        <button className={`${s.botao} ${s.destaque}`} disabled={fase !== "pronto"} onClick={girar}>
          Girar
        </button>
        <button className={`${s.botao} ${auto ? s.ligado : ""}`} onClick={() => setAuto((a) => !a)}>
          Automático: {auto ? "ligado" : "desligado"}
        </button>
        <button
          className={s.botao}
          disabled={fase === "girando" || !estado.evento || estado.evento.brindes.length >= LIMITE_BRINDES}
          onClick={() => void adicionarBrinde()}
        >
          + Brinde ({estado.evento?.brindes.length ?? 0}/{LIMITE_BRINDES})
        </button>
        <button className={s.botao} disabled={fase === "girando"} onClick={() => void reiniciar()}>
          Reiniciar brindes
        </button>
        <button className={s.botao} onClick={alternarModo}>
          Ver em {modo === "3d" ? "2D" : "3D"}
        </button>
        <button className={s.botao} onClick={alternarLeve}>
          Modo leve: {leve ? "ligado" : "desligado"}
        </button>
      </div>
      {(motivo3d || msg) && <p className={s.msg}>{motivo3d ? `3D desativado: ${motivo3d}` : msg}</p>}
      <p className={s.dica}>Arraste e solte a roleta para lançar · toque no céu para soltar faíscas · admin: 5 toques no canto (PIN 1234)</p>
    </aside>
  );
}
