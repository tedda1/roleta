"use client";
import { formatarCpf } from "@/core/cpf";
import { codigoRetirada } from "@/core/regras";
import type { EstadoTotem, TotemStore } from "@/core/totem";
import { Teclado } from "./Teclado";
import s from "./Painel.module.css";

interface Props {
  store: TotemStore;
  estado: EstadoTotem;
  abrirAdmin: () => void;
  /** 3D: o painel com "Girar" fica escondido até a estrela virar roleta. */
  aguardandoRoleta?: boolean;
  /** 2D: o painel entra com atraso fixo de CSS (a chegada 2D é curta). */
  atrasoCss?: boolean;
}

function Visor({ digitos, ok }: { digitos: string; ok?: boolean }) {
  const mascara = "___.___.___-__";
  const texto = formatarCpf(digitos);
  return (
    <div className={`${s.visor} ${ok ? s.visorOk : ""}`} aria-live="polite">
      <span>{texto}</span>
      <span className={s.resto}>{mascara.slice(texto.length)}</span>
    </div>
  );
}

function Chances({ estado }: { estado: EstadoTotem }) {
  const n = estado.fatias.length;
  if (!n || !estado.evento) return null;
  const porUnidade = estado.evento.modoSorteio === "porUnidade";
  return (
    <p className={s.chip}>
      <span className={s.ponto} />
      {n === 1 ? "1 brinde na roleta" : `${n} brindes na roleta`}
      {!porUnidade && n > 1 && <> · chance de 1 em {n}</>}
    </p>
  );
}

/**
 * Cartão do CPF no instante da confirmação (só visual, ~0,9 s).
 * "estrela" (3D): o cartão se contrai num ponto de luz, que vira a estrela viajante da cena.
 * "descolar" (2D): o cartão inclina e se afasta em profundidade.
 */
export function CpfSaindo({ digitos, variante }: { digitos: string; variante: "estrela" | "descolar" }) {
  return (
    <div className={s.saindo} aria-hidden>
      <section className={`${s.painel} ${variante === "estrela" ? s.cartaoEstrela : s.cartaoSaindo}`}>
        <p className={s.kicker}>CPF confirmado ✓</p>
        <Visor digitos={digitos} ok />
      </section>
      {variante === "estrela" && <span className={s.pontoLuz} />}
    </div>
  );
}

