import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import * as db from "./db";
import { Evento, ErroRegra, calcularEstoque, itensSorteaveis } from "./regras";

function evento(parcial: Partial<Evento> = {}): Evento {
  return {
    id: "ev1",
    nome: "Teste",
    criadoEm: 0,
    sal: "AAAAAAAAAAAAAAAAAAAAAA==",
    iteracoes: 1000,
    pinHash: "x",
    modoSorteio: "porTipo",
    som: true,
    brindes: [
      { id: "caneca", nome: "Caneca", rotulo: "Caneca", quantidade: 2 },
      { id: "fone", nome: "Fone", rotulo: "Fone", quantidade: 1 },
      { id: "voucher", nome: "Voucher", rotulo: "Voucher", quantidade: 1 },
    ],
    ...parcial,
  };
}

async function novoBanco(ev: Evento | null = evento()) {
  const banco = await db.abrirDb(new IDBFactory(), "teste");
  if (ev) await db.salvarEvento(banco, ev);
  return banco;
}

const fixo = (v: number) => () => v;

describe("commitJogada", () => {
  it("grava a jogada com retrato das fatias e respeita o índice sorteado", async () => {
    const banco = await novoBanco();
    const j = await db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1, fonte: fixo(1) });
    expect(j.brindeId).toBe("fone");
    expect(j.indice).toBe(1);
    expect(j.fatias.map((f) => f.id)).toEqual(["caneca", "fone", "voucher"]);
    expect(j.seq).toBe(1);
    expect(j.status).toBe("sorteado");
    const d = await db.carregar(banco);
    expect(d.jogadas).toHaveLength(1);
  });

  it("bloqueia o mesmo CPF (regra e índice único)", async () => {
    const banco = await novoBanco();
    await db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1, fonte: fixo(0) });
    await expect(db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 2, fonte: fixo(0) })).rejects.toMatchObject({
      codigo: "cpfUsado",
    });
    expect((await db.carregar(banco)).jogadas).toHaveLength(1);
  });

  it("commits simultâneos do mesmo CPF gravam só uma jogada", async () => {
    const banco = await novoBanco();
    const r = await Promise.allSettled([
      db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1 }),
      db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1 }),
      db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1 }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await db.carregar(banco)).jogadas).toHaveLength(1);
  });

  it("o tipo que zera some da roleta e a chance se redistribui", async () => {
    const banco = await novoBanco();
    await db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1, fonte: fixo(1) }); // fone (único)
    let d = await db.carregar(banco);
    expect(itensSorteaveis(d.evento!, d.jogadas, d.ajustes).map((i) => i.id)).toEqual(["caneca", "voucher"]);
    await db.commitJogada(banco, { cpfChave: "B", avulsa: false, agora: 2, fonte: fixo(1) }); // voucher
    await db.commitJogada(banco, { cpfChave: "C", avulsa: false, agora: 3, fonte: fixo(0) }); // caneca 1/2
    await db.commitJogada(banco, { cpfChave: "D", avulsa: false, agora: 4, fonte: fixo(0) }); // caneca 2/2
    await expect(db.commitJogada(banco, { cpfChave: "E", avulsa: false, agora: 5 })).rejects.toBeInstanceOf(ErroRegra);
    d = await db.carregar(banco);
    expect(itensSorteaveis(d.evento!, d.jogadas, d.ajustes)).toEqual([]);
    expect([...calcularEstoque(d.evento!, d.jogadas, d.ajustes).values()]).toEqual([0, 0, 0]);
  });

  it("porUnidade pesa pelo estoque restante", async () => {
    const banco = await novoBanco(evento({ modoSorteio: "porUnidade" }));
    const d = await db.carregar(banco);
    expect(itensSorteaveis(d.evento!, d.jogadas, d.ajustes).map((i) => i.peso)).toEqual([2, 1, 1]);
    // r=1 cai na caneca (faixa 0..1)
    const j = await db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1, fonte: fixo(1) });
    expect(j.brindeId).toBe("caneca");
  });

  it("sem evento recusa", async () => {
    const banco = await novoBanco(null);
    await expect(db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1 })).rejects.toMatchObject({ codigo: "semEvento" });
  });
});

