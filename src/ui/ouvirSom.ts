import { som } from "@/audio/som";
import type { SomFormacao } from "./preferencias";

/** Botão de teste: toca o som de formação na hora (o clique já é o gesto que libera o áudio). */
export function ouvirSom(variante: SomFormacao): void {
  som.desbloquear();
  // o primeiro resume() é assíncrono: espera um instante se o contexto ainda estiver suspenso
  setTimeout(() => som.formacao(variante, true), 60);
}