export function Painel({ store, estado, abrirAdmin, aguardandoRoleta = false, atrasoCss = true }: Props) {
  const { fase } = estado;

  if (fase === "carregando") {
    return (
      <section className={s.painel}>
        <p className={s.sub}>Preparando a constelação…</p>
      </section>
    );
  }

  if (fase === "outraJanela") {
    return (
      <section className={s.painel}>
        <h2 className={s.titulo}>Roleta já aberta</h2>
        <p className={s.sub}>
          A roleta está aberta em outra janela deste computador. Feche a outra janela (Alt+F4): esta aqui continua sozinha.
        </p>
        <button className={s.botaoSecundario} onClick={() => location.reload()}>
          Tentar de novo
        </button>
      </section>
    );
  }

  if (fase === "erro") {
    return (
      <section className={s.painel}>
        <h2 className={s.titulo}>Algo deu errado</h2>
        <p className={s.sub}>{estado.erro}</p>
        <button className={s.botao} onClick={() => location.reload()}>
          Recarregar
        </button>
      </section>
    );
  }

  if (fase === "semEvento") {
    return (
      <section className={s.painel}>
        <p className={s.kicker}>Convenção 2026</p>
        <h1 className={s.titulo}>Roleta Constelação</h1>
        <p className={s.sub}>O evento ainda não foi aberto.</p>
        <button className={s.botaoSecundario} onClick={abrirAdmin}>
          Abrir administrador
        </button>
      </section>
    );
  }

  // Tela inicial: só o CPF (a roleta aparece depois que ele é confirmado).
  if (fase === "atracao" || fase === "cpf") {
    return (
      <section className={`${s.painel} ${s.painelCpf}`}>
        <div className={s.cabecaCpf}>
          <p className={s.kicker}>{estado.evento?.nome ?? "Convenção 2026"}</p>
          <h1 className={s.titulo}>
            Constelação
            <br />
            de Brindes
          </h1>
          <p className={s.lema}>A nossa força é brilhar juntos.</p>
          <Chances estado={estado} />
          <p className={s.lgpd}>
            Usamos o CPF só para garantir uma jogada por pessoa. Não guardamos o número: guardamos um código protegido,
            apagado ao fim do evento.
          </p>
        </div>
        <div className={s.entradaCpf}>
          <h2 className={s.tituloMenor}>Digite seu CPF</h2>
          <Visor digitos={estado.digitos} />
          <p className={`${s.aviso} ${estado.aviso ? s.avisoAtivo : ""}`} role="status">
            {estado.verificando ? "Verificando…" : (estado.aviso ?? "Uma jogada por pessoa")}
          </p>
          <Teclado
            aoDigito={(d) => store.digitar(d)}
            aoApagar={() => store.apagar()}
            aoLimpar={() => store.limpar()}
            desativado={estado.verificando}
          />
          {fase === "cpf" && estado.digitos && (
            <button className={s.botaoTexto} onClick={() => store.cancelar()}>
              Cancelar
            </button>
          )}
        </div>
      </section>
    );
  }

  // CPF confirmado: a roleta chegou; o painel lateral entra depois da animação.
  if (fase === "pronto") {
    return (
      <section
        className={`${s.painel} ${aguardandoRoleta ? s.escondido : atrasoCss ? s.depoisDaChegada : s.entrarAgora}`}
        aria-hidden={aguardandoRoleta}
      >
        {estado.avulsa ? (
          <>
            <p className={s.kicker}>Jogada liberada pela equipe</p>
            <h2 className={s.titulo}>Pode girar!</h2>
          </>
        ) : (
          <>
            <p className={s.kicker}>CPF confirmado ✓</p>
            <h2 className={s.titulo}>Agora é com você!</h2>
          </>
        )}
        <Chances estado={estado} />
        <p className={`${s.aviso} ${estado.aviso ? s.avisoAtivo : ""}`} role="status">
          {estado.aviso ?? " "}
        </p>
        {/* sem botão: o participante gira a roleta arrastando com o dedo */}
        <div className={s.arraste} aria-live="polite">
          <span className={s.maozinha} aria-hidden>
            ☝
          </span>
          <span className={s.arrasteTexto}>Arraste a roleta para girar!</span>
        </div>
        <p className={s.dica}>Encoste o dedo na roleta, arraste e solte</p>
        <div className={s.rodape}>
          {!estado.avulsa && (
            <button className={s.botaoTexto} onClick={() => store.apagar()}>
              Corrigir CPF
            </button>
          )}
          <button className={s.botaoTexto} onClick={() => store.cancelar()}>
            Cancelar
          </button>
        </div>
      </section>
    );
  }

  if (fase === "girando") {
    return (
      <section className={s.painel}>
        <p className={s.kicker}>As estrelas estão se alinhando</p>
        <h2 className={s.titulo}>Boa sorte!</h2>
        <Chances estado={estado} />
      </section>
    );
  }

  if (fase === "resultado" && estado.jogadaAtual) {
    const j = estado.jogadaAtual;
    return (
      <section className={s.painel}>
        <div className={s.cartao}>
          <p className={s.kicker}>Você ganhou</p>
          <h2 className={s.premio}>{j.brindeNome}</h2>
          <p className={s.codigo}>
            Código de retirada <strong>{codigoRetirada(j.seq)}</strong>
          </p>
          <p className={s.sub}>Retire seu brinde com a equipe.</p>
          {estado.retomada && <p className={s.aviso + " " + s.avisoAtivo}>Resultado recuperado após reinício. Mostre à equipe.</p>}
        </div>
        <button className={s.botao} onClick={() => store.fecharResultado()}>
          Concluir
        </button>
      </section>
    );
  }

  if (fase === "esgotado") {
    return (
      <section className={s.painel}>
        <p className={s.kicker}>{estado.evento?.nome}</p>
        <h2 className={s.titulo}>Os brindes acabaram!</h2>
        <p className={s.lema}>Obrigado por brilhar com a gente.</p>
      </section>
    );
  }

  return null;
}