describe("estorno e ajustes", () => {
  it("estorno com devolução libera CPF e unidade", async () => {
    const banco = await novoBanco();
    const j = await db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1, fonte: fixo(1) }); // fone
    await db.estornarJogada(banco, j.id, true, 2);
    const d = await db.carregar(banco);
    expect(calcularEstoque(d.evento!, d.jogadas, d.ajustes).get("fone")).toBe(1);
    const j2 = await db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 3, fonte: fixo(0) });
    expect(j2.seq).toBe(2);
  });

  it("estorno sem devolução libera o CPF mas não a unidade", async () => {
    const banco = await novoBanco();
    const j = await db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1, fonte: fixo(1) });
    await db.estornarJogada(banco, j.id, false, 2);
    const d = await db.carregar(banco);
    expect(calcularEstoque(d.evento!, d.jogadas, d.ajustes).get("fone")).toBe(0);
    await expect(db.estornarJogada(banco, j.id, true, 3)).rejects.toThrow();
  });

  it("ajustes somam ao estoque e nunca deixam negativo", async () => {
    const banco = await novoBanco();
    await db.adicionarAjuste(banco, "voucher", +3, "x", 1);
    await db.adicionarAjuste(banco, "fone", -5, "x", 2);
    const d = await db.carregar(banco);
    const e = calcularEstoque(d.evento!, d.jogadas, d.ajustes);
    expect(e.get("voucher")).toBe(4);
    expect(e.get("fone")).toBe(0);
  });
});

describe("backup", () => {
  it("restaura em banco vazio e une por id no mesmo evento", async () => {
    const origem = await novoBanco();
    const j1 = await db.commitJogada(origem, { cpfChave: "A", avulsa: false, agora: 1, fonte: fixo(0) });
    const backup = db.montarBackup(await db.carregar(origem), 10);

    const destino = await novoBanco(null);
    const restaurado = await db.importarBackup(destino, JSON.parse(JSON.stringify(backup)), false);
    expect(restaurado.jogadas.map((j) => j.id)).toEqual([j1.id]);
    // o CPF continua bloqueado no destino
    await expect(db.commitJogada(destino, { cpfChave: "A", avulsa: false, agora: 2 })).rejects.toMatchObject({ codigo: "cpfUsado" });

    // nova jogada no destino + reimportar backup antigo = união, não perda
    await db.commitJogada(destino, { cpfChave: "B", avulsa: false, agora: 3, fonte: fixo(0) });
    const unido = await db.importarBackup(destino, backup, false);
    expect(unido.jogadas).toHaveLength(2);
  });

  it("recusa backup malformado sem gravar nada", async () => {
    const banco = await novoBanco();
    const j = await db.commitJogada(banco, { cpfChave: "A", avulsa: false, agora: 1, fonte: fixo(0) });
    const bom = db.montarBackup(await db.carregar(banco), 1);
    const ruim = JSON.parse(JSON.stringify(bom));
    ruim.jogadas[0].indice = 99;
    await expect(db.importarBackup(banco, ruim, true)).rejects.toThrow(/malformada/);
    await expect(db.importarBackup(banco, { formato: "x" }, true)).rejects.toThrow(/inválido/);
    expect((await db.carregar(banco)).jogadas.map((x) => x.id)).toEqual([j.id]);
  });

  it("recusa unir histórias divergentes do mesmo evento (mesmo CPF em dois PCs)", async () => {
    const pc1 = await novoBanco();
    const pc2 = await novoBanco();
    await db.commitJogada(pc1, { cpfChave: "A", avulsa: false, agora: 1, fonte: fixo(0) });
    await db.commitJogada(pc2, { cpfChave: "A", avulsa: false, agora: 2, fonte: fixo(0) });
    const b2 = db.montarBackup(await db.carregar(pc2), 3);
    await expect(db.importarBackup(pc1, b2, false)).rejects.toThrow(/cancelada/);
    expect((await db.carregar(pc1)).jogadas).toHaveLength(1);
  });

  it("importar backup antigo do mesmo evento mantém o cadastro atual", async () => {
    const banco = await novoBanco();
    const antigo = db.montarBackup(await db.carregar(banco), 1);
    // depois do backup: voucher desativado e um brinde novo cadastrado
    const atual = (await db.carregar(banco)).evento!;
    await db.salvarEvento(banco, {
      ...atual,
      brindes: [
        ...atual.brindes.map((b) => (b.id === "voucher" ? { ...b, ativo: false } : b)),
        { id: "novo", nome: "Novo", rotulo: "Novo", quantidade: 2 },
      ],
    });
    const d = await db.importarBackup(banco, antigo, false);
    const ids = itensSorteaveis(d.evento!, d.jogadas, d.ajustes).map((i) => i.id);
    expect(ids).toEqual(["caneca", "fone", "novo"]); // voucher continua desativado; novo continua lá
  });

  it("não substitui outro evento sem confirmação", async () => {
    const banco = await novoBanco(evento({ id: "outro" }));
    const backup = db.montarBackup({ evento: evento(), jogadas: [], ajustes: [] }, 1);
    await expect(db.importarBackup(banco, backup, false)).rejects.toThrow();
    const d = await db.importarBackup(banco, backup, true);
    expect(d.evento!.id).toBe("ev1");
  });
});
