"use client";
import dynamic from "next/dynamic";
import { Component, ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { som } from "@/audio/som";
import { CONFIG_DEMO, OPCOES_DEMO } from "@/core/demo";
import { TotemStore } from "@/core/totem";
import Palco2D from "@/palco2d/Palco2D";
import { Admin } from "./Admin";
import { CeuFundo } from "./CeuFundo";
import { ligarGesto } from "./gesto";
import { useKiosk } from "./kiosk";
import { CpfSaindo, Painel } from "./Painel";
import { PainelTeste } from "./PainelTeste";
import { ModoPalco, Preferencias, lerPreferencias, salvarPreferencias } from "./preferencias";
import { Qualidade, proximaQualidade } from "@/palco3d/qualidade";

const QUALIDADES_URL: Qualidade[] = ["auto", "leve", "normal", "alta"];
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

interface PropsTotem {
  modoInicial?: ModoPalco;
  /** Tela de teste: banco separado, dados de exemplo e barra de controles. */
  demo?: boolean;
}

export default function Totem({ modoInicial, demo = false }: PropsTotem) {
  const [store] = useState(() => new TotemStore(undefined, demo ? OPCOES_DEMO : {}));
  const estado = useSyncExternalStore(store.assinar, store.getEstado, store.getEstado);
  const [prefs, setPrefs] = useState<Preferencias>({ modo: modoInicial ?? "2d", qualidade: "auto" });
  const leve = prefs.qualidade === "leve";
  // nível efetivo da cena 3D (o avaliador de desempenho pode rebaixar durante o uso)
  const [nivelAtivo, setNivelAtivo] = useState<string | null>(null);
  useEffect(() => {
    const aoNivel = (e: Event) => setNivelAtivo(String((e as CustomEvent).detail));
    window.addEventListener("roleta:nivel", aoNivel);
    return () => window.removeEventListener("roleta:nivel", aoNivel);
  }, []);
  const [motivo3d, setMotivo3d] = useState<string | null>(null);
  const [admin, setAdmin] = useState(false);
  const celulaRef = useRef<HTMLDivElement>(null);
  const toquesCanto = useRef<number[]>([]);

  useKiosk();

  useEffect(() => {
    // A tela de teste não lê nem grava as preferências do totem real.
    const p = demo ? { modo: modoInicial ?? "3d", qualidade: "auto" as Qualidade, salvo: false } : lerPreferencias();
    const q = new URLSearchParams(location.search);
    const modoUrl = q.get("modo");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- preferências só existem no navegador
    setPrefs({
      // prioridade: ?modo= na URL > escolha salva no administrador > rota (/3d/) > 2D
      modo: modoUrl === "2d" || modoUrl === "3d" ? modoUrl : p.salvo ? p.modo : (modoInicial ?? p.modo),
      qualidade: q.get("leve") === "1" ? "leve" : QUALIDADES_URL.includes(q.get("qualidade") as Qualidade) ? (q.get("qualidade") as Qualidade) : p.qualidade,
    });
    void store.iniciar().then(async () => {
      // Demonstração: abre o evento de exemplo sozinho na primeira vez.
      if (demo && store.getEstado().fase === "semEvento") await store.abrirEvento(CONFIG_DEMO).catch(console.error);
    });
  }, [store, modoInicial, demo]);

  useEffect(() => store.definirMovimentoOcioso(!leve), [store, leve]);
  useEffect(() => {
    som.ativo = estado.evento?.som ?? true;
  }, [estado.evento?.som]);
  useEffect(() => store.aoTique(() => som.tique()), [store]);
  useEffect(() => {
    if (estado.fase === "resultado" && !estado.retomada) som.brilho();
  }, [estado.fase, estado.retomada]);

  // Confirmou o CPF: o cartão "descola" da tela (2D) ou vira estrela (3D) enquanto a roleta chega.
  const [cpfSaindo, setCpfSaindo] = useState<string | null>(null);
  const faseAnterior = useRef(estado.fase);
  const timerSaida = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const antes = faseAnterior.current;
    faseAnterior.current = estado.fase;
    if (antes !== "cpf" || estado.fase !== "pronto" || estado.avulsa) return;
    setCpfSaindo(estado.digitos);
    som.brilho();
    if (timerSaida.current) clearTimeout(timerSaida.current);
    timerSaida.current = setTimeout(() => setCpfSaindo(null), 950);
  }, [estado.fase, estado.digitos, estado.avulsa]);
  useEffect(() => () => {
    if (timerSaida.current) clearTimeout(timerSaida.current);
  }, []);

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
    if (!demo) salvarPreferencias(p);
    if (p.modo === "3d") setMotivo3d(null);
  };

  const falhou3d = useCallback(
    (m: string) => {
      console.warn("3D desativado:", m);
      setMotivo3d(m);
      // lembra a queda para não repetir a tentativa a cada recarga (só no totem real)
      if (!demo) salvarPreferencias({ ...lerPreferencias(), modo: "2d" });
    },
    [demo],
  );

  const modo: ModoPalco = prefs.modo === "3d" && !motivo3d ? "3d" : "2d";
  const comRoleta = estado.fase === "pronto" || estado.fase === "girando" || estado.fase === "resultado";

  // 3D: enquanto a estrela viaja e vira roleta (~8 s), o painel com "Girar" fica escondido
  // e a roleta não aceita arrasto. A cena avisa o fim com o evento "roleta:chegada-concluida".
  const [aguardandoRoleta, setAguardandoRoleta] = useState(false);
  const faseAntesChegada = useRef(estado.fase);
  useEffect(() => {
    const antes = faseAntesChegada.current;
    faseAntesChegada.current = estado.fase;
    const semRoleta = antes !== "pronto" && antes !== "girando" && antes !== "resultado";
    if (estado.fase !== "pronto" || !semRoleta || antes === "carregando" || modo !== "3d") return;
    setAguardandoRoleta(true);
    store.tocar();
    const fim = () => {
      clearTimeout(seguranca);
      window.removeEventListener("roleta:chegada-concluida", fim);
      setAguardandoRoleta(false);
      store.tocar(); // o prazo de inatividade conta a partir da roleta pronta, não da confirmação
    };
    window.addEventListener("roleta:chegada-concluida", fim, { once: true });
    // nunca deixa o participante sem o botão; menor que a ociosidade (20 s) para sempre vencer
    const seguranca = setTimeout(fim, 13_000);
    return () => {
      window.removeEventListener("roleta:chegada-concluida", fim);
      clearTimeout(seguranca);
      setAguardandoRoleta(false);
    };
  }, [estado.fase, modo, store]);
  // atração e CPF são a mesma tela: não remonta (nem reanima) o painel ao digitar o 1º número
  const chavePainel = estado.fase === "atracao" || estado.fase === "cpf" ? "cpf" : estado.fase;

  return (
    <>
      {modo === "2d" && <CeuFundo leve={leve} />}
      {modo === "3d" && (
        <GuardaPalco aoFalhar={falhou3d}>
          <Palco3D store={store} fatias={estado.fatias} fase={estado.fase} qualidade={prefs.qualidade} celulaRef={celulaRef} aoFalhar={falhou3d} />
        </GuardaPalco>
      )}
      <main
        className={`${s.totem} ${modo === "3d" ? s.modo3d : ""} ${comRoleta ? "" : s.semRoleta} ${aguardandoRoleta ? s.aguardando : ""}`}
      >
        <div ref={celulaRef} className={s.celula} data-roleta>
          {modo === "2d" && <Palco2D store={store} fatias={estado.fatias} fase={estado.fase} leve={leve} />}
        </div>
        <div className={s.lado}>
          <Painel
            key={chavePainel}
            store={store}
            estado={estado}
            abrirAdmin={abrirAdmin}
            aguardandoRoleta={aguardandoRoleta}
            atrasoCss={modo === "2d"}
          />
        </div>
      </main>
      {cpfSaindo && <CpfSaindo digitos={cpfSaindo} variante={modo === "3d" ? "estrela" : "descolar"} />}
      {aguardandoRoleta && <p className={s.dicaPular}>Toque na tela para pular</p>}
      <div className={s.cantoAdmin} onPointerDown={toqueCanto} aria-hidden />
      {demo && (
        <PainelTeste
          store={store}
          estado={estado}
          modo={modo}
          qualidade={prefs.qualidade}
          motivo3d={motivo3d}
          nivelAtivo={nivelAtivo}
          aguardandoRoleta={aguardandoRoleta}
          alternarModo={() => mudarPrefs({ ...prefs, modo: modo === "3d" ? "2d" : "3d" })}
          alternarQualidade={() => mudarPrefs({ ...prefs, qualidade: proximaQualidade(prefs.qualidade) })}
        />
      )}
      {admin && <Admin store={store} estado={estado} prefs={prefs} mudarPrefs={mudarPrefs} motivo3d={motivo3d} fechar={fecharAdmin} />}
    </>
  );
}
