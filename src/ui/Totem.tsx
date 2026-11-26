"use client";
import dynamic from "next/dynamic";
import { Component, ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { som } from "@/audio/som";
import { TotemStore } from "@/core/totem";
import Palco2D from "@/palco2d/Palco2D";
import { Admin } from "./Admin";
import { CeuFundo } from "./CeuFundo";
import { ligarGesto } from "./gesto";
import { useKiosk } from "./kiosk";
import { Painel } from "./Painel";
import { ModoPalco, Preferencias, lerPreferencias, salvarPreferencias } from "./preferencias";
import s from "./Totem.module.css";

// O 3D (three.js) só é baixado quando a versão 3D é escolhida.
const Palco3D = dynamic(() => import("@/palco3d/Palco3D"), { ssr: false, loading: () => null });

/** Se o 3D quebrar, cai para o 2D sem perder o estado (que vive no TotemStore). */
class GuardaPalco extends Component<{ aoFalhar: (m: string) => void; children: ReactNode }, { falhou: boolean }> {
  state = { falhou: false };
  static getDerivedStateFromError() {
    return { falhou: true };
  }
  componentDidCatch(e: unknown) {
    this.props.aoFalhar(e instanceof Error ? e.message : "erro no 3D");
  }
  render() {
    return this.state.falhou ? null : this.props.children;
  }
}

export default function Totem({ modoInicial }: { modoInicial?: ModoPalco }) {
  const [store] = useState(() => new TotemStore());
  const estado = useSyncExternalStore(store.assinar, store.getEstado, store.getEstado);
  const [prefs, setPrefs] = useState<Preferencias>({ modo: modoInicial ?? "2d", leve: false });
  const [motivo3d, setMotivo3d] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const celulaRef = useRef<HTMLDivElement>(null);
  const toquesCanto = useRef<number[]>([]);

  useKiosk();

  useEffect(() => {
    const p = lerPreferencias();
    const q = new URLSearchParams(location.search);
    const modoUrl = q.get("modo");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preferências só existem no navegador
    setPrefs({
      // prioridade: ?modo= na URL > escolha salva no administrador > rota (/3d/) > 2D
      modo: modoUrl === "2d" || modoUrl === "3d" ? modoUrl : p.salvo ? p.modo : (modoInicial ?? p.modo),
      leve: q.get("leve") === "1" || p.leve,
    });
    void store.iniciar();
  }, [store, modoInicial]);

  useEffect(() => store.definirMovimentoOcioso(!prefs.leve), [store, prefs.leve]);
  useEffect(() => {
    som.ativo = estado.evento?.som ?? true;
  }, [estado.evento?.som]);
  useEffect(() => store.aoTique(() => som.tique()), [store]);
  useEffect(() => {
    if (estado.fase === "resultado" && !estado.retomada) som.brilho();
  }, [estado.fase, estado.retomada]);

  useEffect(() => {
    const el = celulaRef.current;
    if (!el) return;
    return ligarGesto(el, store, () => {
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, raio: r.width / 2 };
    });
  }, [store]);

  const abrirAdmin = useCallback(() => {
    if (store.podeAbrirAdmin()) setAdmin(true);
  }, [store]);
  const fecharAdmin = useCallback(() => setAdmin(false), []);

  useEffect(() => {
    const tecla = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "a") {
        e.preventDefault();
        e.stopPropagation();
        abrirAdmin();
      }
    };
    window.addEventListener("keydown", tecla, { capture: true });
    return () => window.removeEventListener("keydown", tecla, { capture: true });
  }, [abrirAdmin]);

  // Qualquer toque reinicia o contador de ociosidade.
  useEffect(() => {
    const tocar = () => store.tocar();
    window.addEventListener("pointerdown", tocar, { capture: true, passive: true });
    return () => window.removeEventListener("pointerdown", tocar, { capture: true });
  }, [store]);

  const toqueCanto = () => {
    const agora = Date.now();
    toquesCanto.current = [...toquesCanto.current.filter((t) => agora - t < 3000), agora];
    if (toquesCanto.current.length >= 5) {
      toquesCanto.current = [];
      abrirAdmin();
    }
  };

  const mudarPrefs = (p: Preferencias) => {
    setPrefs(p);
    salvarPreferencias(p);
    if (p.modo === "3d") setMotivo3d(null);
  };

  const falhou3d = useCallback((m: string) => {
    console.warn("3D desativado:", m);
    setMotivo3d(m);
    // lembra a queda para não repetir a tentativa a cada recarga
    salvarPreferencias({ ...lerPreferencias(), modo: "2d" });
  }, []);

  const modo: ModoPalco = prefs.modo === "3d" && !motivo3d ? "3d" : "2d";

  return (
    <>
      {modo === "2d" && <CeuFundo leve={prefs.leve} />}
      {modo === "3d" && (
        <GuardaPalco aoFalhar={falhou3d}>
          <Palco3D store={store} fatias={estado.fatias} fase={estado.fase} leve={prefs.leve} celulaRef={celulaRef} aoFalhar={falhou3d} />
        </GuardaPalco>
      )}
      <main className={`${s.totem} ${modo === "3d" ? s.modo3d : ""}`}>
        <div ref={celulaRef} className={s.celula} data-roleta>
          {modo === "2d" && <Palco2D store={store} fatias={estado.fatias} fase={estado.fase} leve={prefs.leve} />}
        </div>
        <div className={s.lado}>
          <Painel key={estado.fase} store={store} estado={estado} abrirAdmin={abrirAdmin} />
        </div>
      </main>
      <div className={s.cantoAdmin} onPointerDown={toqueCanto} aria-hidden />
      {admin && <Admin store={store} estado={estado} prefs={prefs} mudarPrefs={mudarPrefs} motivo3d={motivo3d} fechar={fecharAdmin} />}
    </>
  );
}
