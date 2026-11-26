"use client";
import { som } from "@/audio/som";
import s from "./Teclado.module.css";

interface Props {
  aoDigito: (d: string) => void;
  aoApagar: () => void;
  aoLimpar: () => void;
  desativado?: boolean;
  compacto?: boolean;
}

/** Teclado numérico próprio: não depende do teclado virtual do Windows. */
export function Teclado({ aoDigito, aoApagar, aoLimpar, desativado, compacto }: Props) {
  const tecla = (rotulo: string, acao: () => void, extra = "", aria?: string) => (
    <button
      key={rotulo}
      type="button"
      className={`${s.tecla} ${extra}`}
      disabled={desativado}
      aria-label={aria ?? rotulo}
      onClick={() => {
        som.toque();
        acao();
      }}
    >
      {rotulo}
    </button>
  );
  return (
    <div className={`${s.teclado} ${compacto ? s.compacto : ""}`}>
      {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => tecla(d, () => aoDigito(d)))}
      {tecla("Limpar", aoLimpar, s.acao)}
      {tecla("0", () => aoDigito("0"))}
      {tecla("⌫", aoApagar, s.acao, "Apagar")}
    </div>
  );
}
