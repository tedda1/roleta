"use client";
import { useEffect, useRef, useState } from "react";
import { som } from "@/audio/som";
import s from "./TecladoTexto.module.css";

/*
 * Teclado de texto na tela, para o totem touch sem teclado físico.
 * Os campos (CampoTexto) continuam aceitando teclado físico, mas usam inputMode="none"
 * para o Windows não abrir o teclado virtual dele por cima da roleta.
 */

interface PropsTeclado {
  /** texto do campo que está recebendo as teclas */
  valor: string;
  aoMudar: (v: string) => void;
  limite?: number;
  desativado?: boolean;
}

const NUMEROS = "1234567890".split("");
const LETRAS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"].map((l) => l.split(""));
const ACENTOS = ["á", "à", "â", "ã", "é", "ê", "í", "ó", "ô", "õ", "ú", "ç"];
const SINAIS = ["-", ".", ",", "/", "&", "$", "!"];

export function TecladoTexto({ valor, aoMudar, limite, desativado }: PropsTeclado) {
  const [maiusculas, setMaiusculas] = useState(false);
  // A primeira letra do campo sai maiúscula sozinha.
  const caixaAlta = maiusculas || valor.length === 0;
  const cheio = limite !== undefined && valor.length >= limite;

  const inserir = (t: string) => {
    if (limite !== undefined && valor.length + t.length > limite) return;
    aoMudar(valor + t);
  };

  const tecla = (rotulo: string, acao: () => void, extra = "", aria?: string, bloquear = false) => (
    <button
      key={aria ?? rotulo}
      type="button"
      className={`${s.tecla} ${extra}`}
      disabled={desativado || bloquear}
      aria-label={aria ?? rotulo}
      // não rouba o foco do campo (o cursor continua lá para o teclado físico)
      onPointerDown={(e) => e.preventDefault()}
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => {
        som.toque();
        acao();
      }}
    >
      {rotulo}
    </button>
  );

  const letra = (l: string) => {
    const t = caixaAlta ? l.toLocaleUpperCase("pt-BR") : l;
    return tecla(t, () => inserir(t), "", `letra ${t}`, cheio);
  };

  return (
    <div className={s.teclado} role="group" aria-label="Teclado">
      <div className={s.linha}>
        {NUMEROS.map((n) => tecla(n, () => inserir(n), "", `número ${n}`, cheio))}
        {tecla("⌫", () => aoMudar(valor.slice(0, -1)), `${s.acao} ${s.larga}`, "Apagar", valor.length === 0)}
      </div>
      <div className={s.linha}>{LETRAS[0].map(letra)}</div>
      <div className={`${s.linha} ${s.recuo}`}>{LETRAS[1].map(letra)}</div>
      <div className={s.linha}>
        {tecla("⇧ Maiúsc.", () => setMaiusculas((m) => !m), `${s.acao} ${s.larga} ${maiusculas ? s.ligada : ""}`, "Maiúsculas")}
        {LETRAS[2].map(letra)}
        {tecla("Limpar", () => aoMudar(""), `${s.acao} ${s.larga}`, "Limpar campo", valor.length === 0)}
      </div>
      <div className={`${s.linha} ${s.acentos}`}>{ACENTOS.map(letra)}</div>
      <div className={s.linha}>
        {SINAIS.map((c) => tecla(c, () => inserir(c), s.sinal, undefined, cheio))}
        {tecla("espaço", () => inserir(" "), `${s.acao} ${s.espaco}`, "Espaço", cheio || valor.length === 0 || valor.endsWith(" "))}
      </div>
    </div>
  );
}

interface PropsCampo {
  rotulo: string;
  valor: string;
  aoMudar: (v: string) => void;
  limite: number;
  /** este é o campo que recebe o teclado da tela */
  ativo: boolean;
  aoAtivar: () => void;
  /** Enter no teclado físico */
  aoEnter?: () => void;
  contador?: boolean;
  dica?: string;
  placeholder?: string;
  desativado?: boolean;
}

/** Campo de texto do administrador: toque para escolher, digite pelo TecladoTexto ou pelo teclado físico. */
export function CampoTexto({ rotulo, valor, aoMudar, limite, ativo, aoAtivar, aoEnter, contador, dica, placeholder, desativado }: PropsCampo) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ativo) ref.current?.focus({ preventScroll: true });
  }, [ativo]);
  return (
    <label className={`${s.campo} ${ativo ? s.campoAtivo : ""}`}>
      <span className={s.rotuloCampo}>
        {rotulo}
        {contador && (
          <span className={`${s.contador} ${valor.length >= limite ? s.contadorCheio : ""}`}>
            {valor.length}/{limite}
          </span>
        )}
      </span>
      <input
        ref={ref}
        className={s.entrada}
        type="text"
        inputMode="none"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
        enterKeyHint="done"
        value={valor}
        maxLength={limite}
        placeholder={placeholder}
        disabled={desativado}
        onFocus={aoAtivar}
        onChange={(e) => aoMudar(e.target.value.slice(0, limite))}
        onKeyDown={(e) => {
          if (e.key === "Enter" && aoEnter) {
            e.preventDefault();
            aoEnter();
          }
        }}
      />
      {dica && <span className={s.dica}>{dica}</span>}
    </label>
  );
}
