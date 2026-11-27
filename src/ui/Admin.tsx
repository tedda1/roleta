"use client";
import { NOMES_QUALIDADE, proximaQualidade } from "@/palco3d/qualidade";
import { useEffect, useRef, useState } from "react";
import { carregarConfig, ResultadoConfig } from "@/core/config";
import { formatarCpf } from "@/core/cpf";
import { validarBackup, type Backup } from "@/core/db";
import { CONFIG_DEMO } from "@/core/demo";
import {
  Brinde,
  ConfigBrindes,
  Evento,
  Jogada,
  LIMITE_BRINDES,
  LIMITE_NOME,
  ModoSorteio,
  brindeAtivo,
  codigoRetirada,
  idBrinde,
  validarConfig,
} from "@/core/regras";
import type { EstadoTotem, TotemStore } from "@/core/totem";
import { AcoesEditor, EditorBrindes, ItemEditor } from "./EditorBrindes";
import { ENTRADAS, NOMES_ENTRADA, NOMES_SOM, SONS_FORMACAO, proximo, type Preferencias } from "./preferencias";
import { ouvirSom } from "./ouvirSom";
import { Teclado } from "./Teclado";
import { CampoTexto, TecladoTexto } from "./TecladoTexto";
import s from "./Admin.module.css";

interface Props {
  store: TotemStore;
  estado: EstadoTotem;
  prefs: Preferencias;
  mudarPrefs: (p: Preferencias) => void;
  motivo3d: string | null;
  fechar: () => void;
}

type Aba = "evento" | "brindes" | "jogadas" | "cpf";

/** Roda uma ação do administrador mostrando o erro (ou a mensagem de sucesso). true = deu certo. */
type Executar = <T>(acao: () => Promise<T> | T, sucesso?: string | ((r: T) => string)) => Promise<boolean>;

