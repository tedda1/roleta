import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as db from "./db";
import { fatiaSobPonteiro } from "./geometria";
import { ConfigBrindes, idBrinde, validarConfig } from "./regras";
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

  it("incluir brinde no evento aberto aumenta a roleta e vale para o sorteio", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(CONFIG);
    expect(store.getEstado().fatias).toHaveLength(2);
    await store.adicionarBrinde({ id: "c", nome: "Brinde C", rotulo: "C", quantidade: 1 });
    expect(store.getEstado().fatias.map((f) => f.id)).toEqual(["a", "b", "c"]);
    await expect(store.adicionarBrinde({ id: "c", nome: "Outro", rotulo: "", quantidade: 1 })).rejects.toThrow(/Já existe/);
    // persiste: nova instância enxerga o brinde novo
    const s2 = new TotemStore();
    await s2.iniciarComDb(banco);
    expect(s2.getEstado().fatias).toHaveLength(3);
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

describe("TotemStore · cadastro de brindes", () => {
  const TRES: ConfigBrindes = {
    ...CONFIG,
    brindes: [...CONFIG.brindes, { id: "c", nome: "Brinde C", rotulo: "C", quantidade: 2 }],
  };

  it("editar muda nome e texto da fatia e persiste; texto vazio usa o nome", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(TRES);
    await store.editarBrinde("a", { nome: "  Caneca  ", rotulo: "Caneca!" });
    expect(store.getEstado().fatias[0]).toMatchObject({ id: "a", nome: "Caneca", rotulo: "Caneca!" });
    await store.editarBrinde("b", { nome: "Garrafa térmica", rotulo: "" });
    expect(store.getEstado().fatias[1].rotulo).toBe("Garrafa térmica");
    await expect(store.editarBrinde("a", { nome: "", rotulo: "x" })).rejects.toThrow(/nome/);
    await expect(store.editarBrinde("a", { nome: "X", rotulo: "12345678901234567" })).rejects.toThrow(/16/);
    await expect(store.editarBrinde("zz", { nome: "X", rotulo: "" })).rejects.toThrow(/não encontrado/);
    const s2 = new TotemStore();
    await s2.iniciarComDb(banco);
    expect(s2.getEstado().evento!.brindes.map((b) => b.nome)).toEqual(["Caneca", "Garrafa térmica", "Brinde C"]);
  });

  it("mover muda a ordem das fatias (nas bordas não faz nada)", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(TRES);
    await store.moverBrinde("c", -1);
    expect(store.getEstado().fatias.map((f) => f.id)).toEqual(["a", "c", "b"]);
    await store.moverBrinde("a", 1);
    expect(store.getEstado().fatias.map((f) => f.id)).toEqual(["c", "a", "b"]);
    await store.moverBrinde("c", -1);
    await store.moverBrinde("b", 1);
    expect(store.getEstado().fatias.map((f) => f.id)).toEqual(["c", "a", "b"]);
    const s2 = new TotemStore();
    await s2.iniciarComDb(banco);
    expect(s2.getEstado().fatias.map((f) => f.id)).toEqual(["c", "a", "b"]);
  });

  it("remover brinde que nunca saiu apaga de vez", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(TRES);
    expect(await store.removerBrinde("b")).toBe("removido");
    expect(store.getEstado().evento!.brindes.map((b) => b.id)).toEqual(["a", "c"]);
    expect(store.getEstado().fatias.map((f) => f.id)).toEqual(["a", "c"]);
    expect((await db.carregar(banco)).evento!.brindes.map((b) => b.id)).toEqual(["a", "c"]);
  });

  it("remover brinde que já saiu desativa (sai da roleta) e reativar devolve", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento(TRES);
    digitarCpf(store, CPF1);
    await esperar(() => store.getEstado().fase === "pronto");
    await store.girar();
    const saiu = store.getEstado().jogadaAtual!.brindeId;
    // fim do giro simulado: nova instância retoma, revela e volta à atração
    const s = new TotemStore();
    await s.iniciarComDb(banco);
    await esperar(() => s.getEstado().jogadas.every((j) => j.status === "revelado"));
    s.fecharResultado();
    expect(s.getEstado().fase).toBe("atracao");

    expect(await s.removerBrinde(saiu)).toBe("desativado");
    const ev = s.getEstado().evento!;
    expect(ev.brindes.find((b) => b.id === saiu)?.ativo).toBe(false);
    expect(ev.brindes).toHaveLength(3);
    expect(s.getEstado().fatias.map((f) => f.id)).not.toContain(saiu);

    await s.reativarBrinde(saiu);
    expect(s.getEstado().evento!.brindes.find((b) => b.id === saiu)?.ativo).toBeUndefined();
    const voltou = (s.getEstado().estoque.get(saiu) ?? 0) > 0;
    expect(s.getEstado().fatias.some((f) => f.id === saiu)).toBe(voltou);
  });

  it("desativar o último brinde com estoque deixa a tela esgotada; reativar volta à atração", async () => {
    const { store, banco } = await preparar();
    await store.abrirEvento({ ...CONFIG, brindes: [{ id: "a", nome: "Brinde A", rotulo: "A", quantidade: 3 }] });
    digitarCpf(store, CPF1);
    await esperar(() => store.getEstado().fase === "pronto");
    await store.girar();
    const s = new TotemStore();
    await s.iniciarComDb(banco);
    await esperar(() => s.getEstado().jogadas.every((j) => j.status === "revelado"));
    s.fecharResultado();
    expect(await s.removerBrinde("a")).toBe("desativado");
    expect(s.getEstado().fase).toBe("esgotado");
    await s.reativarBrinde("a");
    expect(s.getEstado().fase).toBe("atracao");
    expect(s.getEstado().fatias).toHaveLength(1);
  });

  it("alterarEvento renomeia e troca o modo de sorteio", async () => {
    const { store } = await preparar();
    await store.abrirEvento(TRES);
    await store.alterarEvento({ nome: "Festa 2026", modoSorteio: "porUnidade" });
    const e = store.getEstado();
    expect(e.evento!.nome).toBe("Festa 2026");
    expect(e.fatias.find((f) => f.id === "c")?.peso).toBe(2);
    await expect(store.alterarEvento({ nome: "   " })).rejects.toThrow(/nome/);
  });

  it("durante o giro, nada do cadastro pode mudar", async () => {
    const { store } = await preparar();
    await store.abrirEvento(TRES);
    digitarCpf(store, CPF1);
    await esperar(() => store.getEstado().fase === "pronto");
    await store.girar();
    expect(store.getEstado().fase).toBe("girando");
    const antes = store.getEstado().evento;
    await expect(store.editarBrinde("a", { nome: "X", rotulo: "" })).rejects.toThrow(/giro/);
    await expect(store.moverBrinde("a", 1)).rejects.toThrow(/giro/);
    await expect(store.removerBrinde("b")).rejects.toThrow(/giro/);
    await expect(store.reativarBrinde("b")).rejects.toThrow(/giro/);
    await expect(store.alterarEvento({ nome: "Y" })).rejects.toThrow(/giro/);
    await expect(store.ajustarEstoque("a", 1)).rejects.toThrow(/giro/);
    await expect(store.adicionarBrinde({ id: "d", nome: "D", rotulo: "", quantidade: 1 })).rejects.toThrow(/giro/);
    expect(store.getEstado().evento).toBe(antes);
  });
});

describe("regras · cadastro", () => {
  it("ids novos vêm do nome e nunca se repetem", () => {
    const usados = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const id = idBrinde("Caneca Constelação!", usados);
      expect(id).toMatch(/^caneca-constelacao-[0-9a-f]{4}$/);
      expect(usados.has(id)).toBe(false);
      usados.add(id);
    }
    expect(idBrinde("   ", [])).toMatch(/^brinde-[0-9a-f]{4}$/);
  });

  it("validarConfig aceita ativo opcional e exige ao menos um ativo", () => {
    const base = { pin: "1234", brindes: [{ id: "a", nome: "A", quantidade: 1, ativo: false }, { id: "b", nome: "B", quantidade: 1 }] };
    const { config, erros } = validarConfig(base);
    expect(erros).toEqual([]);
    expect(config!.brindes[0].ativo).toBe(false);
    expect("ativo" in config!.brindes[1]).toBe(false);
    expect(validarConfig({ ...base, brindes: [base.brindes[0]] }).erros.join()).toMatch(/desativados/);
    expect(validarConfig({ ...base, brindes: [{ id: "a", nome: "A", quantidade: 1, ativo: "sim" }] }).erros.join()).toMatch(/ativo/);
  });
});
