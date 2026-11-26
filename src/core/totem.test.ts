import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import { fatiaSobPonteiro } from "./geometria";
import { ConfigBrindes } from "./regras";
import { TotemStore } from "./totem";

const CONFIG: ConfigBrindes = {
  evento: "Teste",
  pin: "1234",
  modoSorteio: "porTipo",
  som: false,
  brindes: [
    { id: "a", nome: "Brinde A", rotulo: "A", quantidade: 1 },
    { id: "b", nome: "Brinde B", rotulo: "B", quantidade: 1 },
  ],
};

const CPF1 = "52998224725";
const CPF2 = "00000000191";

async function preparar() {
  const fabrica = new IDBFactory();
  const banco = await db.abrirDb(fabrica, "t");
  const store = new TotemStore();
  await store.iniciarComDb(banco);
  return { store, banco, fabrica };
}

async function esperar(cond: () => boolean, ms = 5000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error("tempo esgotado");
    await new Promise((r) => setTimeout(r, 5));
  }
}

function digitarCpf(store: TotemStore, cpf: string) {
  for (const d of cpf) store.digitar(d);
}

afterEach(() => vi.useRealTimers());

describe("TotemStore", () => {
  it("sem evento pede abertura; PIN confere pelo arquivo e depois pelo evento", async () => {
    const { store } = await preparar();
    expect(store.getEstado().fase).toBe("semEvento");
    expect(await store.verificarPin("1234", CONFIG)).toBe(true);
    await store.abrirEvento(CONFIG);
    expect(store.getEstado().fase).toBe("atracao");
    expect(await store.verificarPin("1234", null)).toBe(true);
    expect(await store.verificarPin("9999", null)).toBe(false);
    await expect(store.abrirEvento(CONFIG)).rejects.toThrow();
  });

  it("fluxo completo: CPF -> pronto -> giro gravado -> fatia certa", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(CONFIG);
    digitarCpf(store, CPF1);
    await esperar(() => store.getEstado().fase === "pronto");
    await store.girar(9, 1);
    const e = store.getEstado();
    expect(e.fase).toBe("girando");
    expect(e.jogadaAtual).not.toBeNull();
    // gravado ANTES de animar
    expect((await db.carregar(banco)).jogadas).toHaveLength(1);
    // a rotação final aponta a fatia sorteada
    if (store.rotacao.tipo !== "giro") throw new Error("esperava giro");
    expect(fatiaSobPonteiro(e.fatias, store.rotacao.plano.thetaFinal)).toBe(e.jogadaAtual!.indice);
  });

  it("toques repetidos em GIRAR gravam uma única jogada", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(CONFIG);
    digitarCpf(store, CPF1);
    await esperar(() => store.getEstado().fase === "pronto");
    await Promise.all([store.girar(), store.girar(), store.girar()]);
    expect((await db.carregar(banco)).jogadas).toHaveLength(1);
  });

  it("CPF inválido e CPF repetido são recusados", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(CONFIG);
    digitarCpf(store, "52998224724");
    expect(store.getEstado().aviso).toMatch(/inválido/);
    expect(store.getEstado().fase).toBe("cpf");
    store.limpar();
    digitarCpf(store, CPF1);
    await esperar(() => store.getEstado().fase === "pronto");
    await store.girar();

    // recarga: nova instância lê o banco; jogada pendente volta como RESULTADO (retomada)
    const s2 = new TotemStore();
    await s2.iniciarComDb(banco);
    expect(s2.getEstado().fase).toBe("resultado");
    expect(s2.getEstado().retomada).toBe(true);
    s2.fecharResultado();
    digitarCpf(s2, CPF1);
    await esperar(() => !!s2.getEstado().aviso);
    expect(s2.getEstado().aviso).toMatch(/já participou/);
    expect(s2.getEstado().fase).toBe("cpf");
  });

  it("brinde sorteado some e, ao acabar tudo, a tela fica esgotada", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(CONFIG);
    for (const cpf of [CPF1, CPF2]) {
      digitarCpf(store, cpf);
      await esperar(() => store.getEstado().fase === "pronto");
      await store.girar();
      expect(store.getEstado().fase).toBe("girando");
      // simula fim do giro sem esperar o timer
      const s = new TotemStore();
      await s.iniciarComDb(banco); // retomada marca revelada
      await esperar(() => s.getEstado().jogadas.every((j) => j.status === "revelado"));
      s.fecharResultado();
      Object.assign(store, { estado: s.getEstado() });
    }
    const fim = new TotemStore();
    await fim.iniciarComDb(banco);
    expect(fim.getEstado().fase).toBe("esgotado");
    expect(fim.getEstado().fatias).toEqual([]);
  });

  it("PIN errado 5 vezes bloqueia, mesmo com o PIN certo depois", async () => {
    const { store } = await preparar();
    await store.abrirEvento(CONFIG);
    for (let i = 0; i < 5; i++) expect(await store.verificarPin("0000", null)).toBe(false);
    expect(store.bloqueioPin()).toBeGreaterThan(0);
    expect(await store.verificarPin("1234", null)).toBe(false);
  });

  it("falha no commit limpa o CPF da tela e não deixa jogar com ele", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(CONFIG);
    digitarCpf(store, CPF1);
    await esperar(() => store.getEstado().fase === "pronto");
    banco.close(); // simula o banco indisponível
    await store.girar();
    const e = store.getEstado();
    expect(e.fase).toBe("cpf");
    expect(e.digitos).toBe("");
    expect(e.aviso).toMatch(/equipe/);
  });

  it("jogada avulsa liberada pelo admin não exige CPF", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(CONFIG);
    store.liberarAvulsa();
    expect(store.getEstado().fase).toBe("pronto");
    await store.girar();
    const d = await db.carregar(banco);
    expect(d.jogadas[0].avulsa).toBe(true);
  });

  it("ociosidade na tela de CPF volta para a atração", async () => {
    const { store } = await preparar();
    await store.abrirEvento(CONFIG);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    store.comecar();
    store.digitar("5");
    expect(store.getEstado().fase).toBe("cpf");
    vi.advanceTimersByTime(21_000);
    expect(store.getEstado().fase).toBe("atracao");
    expect(store.getEstado().digitos).toBe("");
  });

  it("consulta por CPF encontra a jogada e o estorno libera o CPF", async () => {
    const { store } = await preparar();
    await store.abrirEvento(CONFIG);
    digitarCpf(store, CPF1);
    await esperar(() => store.getEstado().fase === "pronto");
    await store.girar();
    const id = store.getEstado().jogadaAtual!.id;
    await expect(store.estornar(id, true)).rejects.toThrow(); // durante o giro, não
    const achadas = await store.consultarCpf(CPF1);
    expect(achadas.map((j) => j.id)).toEqual([id]);
  });
});
