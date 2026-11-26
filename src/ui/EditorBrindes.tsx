"use client";
import { useEffect, useState } from "react";
import { LIMITE_BRINDES, LIMITE_NOME, LIMITE_ROTULO } from "@/core/regras";
import { CampoTexto, TecladoTexto } from "./TecladoTexto";
import a from "./Admin.module.css";
import s from "./EditorBrindes.module.css";

/*
 * Cadastro de brindes do administrador. O mesmo editor serve para o evento aberto
 * (ações vão para o TotemStore) e para o rascunho de um evento novo (ações em memória).
 */

export interface ItemEditor {
  id: string;
  nome: string;
  rotulo: string;
  /** quantidade cadastrada (no evento: a inicial; no rascunho: a que vai abrir) */
  total: number;
  /** unidades que ainda podem sair; null no rascunho */
  restam: number | null;
  ativo: boolean;
  /** já saiu em alguma jogada: Remover só desativa */
  saiu: boolean;
}

/** Cada ação devolve true quando deu certo (o editor fecha o formulário / a confirmação). */
export interface AcoesEditor {
  adicionar: (d: { nome: string; rotulo: string; quantidade: number }) => Promise<boolean>;
  editar: (id: string, d: { nome: string; rotulo: string }) => Promise<boolean>;
  remover: (id: string) => Promise<boolean>;
  reativar: (id: string) => Promise<boolean>;
  mover: (id: string, direcao: -1 | 1) => Promise<boolean>;
  ajustar: (id: string, delta: number) => Promise<boolean>;
}

interface Props {
  itens: ItemEditor[];
  acoes: AcoesEditor;
  /** giro em andamento (ou outra ação rodando): tudo travado */
  bloqueado: boolean;
  /** true = rascunho de evento novo: −1/+1 mudam a quantidade direto */
  rascunho?: boolean;
}

interface Formulario {
  /** null = brinde novo */
  id: string | null;
  nome: string;
  rotulo: string;
  quantidade: number;
  campo: "nome" | "rotulo";
}

const MAX_QUANTIDADE = 9999;