function baixarJson(nome: string, dados: unknown) {
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function carimbo() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

const hora = (t?: number) => (t ? new Date(t).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "—");

const STATUS: Record<Jogada["status"], string> = { sorteado: "sorteado", revelado: "revelado", estornado: "estornado" };

const MODOS: [ModoSorteio, string, string][] = [
  ["porTipo", "Chance igual por tipo", "Cada tipo de brinde com estoque tem a mesma chance, seja 1 ou 50 unidades."],
  ["porUnidade", "Chance pelo estoque", "Quem tem mais unidades sai mais: 10 canecas pesam 10× mais que 1 smartwatch."],
];
const nomeModo = (m: ModoSorteio) => (m === "porTipo" ? "chance igual por tipo" : "chance pelo estoque");

/** Confirmação em dois toques que expira sozinha (sem window.confirm). */
function useDoisToques<T>(ms = 5000): [T | null, (v: T | null) => void] {
  const [pendente, setPendente] = useState<T | null>(null);
  useEffect(() => {
    if (pendente === null) return;
    const t = setTimeout(() => setPendente(null), ms);
    return () => clearTimeout(t);
  }, [pendente, ms]);
  return [pendente, setPendente];
}

export function Admin({ store, estado, prefs, mudarPrefs, motivo3d, fechar }: Props) {
  const [autorizado, setAutorizado] = useState(false);
  const [pin, setPin] = useState("");
  const [erroPin, setErroPin] = useState<string | null>(null);
  const [config, setConfig] = useState<ResultadoConfig | null>(null);
  const [aba, setAba] = useState<Aba>("evento");
  const [limite, setLimite] = useState(40);
  const [msg, setMsg] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [confirmarEncerrar, setConfirmarEncerrar] = useState(false);
  const [importacao, setImportacao] = useState<{ backup: Backup; outroEvento: boolean } | null>(null);
  const [cpfConsulta, setCpfConsulta] = useState("");
  const [achadas, setAchadas] = useState<Jogada[] | null>(null);
  const arquivoRef = useRef<HTMLInputElement>(null);
  const ultimaAtividade = useRef(0);

  useEffect(() => {
    void carregarConfig().then(setConfig);
  }, []);

  // Fecha sozinho após 2 min sem uso (toque ou teclado físico contam como uso).
  useEffect(() => {
    const marcar = () => (ultimaAtividade.current = Date.now());
    marcar();
    window.addEventListener("pointerdown", marcar, true);
    window.addEventListener("keydown", marcar, true);
    const t = setInterval(() => {
      if (Date.now() - ultimaAtividade.current > 120_000) fechar();
    }, 5000);
    return () => {
      window.removeEventListener("pointerdown", marcar, true);
      window.removeEventListener("keydown", marcar, true);
      clearInterval(t);
    };
  }, [fechar]);

  const executar: Executar = async (acao, sucesso) => {
    setOcupado(true);
    setMsg(null);
    try {
      const r = await acao();
      if (sucesso) setMsg(typeof sucesso === "function" ? sucesso(r) : sucesso);
      return true;
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setOcupado(false);
    }
  };

  const entrar = async () => {
    if (!estado.evento && !config?.config) {
      setErroPin(config ? "O brindes.json tem erros (veja abaixo)." : "Lendo brindes.json…");
      return;
    }
    if (store.bloqueioPin() > 0) {
      setErroPin(`Muitas tentativas. Aguarde ${store.bloqueioPin()} s.`);
      return;
    }
    const ok = await store.verificarPin(pin, config?.config ?? null);
    setPin("");
    if (ok) {
      setAutorizado(true);
      setErroPin(null);
    } else {
      const espera = store.bloqueioPin();
      setErroPin(espera > 0 ? `Muitas tentativas. Aguarde ${espera} s.` : "PIN incorreto.");
    }
  };

  const exportar = () => {
    const b = store.exportar();
    baixarJson(`roleta-backup-${carimbo()}.json`, b);
  };

  const lerArquivo = async (f: File) => {
    try {
      let bruto: unknown;
      try {
        bruto = JSON.parse(await f.text());
      } catch {
        throw new Error("O arquivo não é um JSON válido.");
      }
      validarBackup(bruto);
      const backup: Backup = bruto;
      // Sem evento carregado (ex.: estado de erro) também é preciso confirmar a substituição.
      const outroEvento = !estado.evento || estado.evento.id !== backup.evento!.id;
      setImportacao({ backup, outroEvento });
      setMsg(null);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Arquivo inválido.");
    }
  };

  if (!autorizado) {
    return (
      <div className={s.fundo}>
        <div className={`${s.janela} ${s.janelaPin}`}>
          <h2 className={s.titulo}>Administrador</h2>
          <p className={s.texto}>Digite o PIN</p>
          <div className={s.pin}>{pin.replace(/./g, "●") || " "}</div>
          <p className={s.erro}>{erroPin ?? " "}</p>
          {!estado.evento &&
            config?.erros.map((e) => (
              <p key={e} className={s.erro}>
                {e}
              </p>
            ))}
          {!estado.evento && config && !config.config && (
            <button className={s.botao} onClick={() => void carregarConfig().then(setConfig)}>
              Reler brindes.json
            </button>
          )}
          <Teclado
            compacto
            aoDigito={(d) => setPin((p) => (p.length < 8 ? p + d : p))}
            aoApagar={() => setPin((p) => p.slice(0, -1))}
            aoLimpar={() => setPin("")}
          />
          <div className={s.linha}>
            <button className={s.botao} onClick={fechar}>
              Voltar
            </button>
            <button className={`${s.botao} ${s.primario}`} disabled={pin.length < 4} onClick={() => void entrar()}>
              Entrar
            </button>
          </div>
          {!estado.evento && config?.exemplo && (
            <p className={s.nota}>Usando brindes.exemplo.json (PIN de exemplo). Crie public/brindes.json para o evento real.</p>
          )}
        </div>
      </div>
    );
  }

  const ev = estado.evento;
  const girando = estado.fase === "girando";
  const recentes = [...estado.jogadas].reverse().slice(0, limite);
  const totalRestante = ev ? ev.brindes.filter(brindeAtivo).reduce((soma, b) => soma + (estado.estoque.get(b.id) ?? 0), 0) : 0;

  const preferencias = (
    <>
      <button className={s.botao} onClick={() => mudarPrefs({ ...prefs, modo: prefs.modo === "2d" ? "3d" : "2d" })}>
        Versão: {prefs.modo === "2d" ? "2D" : "3D"} (trocar)
      </button>
      <button className={s.botao} onClick={() => mudarPrefs({ ...prefs, qualidade: proximaQualidade(prefs.qualidade) })}>
        Qualidade 3D: {NOMES_QUALIDADE[prefs.qualidade]}
      </button>
      <button className={s.botao} onClick={() => mudarPrefs({ ...prefs, entrada: proximo(ENTRADAS, prefs.entrada) })}>
        Entrada 3D: {NOMES_ENTRADA[prefs.entrada]}
      </button>
      <button
        className={s.botao}
        onClick={() => {
          const novo = proximo(SONS_FORMACAO, prefs.som);
          mudarPrefs({ ...prefs, som: novo });
          ouvirSom(novo);
        }}
      >
        Som da roleta: {NOMES_SOM[prefs.som]}
      </button>
      <button className={s.botao} onClick={() => ouvirSom(prefs.som)}>
        ▶ Ouvir som
      </button>
      <a className={s.botao} href="/diagnostico/">
        Diagnóstico do PC
      </a>
    </>
  );

  return (
    <div className={s.fundo}>
      <div className={s.janela}>
        <header className={s.cabecalho}>
          <h2 className={s.titulo}>Administrador</h2>
          <button className={s.botao} onClick={fechar}>
            Fechar
          </button>
        </header>

        <nav className={s.abas}>
          {(
            [
              ["evento", ev ? "Evento" : "Novo evento"],
              ["brindes", "Brindes"],
              ["jogadas", "Jogadas"],
              ["cpf", "Consultar CPF"],
            ] as [Aba, string][]
          ).map(([id, nome]) => (
            <button key={id} className={`${s.aba} ${aba === id ? s.abaAtiva : ""}`} onClick={() => setAba(id)} disabled={!ev && id !== "evento"}>
              {nome}
            </button>
          ))}
        </nav>

        {msg && <p className={s.mensagem}>{msg}</p>}

        <div className={s.conteudo}>
          {aba === "evento" && !ev && (
            <section className={s.secao}>
              <NovoEvento store={store} config={config} executar={executar} ocupado={ocupado} avisar={setMsg} />
              <div className={s.grade}>
                <button className={s.botao} onClick={() => arquivoRef.current?.click()}>
                  Restaurar backup…
                </button>
                {preferencias}
              </div>
            </section>
          )}

          {aba === "evento" && ev && (
            <section className={s.secao}>
              <h3>{ev.nome}</h3>
              <p className={s.texto}>
                Aberto às {hora(ev.criadoEm)} · {estado.jogadas.filter((j) => j.status !== "estornado").length} jogadas · {totalRestante}{" "}
                unidades restantes · {nomeModo(ev.modoSorteio)}
              </p>
              <p className={s.texto}>
                Armazenamento persistente: <strong>{estado.persistido ? "sim" : "não confirmado"}</strong> · endereço{" "}
                <strong>{typeof location !== "undefined" ? location.origin : ""}</strong>
              </p>

              <DadosEvento ev={ev} bloqueado={ocupado || girando} store={store} executar={executar} />

              <div className={s.grade}>
                <button className={s.botao} disabled={ocupado} onClick={() => void executar(() => store.alterarSom(!ev.som))}>
                  Som: {ev.som ? "ligado" : "desligado"}
                </button>
                <button
                  className={s.botao}
                  onClick={() =>
                    void executar(() => {
                      store.liberarAvulsa();
                      fechar();
                    })
                  }
                >
                  Liberar jogada sem CPF
                </button>
                <button className={s.botao} onClick={exportar}>
                  Exportar backup
                </button>
                <button className={s.botao} onClick={() => arquivoRef.current?.click()}>
                  Importar backup…
                </button>
                {preferencias}
              </div>
              {motivo3d && <p className={s.nota}>3D desativado automaticamente: {motivo3d}</p>}

              <div className={s.perigo}>
                {!confirmarEncerrar ? (
                  <button className={`${s.botao} ${s.vermelho}`} onClick={() => setConfirmarEncerrar(true)}>
                    Encerrar evento e apagar dados…
                  </button>
                ) : (
                  <>
                    <p className={s.texto}>Um backup será baixado antes. Os CPFs e jogadas deste totem serão apagados.</p>
                    <div className={s.linha}>
                      <button className={s.botao} onClick={() => setConfirmarEncerrar(false)}>
                        Cancelar
                      </button>
                      <button
                        className={`${s.botao} ${s.vermelho}`}
                        disabled={ocupado}
                        onClick={() =>
                          void executar(async () => {
                            exportar();
                            await store.encerrarEvento();
                            setConfirmarEncerrar(false);
                          }, "Evento encerrado e dados apagados.")
                        }
                      >
                        Sim, encerrar
                      </button>
                    </div>
                  </>
                )}
              </div>
            </section>
          )}

          {aba === "brindes" && ev && (
            <section className={s.secao}>
              {girando && <p className={s.nota}>A roleta está girando. Aguarde o giro terminar para mexer nos brindes.</p>}
              <EditorBrindes itens={itensDoEvento(ev, estado)} acoes={acoesDoEvento(store, ev, estado, executar)} bloqueado={ocupado || girando} />
              <p className={s.nota}>
                A ordem da lista é a ordem das fatias. −1/+1 ficam registrados como ajustes. Brinde que já saiu não é apagado: fica desativado.
              </p>
            </section>
          )}

          {aba === "jogadas" && ev && (
            <section className={s.secao}>
              {recentes.length === 0 && <p className={s.texto}>Nenhuma jogada ainda.</p>}
              <table className={s.tabela}>
                <tbody>
                  {recentes.map((j) => (
                    <LinhaJogada key={j.id} j={j} ocupado={ocupado} estornar={(dev) => void executar(() => store.estornar(j.id, dev), "Jogada estornada; CPF liberado.")} />
                  ))}
                </tbody>
              </table>
              {estado.jogadas.length > limite && (
                <button className={s.botao} onClick={() => setLimite((l) => l + 40)}>
                  Mostrar mais ({estado.jogadas.length - limite} restantes)
                </button>
              )}
            </section>
          )}

          {aba === "cpf" && ev && (
            <section className={`${s.secao} ${s.consulta}`}>
              <div className={s.pin}>{formatarCpf(cpfConsulta) || " "}</div>
              <Teclado
                compacto
                aoDigito={(d) => setCpfConsulta((c) => (c.length < 11 ? c + d : c))}
                aoApagar={() => setCpfConsulta((c) => c.slice(0, -1))}
                aoLimpar={() => {
                  setCpfConsulta("");
                  setAchadas(null);
                }}
              />
              <button
                className={`${s.botao} ${s.primario}`}
                disabled={cpfConsulta.length !== 11 || ocupado}
                onClick={() => void executar(async () => setAchadas(await store.consultarCpf(cpfConsulta)))}
              >
                Consultar
              </button>
              {achadas && achadas.length === 0 && <p className={s.texto}>Nenhuma jogada para este CPF (ou CPF inválido).</p>}
              {achadas && achadas.length > 0 && (
                <table className={s.tabela}>
                  <tbody>
                    {achadas.map((j) => (
                      <LinhaJogada key={j.id} j={j} ocupado={ocupado} estornar={(dev) => void executar(() => store.estornar(j.id, dev), "Jogada estornada; CPF liberado.")} />
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          )}
        </div>

        {importacao && (
          <div className={s.perigo}>
            <p className={s.texto}>
              Backup de <strong>{importacao.backup.evento?.nome}</strong> com {importacao.backup.jogadas.length} jogadas.{" "}
              {importacao.outroEvento ? "É de OUTRO evento: os dados atuais serão substituídos." : "Será unido aos dados atuais (nada é perdido)."}
            </p>
            <div className={s.linha}>
              <button className={s.botao} onClick={() => setImportacao(null)}>
                Cancelar
              </button>
              <button
                className={`${s.botao} ${importacao.outroEvento ? s.vermelho : s.primario}`}
                disabled={ocupado}
                onClick={() =>
                  void executar(async () => {
                    if (estado.evento) exportar();
                    await store.importar(importacao.backup, importacao.outroEvento);
                    setImportacao(null);
                  }, "Backup importado.")
                }
              >
                Importar
              </button>
            </div>
          </div>
        )}

        <input
          ref={arquivoRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void lerArquivo(f);
            e.target.value = "";
          }}
        />
      </div>
    </div>
  );
}

// ---------- brindes do evento aberto ----------

function itensDoEvento(ev: Evento, estado: EstadoTotem): ItemEditor[] {
  const saiu = new Set(estado.jogadas.map((j) => j.brindeId));
  const ajustado = new Map<string, number>();
  for (const a of estado.ajustes) ajustado.set(a.brindeId, (ajustado.get(a.brindeId) ?? 0) + a.delta);
  return ev.brindes.map((b) => ({
    id: b.id,
    nome: b.nome,
    rotulo: b.rotulo,
    // total = inicial + ajustes manuais, para "restam X de Y" fazer sentido depois de um +1
    total: Math.max(0, b.quantidade + (ajustado.get(b.id) ?? 0)),
    restam: estado.estoque.get(b.id) ?? 0,
    ativo: brindeAtivo(b),
    saiu: saiu.has(b.id),
  }));
}

function acoesDoEvento(store: TotemStore, ev: Evento, estado: EstadoTotem, executar: Executar): AcoesEditor {
  // ids já usados em qualquer lugar (inclusive brindes apagados que deixaram ajustes)
  const usados = () => [...ev.brindes.map((b) => b.id), ...estado.jogadas.map((j) => j.brindeId), ...estado.ajustes.map((a) => a.brindeId)];
  return {
    adicionar: (d) =>
      executar(
        () => store.adicionarBrinde({ id: idBrinde(d.nome, usados()), nome: d.nome, rotulo: d.rotulo, quantidade: d.quantidade }),
        `“${d.nome}” entrou na roleta.`,
      ),
    editar: (id, d) => executar(() => store.editarBrinde(id, d), "Brinde atualizado."),
    remover: (id) =>
      executar(
        () => store.removerBrinde(id),
        (r) => (r === "desativado" ? "Brinde desativado: já saiu em jogadas, então fica no histórico (pode reativar)." : "Brinde removido."),
      ),
    reativar: (id) => executar(() => store.reativarBrinde(id), "Brinde de volta na roleta."),
    mover: (id, direcao) => executar(() => store.moverBrinde(id, direcao)),
    ajustar: (id, delta) => executar(() => store.ajustarEstoque(id, delta)),
  };
}

/** Nome e modo de sorteio do evento já aberto. */
function DadosEvento({ ev, bloqueado, store, executar }: { ev: Evento; bloqueado: boolean; store: TotemStore; executar: Executar }) {
  const [nome, setNome] = useState<string | null>(null); // null = não está editando
  const [modoPendente, setModoPendente] = useDoisToques<ModoSorteio>();

  const salvarNome = async () => {
    if (nome === null || !nome.trim()) return;
    if (await executar(() => store.alterarEvento({ nome }), "Nome do evento atualizado.")) setNome(null);
  };

  return (
    <div className={s.bloco}>
      {nome === null ? (
        <div className={s.pinNovo}>
          <p className={`${s.texto} ${s.cresce}`}>
            Nome: <strong>{ev.nome}</strong>
          </p>
          <button className={s.botao} disabled={bloqueado} onClick={() => setNome(ev.nome)}>
            Renomear
          </button>
        </div>
      ) : (
        <>
          <CampoTexto rotulo="Nome do evento" valor={nome} aoMudar={setNome} limite={LIMITE_NOME} ativo aoAtivar={() => {}} aoEnter={() => void salvarNome()} />
          <TecladoTexto valor={nome} aoMudar={setNome} limite={LIMITE_NOME} desativado={bloqueado} />
          <div className={s.linha}>
            <button className={s.botao} onClick={() => setNome(null)}>
              Cancelar
            </button>
            <button className={`${s.botao} ${s.primario}`} disabled={bloqueado || !nome.trim()} onClick={() => void salvarNome()}>
              Salvar nome
            </button>
          </div>
        </>
      )}

      <p className={s.rotuloBloco}>Modo de sorteio</p>
      <div className={s.opcoes}>
        {MODOS.map(([m, rotulo]) => {
          const atual = ev.modoSorteio === m;
          const confirmando = modoPendente === m;
          return (
            <button
              key={m}
              className={`${s.botao} ${atual ? s.opcaoAtiva : ""} ${confirmando ? s.confirmar : ""}`}
              disabled={bloqueado}
              aria-pressed={atual}
              onClick={() => {
                if (atual) return setModoPendente(null);
                if (!confirmando) return setModoPendente(m);
                setModoPendente(null);
                void executar(() => store.alterarEvento({ modoSorteio: m }), `Sorteio agora: ${nomeModo(m)}.`);
              }}
            >
              {confirmando ? "Toque de novo para mudar" : rotulo}
            </button>
          );
        })}
      </div>
      <p className={s.texto}>{MODOS.find(([m]) => m === (modoPendente ?? ev.modoSorteio))![2]}</p>
      {modoPendente && <p className={s.nota}>A mudança vale para as próximas jogadas.</p>}
    </div>
  );
}

// ---------- evento novo (rascunho em memória) ----------

const RASCUNHO_VAZIO: ConfigBrindes = { evento: "", pin: "", modoSorteio: "porTipo", som: true, brindes: [] };

function rascunhoDe(config: ConfigBrindes, pinAtual: string, exemplo: boolean): ConfigBrindes {
  // O PIN do arquivo de exemplo é público: nunca vira o PIN do evento sem a pessoa digitar.
  return { ...config, pin: exemplo ? pinAtual : config.pin, brindes: config.brindes.map((b) => ({ ...b })) };
}

async function brindesDoExemplo(): Promise<Brinde[]> {
  try {
    const r = await fetch("/brindes.exemplo.json", { cache: "no-store" });
    if (r.ok) {
      const { config } = validarConfig(await r.json());
      if (config) return config.brindes;
    }
  } catch {
    /* usa a lista embutida */
  }
  return CONFIG_DEMO.brindes.map((b) => ({ ...b }));
}

type Troca = "arquivo" | "exemplo" | "vazio";

interface PropsNovoEvento {
  store: TotemStore;
  config: ResultadoConfig | null;
  executar: Executar;
  ocupado: boolean;
  avisar: (m: string | null) => void;
}

function NovoEvento({ store, config, executar, ocupado, avisar }: PropsNovoEvento) {
  const [r, setR] = useState<ConfigBrindes>(() => (config?.config ? rascunhoDe(config.config, "", config.exemplo) : RASCUNHO_VAZIO));
  const [painel, setPainel] = useState<"nome" | "pin" | null>(null);
  const [verPin, setVerPin] = useState(false);
  const [erros, setErros] = useState<string[]>([]);
  const [troca, setTroca] = useDoisToques<Troca>();
  const [lendo, setLendo] = useState(false);

  const pinOk = /^\d{4,8}$/.test(r.pin);
  const ativos = r.brindes.filter(brindeAtivo);
  const bloqueado = ocupado || lendo;

  const mudarBrindes = (fn: (l: Brinde[]) => Brinde[]) => setR((x) => ({ ...x, brindes: fn(x.brindes) }));

  const acoes: AcoesEditor = {
    adicionar: async (d) => {
      if (ativos.length >= LIMITE_BRINDES) {
        avisar(`A roleta comporta no máximo ${LIMITE_BRINDES} tipos de brinde.`);
        return false;
      }
      const id = idBrinde(d.nome, r.brindes.map((b) => b.id));
      mudarBrindes((l) => [...l, { id, nome: d.nome, rotulo: d.rotulo || d.nome, quantidade: d.quantidade }]);
      avisar(null);
      return true;
    },
    editar: async (id, d) => {
      mudarBrindes((l) => l.map((b) => (b.id === id ? { ...b, nome: d.nome, rotulo: d.rotulo || d.nome } : b)));
      return true;
    },
    // No rascunho nada saiu ainda: remover apaga de vez.
    remover: async (id) => {
      mudarBrindes((l) => l.filter((b) => b.id !== id));
      return true;
    },
    reativar: async (id) => {
      if (ativos.length >= LIMITE_BRINDES) return false;
      mudarBrindes((l) =>
        l.map((b) => {
          if (b.id !== id) return b;
          const c = { ...b };
          delete c.ativo;
          return c;
        }),
      );
      return true;
    },
    mover: async (id, direcao) => {
      mudarBrindes((l) => {
        const i = l.findIndex((b) => b.id === id);
        const j = i + direcao;
        if (i < 0 || j < 0 || j >= l.length) return l;
        const n = [...l];
        [n[i], n[j]] = [n[j], n[i]];
        return n;
      });
      return true;
    },
    ajustar: async (id, delta) => {
      // no rascunho o mínimo é 1 (para zerar, use Remover)
      mudarBrindes((l) => l.map((b) => (b.id === id ? { ...b, quantidade: Math.max(1, Math.min(9999, b.quantidade + delta)) } : b)));
      return true;
    },
  };

  const itens: ItemEditor[] = r.brindes.map((b) => ({
    id: b.id,
    nome: b.nome,
    rotulo: b.rotulo,
    total: b.quantidade,
    restam: null,
    ativo: brindeAtivo(b),
    saiu: false,
  }));

  /** Botões que trocam a lista inteira: com brindes no rascunho, pedem um segundo toque. */
  const trocar = async (qual: Troca) => {
    if (r.brindes.length > 0 && troca !== qual) {
      setTroca(qual);
      return;
    }
    setTroca(null);
    setErros([]);
    if (qual === "vazio") {
      setR((x) => ({ ...x, brindes: [] }));
      avisar("Lista de brindes vazia. Toque em “Adicionar brinde”.");
      return;
    }
    setLendo(true);
    try {
      if (qual === "arquivo") {
        const res = await carregarConfig();
        if (!res.config) {
          setErros(res.erros);
          avisar("Não foi possível carregar o brindes.json.");
          return;
        }
        // Troca só a LISTA; nome, PIN e modo já preenchidos pela pessoa são mantidos.
        const doArquivo = rascunhoDe(res.config!, "", res.exemplo);
        setR((x) => ({
          ...x,
          evento: x.evento.trim() ? x.evento : doArquivo.evento,
          pin: x.pin || doArquivo.pin,
          brindes: doArquivo.brindes,
        }));
        avisar(res.exemplo ? "brindes.json não encontrado: carreguei a lista de EXEMPLO." : "Lista do brindes.json carregada.");
      } else {
        const brindes = await brindesDoExemplo();
        setR((x) => ({ ...x, brindes }));
        avisar("Lista de exemplo carregada. Edite à vontade.");
      }
    } finally {
      setLendo(false);
    }
  };

  const abrir = () => {
    const { config: c, erros: e } = validarConfig(r);
    const semEstoque = r.brindes.filter((b) => brindeAtivo(b) && b.quantidade < 1).map((b) => b.nome);
    const lista = [
      ...(r.evento.trim() ? [] : ["Dê um nome ao evento."]),
      ...(semEstoque.length ? [`Cada brinde precisa de ao menos 1 unidade: ${semEstoque.join(", ")}.`] : []),
      ...e,
    ];
    setErros(lista);
    if (!c || lista.length) return;
    void executar(() => store.abrirEvento(c), "Evento aberto. Bom evento!");
  };

  const rotuloTroca = (qual: Troca, texto: string) => (troca === qual ? "Substituir a lista? Toque de novo" : texto);

  return (
    <>
      <h3>Novo evento</h3>
      {config?.exemplo && <p className={s.nota}>Não há public/brindes.json neste PC: a lista inicial é a do exemplo.</p>}

      <div className={s.bloco}>
        <CampoTexto
          rotulo="Nome do evento"
          valor={r.evento}
          aoMudar={(v) => setR((x) => ({ ...x, evento: v }))}
          limite={LIMITE_NOME}
          ativo={painel === "nome"}
          aoAtivar={() => setPainel("nome")}
          aoEnter={() => setPainel(null)}
          placeholder="Ex.: Convenção 2026"
        />
        {painel === "nome" && (
          <>
            <TecladoTexto valor={r.evento} aoMudar={(v) => setR((x) => ({ ...x, evento: v }))} limite={LIMITE_NOME} />
            <button className={s.botao} onClick={() => setPainel(null)}>
              Pronto
            </button>
          </>
        )}
      </div>

      <div className={s.bloco}>
        <p className={s.rotuloBloco}>PIN do administrador (4 a 8 dígitos)</p>
        <div className={s.pinNovo}>
          <div className={s.pin}>{(verPin ? r.pin : r.pin.replace(/./g, "●")) || " "}</div>
          <button className={s.botao} onClick={() => setVerPin((v) => !v)} disabled={!r.pin}>
            {verPin ? "Esconder" : "Mostrar"}
          </button>
          <button className={`${s.botao} ${painel === "pin" ? s.opcaoAtiva : ""}`} onClick={() => setPainel(painel === "pin" ? null : "pin")}>
            {painel === "pin" ? "Pronto" : r.pin ? "Trocar PIN" : "Definir PIN"}
          </button>
        </div>
        {pinOk ? (
          <p className={s.ok}>PIN válido. Anote: ele será pedido para abrir este administrador.</p>
        ) : (
          <p className={s.erro}>{r.pin ? "O PIN precisa ter de 4 a 8 dígitos." : "Defina um PIN novo para o evento."}</p>
        )}
        {painel === "pin" && (
          <div className={s.tecladoPin}>
            <Teclado
              compacto
              aoDigito={(d) => setR((x) => (x.pin.length < 8 ? { ...x, pin: x.pin + d } : x))}
              aoApagar={() => setR((x) => ({ ...x, pin: x.pin.slice(0, -1) }))}
              aoLimpar={() => setR((x) => ({ ...x, pin: "" }))}
            />
          </div>
        )}
      </div>

      <div className={s.bloco}>
        <p className={s.rotuloBloco}>Modo de sorteio</p>
        <div className={s.opcoes}>
          {MODOS.map(([m, rotulo]) => (
            <button key={m} className={`${s.botao} ${r.modoSorteio === m ? s.opcaoAtiva : ""}`} aria-pressed={r.modoSorteio === m} onClick={() => setR((x) => ({ ...x, modoSorteio: m }))}>
              {rotulo}
            </button>
          ))}
        </div>
        <p className={s.texto}>{MODOS.find(([m]) => m === r.modoSorteio)![2]}</p>
        <div className={s.opcoes}>
          <button className={s.botao} onClick={() => setR((x) => ({ ...x, som: !x.som }))}>
            Som: {r.som ? "ligado" : "desligado"}
          </button>
        </div>
      </div>

      <div className={s.bloco}>
        <h4>Brindes</h4>
        <div className={s.opcoes}>
          <button className={`${s.botao} ${troca === "arquivo" ? s.confirmar : ""}`} disabled={bloqueado} onClick={() => void trocar("arquivo")}>
            {rotuloTroca("arquivo", "Carregar brindes.json")}
          </button>
          <button className={`${s.botao} ${troca === "exemplo" ? s.confirmar : ""}`} disabled={bloqueado} onClick={() => void trocar("exemplo")}>
            {rotuloTroca("exemplo", "Usar exemplo")}
          </button>
          <button className={`${s.botao} ${troca === "vazio" ? s.confirmar : ""}`} disabled={bloqueado} onClick={() => void trocar("vazio")}>
            {rotuloTroca("vazio", "Começar vazio")}
          </button>
        </div>
        <EditorBrindes itens={itens} acoes={acoes} bloqueado={bloqueado} rascunho />
      </div>

      {erros.map((e) => (
        <p key={e} className={s.erro}>
          {e}
        </p>
      ))}
      <button className={`${s.botao} ${s.primario} ${s.abrirEvento}`} disabled={bloqueado} onClick={abrir}>
        Abrir evento ({ativos.length} {ativos.length === 1 ? "tipo" : "tipos"} · {ativos.reduce((soma, b) => soma + b.quantidade, 0)} unidades)
      </button>
    </>
  );
}

function LinhaJogada({ j, ocupado, estornar }: { j: Jogada; ocupado: boolean; estornar: (devolver: boolean) => void }) {
  const [confirmar, setConfirmar] = useState(false);
  return (
    <tr className={j.status === "estornado" ? s.estornada : ""}>
      <td>
        <strong>{codigoRetirada(j.seq)}</strong>
      </td>
      <td>
        {j.brindeNome}
        {j.avulsa ? " (sem CPF)" : ""}
      </td>
      <td>{hora(j.criadoEm)}</td>
      <td>{STATUS[j.status]}</td>
      <td className={s.ajuste}>
        {j.status !== "estornado" &&
          (!confirmar ? (
            <button className={s.mini} disabled={ocupado} onClick={() => setConfirmar(true)}>
              Estornar
            </button>
          ) : (
            <>
              <button className={s.mini} disabled={ocupado} onClick={() => estornar(true)} title="O brinde volta para a roleta">
                Devolver brinde
              </button>
              <button className={s.mini} disabled={ocupado} onClick={() => estornar(false)} title="O brinde não volta para a roleta">
                Brinde perdido
              </button>
              <button className={s.mini} onClick={() => setConfirmar(false)}>
                ×
              </button>
            </>
          ))}
      </td>
    </tr>
  );
}
