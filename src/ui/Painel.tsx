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

export function Painel({ store, estado, abrirAdmin }: Props) {
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

  if (fase === "atracao") {
    return (
      <section className={`${s.painel} ${s.entrada}`} onClick={() => store.comecar()}>
        <p className={s.kicker}>{estado.evento?.nome ?? "Convenção 2026"}</p>
        <h1 className={s.titulo}>
          Constelação
          <br />
          de Brindes
        </h1>
        <p className={s.lema}>A nossa força é brilhar juntos.</p>
        <Chances estado={estado} />
        <button className={`${s.botao} ${s.respira}`} onClick={() => store.comecar()}>
          Toque para participar
        </button>
      </section>
    );
  }

  if (fase === "cpf" || fase === "pronto") {
    const pronto = fase === "pronto";
    return (
      <section className={s.painel}>
        {estado.avulsa ? (
          <>
            <p className={s.kicker}>Jogada liberada pela equipe</p>
            <h2 className={s.titulo}>Pode girar!</h2>
          </>
        ) : (
          <>
            <p className={s.kicker}>{pronto ? "Tudo certo" : "Uma jogada por pessoa"}</p>
            <h2 className={s.tituloMenor}>{pronto ? "Agora é com você!" : "Digite seu CPF"}</h2>
            <Visor digitos={estado.digitos} ok={pronto} />
          </>
        )}
        <p className={`${s.aviso} ${estado.aviso ? s.avisoAtivo : ""}`} role="status">
          {estado.verificando ? "Verificando…" : (estado.aviso ?? " ")}
        </p>
        {pronto ? (
          <>
            <button className={`${s.botao} ${s.girar}`} onClick={() => void store.girar()}>
              Girar a roleta
            </button>
            <p className={s.dica}>ou agarre a roleta e gire com o dedo</p>
            {!estado.avulsa && (
              <button className={s.botaoTexto} onClick={() => store.apagar()}>
                Corrigir CPF
              </button>
            )}
          </>
        ) : (
          <Teclado
            aoDigito={(d) => store.digitar(d)}
            aoApagar={() => store.apagar()}
            aoLimpar={() => store.limpar()}
            desativado={estado.verificando}
          />
        )}
        <div className={s.rodape}>
          <button className={s.botaoTexto} onClick={() => store.cancelar()}>
            Cancelar
          </button>
          <p className={s.lgpd}>
            Usamos o CPF só para garantir uma jogada por pessoa. Não guardamos o número: guardamos um código protegido,
            apagado ao fim do evento.
          </p>
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
