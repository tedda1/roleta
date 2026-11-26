"use client";
import { useEffect, useRef, useState } from "react";
import { carregarConfig, ResultadoConfig } from "@/core/config";
import { formatarCpf } from "@/core/cpf";
import { validarBackup, type Backup } from "@/core/db";
import { Jogada, codigoRetirada } from "@/core/regras";
import type { EstadoTotem, TotemStore } from "@/core/totem";
import type { Preferencias } from "./preferencias";
import { Teclado } from "./Teclado";
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

  // Fecha sozinho após 2 min sem uso.
  useEffect(() => {
    const marcar = () => (ultimaAtividade.current = Date.now());
    marcar();
    window.addEventListener("pointerdown", marcar, true);
    const t = setInterval(() => {
      if (Date.now() - ultimaAtividade.current > 120_000) fechar();
    }, 5000);
    return () => {
      window.removeEventListener("pointerdown", marcar, true);
      clearInterval(t);
    };
  }, [fechar]);

  const executar = async (acao: () => Promise<void> | void, sucesso?: string) => {
    setOcupado(true);
    setMsg(null);
    try {
      await acao();
      if (sucesso) setMsg(sucesso);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
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
  const recentes = [...estado.jogadas].reverse().slice(0, limite);
  const totalRestante = [...estado.estoque.values()].reduce((a, b) => a + b, 0);

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
              ["evento", "Evento"],
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
              <h3>Abrir evento</h3>
              {!config && <p className={s.texto}>Lendo brindes.json…</p>}
              {config?.erros.map((e) => (
                <p key={e} className={s.erro}>
                  {e}
                </p>
              ))}
              {config?.exemplo && <p className={s.nota}>Atenção: arquivo de EXEMPLO. Para o evento, crie public/brindes.json.</p>}
              {config?.config && (
                <>
                  <p className={s.texto}>
                    <strong>{config.config.evento}</strong> · {config.config.brindes.length} tipos ·{" "}
                    {config.config.brindes.reduce((a, b) => a + b.quantidade, 0)} unidades · sorteio{" "}
                    {config.config.modoSorteio === "porTipo" ? "igual por tipo" : "por unidade"}
                  </p>
                  <ul className={s.lista}>
                    {config.config.brindes.map((b) => (
                      <li key={b.id}>
                        {b.nome} <span>× {b.quantidade}</span>
                      </li>
                    ))}
                  </ul>
                  <button className={`${s.botao} ${s.primario}`} disabled={ocupado} onClick={() => void executar(() => store.abrirEvento(config.config!), "Evento aberto.")}>
                    Abrir evento com esta lista
                  </button>
                </>
              )}
              <button className={s.botao} onClick={() => void carregarConfig().then(setConfig)}>
                Reler brindes.json
              </button>
              <button className={s.botao} onClick={() => arquivoRef.current?.click()}>
                Restaurar backup…
              </button>
              <div className={s.grade}>
                <button className={s.botao} onClick={() => mudarPrefs({ ...prefs, modo: prefs.modo === "2d" ? "3d" : "2d" })}>
                  Versão: {prefs.modo === "2d" ? "2D" : "3D"} (trocar)
                </button>
                <button className={s.botao} onClick={() => mudarPrefs({ ...prefs, leve: !prefs.leve })}>
                  Modo leve: {prefs.leve ? "ligado" : "desligado"}
                </button>
                <a className={s.botao} href="/diagnostico/">
                  Diagnóstico do PC
                </a>
              </div>
            </section>
          )}

          {aba === "evento" && ev && (
            <section className={s.secao}>
              <h3>{ev.nome}</h3>
              <p className={s.texto}>
                Aberto às {hora(ev.criadoEm)} · {estado.jogadas.filter((j) => j.status !== "estornado").length} jogadas · {totalRestante}{" "}
                unidades restantes · sorteio {ev.modoSorteio === "porTipo" ? "igual por tipo" : "por unidade"}
              </p>
              <p className={s.texto}>
                Armazenamento persistente: <strong>{estado.persistido ? "sim" : "não confirmado"}</strong> · endereço{" "}
                <strong>{typeof location !== "undefined" ? location.origin : ""}</strong>
              </p>

              <div className={s.grade}>
                <button className={s.botao} onClick={() => void executar(() => store.alterarSom(!ev.som))}>
                  Som: {ev.som ? "ligado" : "desligado"}
                </button>
                <button className={s.botao} onClick={() => mudarPrefs({ ...prefs, modo: prefs.modo === "2d" ? "3d" : "2d" })}>
                  Versão: {prefs.modo === "2d" ? "2D" : "3D"} (trocar)
                </button>
                <button className={s.botao} onClick={() => mudarPrefs({ ...prefs, leve: !prefs.leve })}>
                  Modo leve: {prefs.leve ? "ligado" : "desligado"}
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
                <a className={s.botao} href="/diagnostico/">
                  Diagnóstico do PC
                </a>
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
              <table className={s.tabela}>
                <thead>
                  <tr>
                    <th>Brinde</th>
                    <th>Inicial</th>
                    <th>Restam</th>
                    <th>Ajustar</th>
                  </tr>
                </thead>
                <tbody>
                  {ev.brindes.map((b) => (
                    <tr key={b.id}>
                      <td>{b.nome}</td>
                      <td>{b.quantidade}</td>
                      <td>
                        <strong>{estado.estoque.get(b.id) ?? 0}</strong>
                      </td>
                      <td className={s.ajuste}>
                        <button className={s.mini} disabled={ocupado || (estado.estoque.get(b.id) ?? 0) <= 0} onClick={() => void executar(() => store.ajustarEstoque(b.id, -1))}>
                          −1
                        </button>
                        <button className={s.mini} disabled={ocupado} onClick={() => void executar(() => store.ajustarEstoque(b.id, +1))}>
                          +1
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className={s.nota}>Ajustes ficam registrados. Para mudar nomes, edite brindes.json antes de abrir o próximo evento.</p>
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