export function EditorBrindes({ itens, acoes, bloqueado, rascunho }: Props) {
  const [form, setForm] = useState<Formulario | null>(null);
  const [confirmarRemocao, setConfirmarRemocao] = useState<string | null>(null);

  // A confirmação em dois toques expira sozinha.
  useEffect(() => {
    if (!confirmarRemocao) return;
    const t = setTimeout(() => setConfirmarRemocao(null), 5000);
    return () => clearTimeout(t);
  }, [confirmarRemocao]);

  const ativos = itens.filter((i) => i.ativo).length;
  const cheio = ativos >= LIMITE_BRINDES;
  const unidades = itens.filter((i) => i.ativo).reduce((soma, i) => soma + (i.restam ?? i.total), 0);

  if (form) {
    const novo = form.id === null;
    const nomeOk = form.nome.trim().length > 0;
    const salvar = async () => {
      if (!nomeOk || bloqueado) return;
      const dados = { nome: form.nome.trim(), rotulo: form.rotulo.trim() };
      const ok = novo ? await acoes.adicionar({ ...dados, quantidade: form.quantidade }) : await acoes.editar(form.id!, dados);
      if (ok) setForm(null);
    };
    const mudarCampo = (v: string) => setForm((f) => (f ? { ...f, [f.campo]: v } : f));
    const quantidade = (delta: number) =>
      setForm((f) => (f ? { ...f, quantidade: Math.min(MAX_QUANTIDADE, Math.max(1, f.quantidade + delta)) } : f));
    return (
      <div className={s.formulario}>
        <h4 className={s.tituloForm}>{novo ? "Novo brinde" : "Editar brinde"}</h4>
        <div className={s.campos}>
          <CampoTexto
            rotulo="Nome (aparece no resultado)"
            valor={form.nome}
            aoMudar={(v) => setForm((f) => (f ? { ...f, nome: v } : f))}
            limite={LIMITE_NOME}
            ativo={form.campo === "nome"}
            aoAtivar={() => setForm((f) => (f ? { ...f, campo: "nome" } : f))}
            aoEnter={() => setForm((f) => (f ? { ...f, campo: "rotulo" } : f))}
            placeholder="Ex.: Caneca Constelação"
          />
          <CampoTexto
            rotulo="Texto na roleta"
            valor={form.rotulo}
            aoMudar={(v) => setForm((f) => (f ? { ...f, rotulo: v } : f))}
            limite={LIMITE_ROTULO}
            contador
            ativo={form.campo === "rotulo"}
            aoAtivar={() => setForm((f) => (f ? { ...f, campo: "rotulo" } : f))}
            aoEnter={() => void salvar()}
            placeholder={form.nome.trim() || "Ex.: Caneca"}
            dica="Curto, até 16 letras. Se ficar vazio, usa o nome."
          />
        </div>

        {novo && (
          <div className={s.quantidade}>
            <span className={s.rotuloQtd}>Quantidade</span>
            <button type="button" className={s.botaoQtd} disabled={form.quantidade <= 1} onClick={() => quantidade(-10)} aria-label="Menos 10">
              −10
            </button>
            <button type="button" className={s.botaoQtd} disabled={form.quantidade <= 1} onClick={() => quantidade(-1)} aria-label="Menos 1">
              −
            </button>
            <output className={s.valorQtd} aria-live="polite">
              {form.quantidade}
            </output>
            <button type="button" className={s.botaoQtd} disabled={form.quantidade >= MAX_QUANTIDADE} onClick={() => quantidade(1)} aria-label="Mais 1">
              +
            </button>
            <button type="button" className={s.botaoQtd} disabled={form.quantidade >= MAX_QUANTIDADE} onClick={() => quantidade(10)} aria-label="Mais 10">
              +10
            </button>
          </div>
        )}

        <TecladoTexto valor={form[form.campo]} aoMudar={mudarCampo} limite={form.campo === "nome" ? LIMITE_NOME : LIMITE_ROTULO} desativado={bloqueado} />

        <div className={a.linha}>
          <button type="button" className={a.botao} onClick={() => setForm(null)}>
            Cancelar
          </button>
          <button type="button" className={`${a.botao} ${a.primario}`} disabled={!nomeOk || bloqueado} onClick={() => void salvar()}>
            Salvar
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={s.editor}>
      <button
        type="button"
        className={`${a.botao} ${a.primario} ${s.adicionar}`}
        disabled={bloqueado || cheio}
        onClick={() => setForm({ id: null, nome: "", rotulo: "", quantidade: 1, campo: "nome" })}
      >
        + Adicionar brinde
      </button>
      <p className={s.resumo}>
        {ativos}/{LIMITE_BRINDES} tipos na roleta · {unidades} {rascunho ? "unidades" : "unidades restantes"}
        {cheio && " · limite atingido"}
      </p>

      {itens.length === 0 && <p className={a.texto}>Nenhum brinde cadastrado. Toque em “Adicionar brinde”.</p>}

      <ol className={s.lista}>
        {itens.map((b, i) => {
          const confirmando = confirmarRemocao === b.id;
          const restam = b.restam ?? b.total;
          return (
            <li key={b.id} className={`${s.item} ${b.ativo ? "" : s.desativado}`}>
              <div className={s.ordem}>
                <button type="button" className={a.mini} disabled={bloqueado || i === 0} onClick={() => void acoes.mover(b.id, -1)} aria-label={`Subir ${b.nome}`}>
                  ▲
                </button>
                <button
                  type="button"
                  className={a.mini}
                  disabled={bloqueado || i === itens.length - 1}
                  onClick={() => void acoes.mover(b.id, 1)}
                  aria-label={`Descer ${b.nome}`}
                >
                  ▼
                </button>
              </div>

              <div className={s.nomes}>
                <strong className={s.nome}>{b.nome}</strong>
                <span className={s.rotulo}>
                  Na roleta: <em>{b.rotulo || b.nome}</em>
                  {!b.ativo && <span className={s.selo}>desativado</span>}
                </span>
              </div>

              <div className={s.estoque}>
                {rascunho ? (
                  <>
                    <strong>{b.total}</strong>
                    <span>unidades</span>
                  </>
                ) : (
                  <>
                    <strong>restam {restam}</strong>
                    <span>de {b.total}</span>
                  </>
                )}
              </div>

              <div className={s.acoes}>
                {b.ativo && (
                  <>
                    <button
                      type="button"
                      className={a.mini}
                      disabled={bloqueado || restam <= 0 || (rascunho === true && b.total <= 1)}
                      onClick={() => void acoes.ajustar(b.id, -1)}
                      aria-label={`Tirar uma unidade de ${b.nome}`}
                    >
                      −1
                    </button>
                    <button
                      type="button"
                      className={a.mini}
                      disabled={bloqueado || (rascunho === true && b.total >= MAX_QUANTIDADE)}
                      onClick={() => void acoes.ajustar(b.id, 1)}
                      aria-label={`Pôr uma unidade de ${b.nome}`}
                    >
                      +1
                    </button>
                  </>
                )}
                <button
                  type="button"
                  className={a.mini}
                  disabled={bloqueado}
                  onClick={() => setForm({ id: b.id, nome: b.nome, rotulo: b.rotulo === b.nome ? "" : b.rotulo, quantidade: b.total, campo: "nome" })}
                >
                  Editar
                </button>
                {b.ativo ? (
                  <button
                    type="button"
                    className={`${a.mini} ${confirmando ? s.confirmar : ""}`}
                    disabled={bloqueado}
                    onClick={() => {
                      if (!confirmando) return setConfirmarRemocao(b.id);
                      setConfirmarRemocao(null);
                      void acoes.remover(b.id);
                    }}
                  >
                    {!confirmando ? "Remover" : b.saiu ? "Desativar? Toque de novo" : "Apagar? Toque de novo"}
                  </button>
                ) : (
                  <button type="button" className={`${a.mini} ${s.reativar}`} disabled={bloqueado || cheio} onClick={() => void acoes.reativar(b.id)}>
                    Reativar
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
