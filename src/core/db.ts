/**
 * Persistência em IndexedDB. Fonte de verdade do totem.
 *
 * - "jogadas" tem índice ÚNICO em cpfChave: a garantia final de "um CPF, uma jogada".
 *   Ao estornar, a chave vira `${chave}#estornado#${id}`, liberando o CPF.
 * - O commit de uma jogada é UMA transação (durability "strict") que lê evento, jogadas e
 *   ajustes, confere o CPF, sorteia e grava. Nada de await dentro dela.
 * - O estoque nunca é gravado: é derivado de evento + jogadas + ajustes.
 */
import { FonteU32, fracaoNaFatia, sortearPonderado, u32Cripto } from "./sorteio";
import { Ajuste, ErroRegra, Evento, Jogada, StatusJogada, cpfJaUsado, itensSorteaveis, novoId } from "./regras";

export const NOME_DB = "roleta-constelacao";
const VERSAO_DB = 1;
const LOJAS = ["evento", "jogadas", "ajustes"] as const;

export interface Dados {
  evento: Evento | null;
  jogadas: Jogada[];
  ajustes: Ajuste[];
}

export interface Backup extends Dados {
  formato: "roleta-constelacao";
  versao: 1;
  exportadoEm: number;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function fim(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("Transação abortada"));
  });
}

function tx(db: IDBDatabase, modo: IDBTransactionMode): IDBTransaction {
  return modo === "readwrite"
    ? db.transaction([...LOJAS], "readwrite", { durability: "strict" })
    : db.transaction([...LOJAS], "readonly");
}

export function abrirDb(fabrica: IDBFactory = indexedDB, nome = NOME_DB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = fabrica.open(nome, VERSAO_DB);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("evento")) db.createObjectStore("evento", { keyPath: "id" });
      if (!db.objectStoreNames.contains("jogadas")) {
        const j = db.createObjectStore("jogadas", { keyPath: "id" });
        j.createIndex("cpfChave", "cpfChave", { unique: true });
      }
      if (!db.objectStoreNames.contains("ajustes")) db.createObjectStore("ajustes", { keyPath: "id" });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error("Banco bloqueado por outra janela da roleta."));
  });
}

export async function carregar(db: IDBDatabase): Promise<Dados> {
  const t = tx(db, "readonly");
  const [eventos, jogadas, ajustes] = await Promise.all([
    req(t.objectStore("evento").getAll() as IDBRequest<Evento[]>),
    req(t.objectStore("jogadas").getAll() as IDBRequest<Jogada[]>),
    req(t.objectStore("ajustes").getAll() as IDBRequest<Ajuste[]>),
  ]);
  jogadas.sort((a, b) => a.seq - b.seq);
  ajustes.sort((a, b) => a.criadoEm - b.criadoEm);
  return { evento: eventos[0] ?? null, jogadas, ajustes };
}

export async function salvarEvento(db: IDBDatabase, evento: Evento): Promise<void> {
  const t = tx(db, "readwrite");
  const s = t.objectStore("evento");
  s.clear();
  s.put(evento);
  await fim(t);
}

export interface PedidoJogada {
  cpfChave: string;
  avulsa: boolean;
  agora: number;
  fonte?: FonteU32;
}

/** Sorteia e grava a jogada numa única transação. Rejeita com ErroRegra se não puder jogar. */
export function commitJogada(db: IDBDatabase, pedido: PedidoJogada): Promise<Jogada> {
  return new Promise((resolve, reject) => {
    const t = tx(db, "readwrite");
    let jogada: Jogada | null = null;
    let erro: unknown = null;

    const rEv = t.objectStore("evento").getAll() as IDBRequest<Evento[]>;
    const rJo = t.objectStore("jogadas").getAll() as IDBRequest<Jogada[]>;
    const rAj = t.objectStore("ajustes").getAll() as IDBRequest<Ajuste[]>;
    // As requisições de uma transação completam em ordem: em rAj.onsuccess as três terminaram.
    rAj.onsuccess = () => {
      try {
        const evento = rEv.result[0];
        if (!evento) throw new ErroRegra("semEvento", "Evento não iniciado.");
        const jogadas = rJo.result;
        if (cpfJaUsado(jogadas, pedido.cpfChave)) throw new ErroRegra("cpfUsado", "Este CPF já participou.");
        const itens = itensSorteaveis(evento, jogadas, rAj.result);
        if (itens.length === 0) throw new ErroRegra("esgotado", "Os brindes acabaram.");
        const fonte = pedido.fonte ?? u32Cripto;
        const indice = sortearPonderado(
          itens.map((i) => i.peso),
          fonte,
        );
        const seq = jogadas.reduce((m, j) => Math.max(m, j.seq), 0) + 1;
        jogada = {
          id: novoId(),
          seq,
          cpfChave: pedido.cpfChave,
          avulsa: pedido.avulsa,
          brindeId: itens[indice].id,
          brindeNome: itens[indice].nome,
          fatias: itens,
          indice,
          fracao: fracaoNaFatia(fonte),
          status: "sorteado",
          criadoEm: pedido.agora,
        };
        t.objectStore("jogadas").add(jogada);
      } catch (e) {
        erro = e;
        t.abort();
      }
    };
    t.oncomplete = () => (jogada ? resolve(jogada) : reject(new Error("Jogada não gravada")));
    t.onabort = () => {
      const causa = erro ?? t.error;
      if (causa instanceof DOMException && causa.name === "ConstraintError") {
        reject(new ErroRegra("cpfUsado", "Este CPF já participou."));
      } else reject(causa ?? new Error("Transação abortada"));
    };
  });
}

async function alterarJogada(db: IDBDatabase, id: string, mudar: (j: Jogada) => Jogada): Promise<Jogada> {
  const t = tx(db, "readwrite");
  const s = t.objectStore("jogadas");
  const atual = (await req(s.get(id) as IDBRequest<Jogada | undefined>)) ?? null;
  if (!atual) {
    t.abort();
    throw new Error("Jogada não encontrada.");
  }
  let nova: Jogada;
  try {
    nova = mudar(atual);
  } catch (e) {
    t.abort();
    throw e;
  }
  s.put(nova);
  await fim(t);
  return nova;
}

export function marcarRevelada(db: IDBDatabase, id: string, agora: number): Promise<Jogada> {
  return alterarJogada(db, id, (j) => (j.status === "sorteado" ? { ...j, status: "revelado" as StatusJogada, reveladoEm: agora } : j));
}

/** Estorno: libera o CPF. devolver=true devolve a unidade ao estoque; false a dá como perdida. */
export function estornarJogada(db: IDBDatabase, id: string, devolver: boolean, agora: number): Promise<Jogada> {
  return alterarJogada(db, id, (j) => {
    if (j.status === "estornado") throw new Error("Jogada já estornada.");
    return {
      ...j,
      status: "estornado",
      devolvido: devolver,
      estornadoEm: agora,
      cpfChave: `${j.cpfChave}#estornado#${j.id}`,
    };
  });
}

export async function adicionarAjuste(db: IDBDatabase, brindeId: string, delta: number, motivo: string, agora: number): Promise<Ajuste> {
  const ajuste: Ajuste = { id: novoId(), brindeId, delta, motivo, criadoEm: agora };
  const t = tx(db, "readwrite");
  t.objectStore("ajustes").add(ajuste);
  await fim(t);
  return ajuste;
}

export async function limparTudo(db: IDBDatabase): Promise<void> {
  const t = tx(db, "readwrite");
  for (const l of LOJAS) t.objectStore(l).clear();
  await fim(t);
}

export function montarBackup(d: Dados, agora: number): Backup {
  return { formato: "roleta-constelacao", versao: 1, exportadoEm: agora, ...d };
}

const PRIORIDADE: Record<StatusJogada, number> = { sorteado: 0, revelado: 1, estornado: 2 };

const ehTexto = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Rejeita o arquivo inteiro se algo estiver fora do formato (nunca grava dado quebrado). */
export function validarBackup(b: unknown): asserts b is Backup {
  const erro = (m: string) => new Error(`Backup inválido: ${m}`);
  const x = b as Partial<Backup> | null;
  if (!x || x.formato !== "roleta-constelacao" || x.versao !== 1) throw erro("não é um backup da roleta.");
  const ev = x.evento;
  if (!ev || !ehTexto(ev.id) || !ehTexto(ev.sal) || !Number.isInteger(ev.iteracoes) || !ehTexto(ev.pinHash) || !Array.isArray(ev.brindes)) {
    throw erro("evento incompleto.");
  }
  for (const br of ev.brindes) {
    if (!ehTexto(br?.id) || !ehTexto(br?.nome) || !Number.isInteger(br?.quantidade) || br.quantidade < 0) throw erro("brinde inválido.");
    if (br.ativo !== undefined && typeof br.ativo !== "boolean") throw erro("brinde inválido.");
  }
  if (!Array.isArray(x.jogadas) || !Array.isArray(x.ajustes)) throw erro("listas ausentes.");
  for (const j of x.jogadas) {
    const ok =
      ehTexto(j?.id) &&
      ehTexto(j?.cpfChave) &&
      ehTexto(j?.brindeId) &&
      Number.isInteger(j?.seq) &&
      j.seq >= 1 &&
      (j.status === "sorteado" || j.status === "revelado" || j.status === "estornado") &&
      Array.isArray(j.fatias) &&
      j.fatias.length > 0 &&
      j.fatias.every((f) => ehTexto(f?.id) && Number.isInteger(f?.peso) && f.peso >= 1) &&
      Number.isInteger(j.indice) &&
      j.indice >= 0 &&
      j.indice < j.fatias.length &&
      Number.isFinite(j.fracao);
    if (!ok) throw erro(`jogada ${j?.seq ?? "?"} malformada.`);
  }
  for (const a of x.ajustes) {
    if (!ehTexto(a?.id) || !ehTexto(a?.brindeId) || !Number.isInteger(a?.delta)) throw erro("ajuste malformado.");
  }
}

/**
 * Importa um backup. Se já houver evento DIFERENTE, só substitui com `substituir`.
 * Se for o mesmo evento, faz a UNIÃO por id (o status mais avançado vence).
 */
export async function importarBackup(db: IDBDatabase, b: unknown, substituir: boolean): Promise<Dados> {
  validarBackup(b);
  const atual = await carregar(db);
  if (atual.evento && atual.evento.id !== b.evento!.id && !substituir) {
    throw new Error("O backup é de outro evento. Confirme a substituição.");
  }
  const mesmo = atual.evento?.id === b.evento!.id;
  const jogadas = new Map<string, Jogada>();
  const ajustes = new Map<string, Ajuste>();
  for (const j of [...(mesmo ? atual.jogadas : []), ...b.jogadas]) {
    const ja = jogadas.get(j.id);
    if (!ja || PRIORIDADE[j.status] > PRIORIDADE[ja.status]) jogadas.set(j.id, j);
  }
  for (const a of [...(mesmo ? atual.ajustes : []), ...b.ajustes]) ajustes.set(a.id, a);

  // Conflitos de união (ex.: o mesmo CPF jogou em dois PCs com o mesmo evento): recusa com mensagem clara.
  const porCpf = new Map<string, Jogada[]>();
  const porSeq = new Map<number, string>();
  for (const j of jogadas.values()) {
    if (j.status !== "estornado") porCpf.set(j.cpfChave, [...(porCpf.get(j.cpfChave) ?? []), j]);
    const outro = porSeq.get(j.seq);
    if (outro && outro !== j.id) throw new Error(`O backup tem jogadas diferentes com o mesmo código #${String(j.seq).padStart(3, "0")} (dois PCs no mesmo evento?). Importação cancelada.`);
    porSeq.set(j.seq, j.id);
  }
  const duplicadas = [...porCpf.values()].filter((l) => l.length > 1);
  if (duplicadas.length) {
    throw new Error(`O mesmo CPF aparece em ${duplicadas.length} pares de jogadas (dois PCs no mesmo evento?). Importação cancelada.`);
  }

  // Mesmo evento: o cadastro ATUAL vence (ele pode ter sido editado depois do backup).
  // Brindes que só existem no backup entram desativados, para não reativar nada sem querer.
  let evento: Evento = b.evento!;
  if (mesmo && atual.evento) {
    const brindes = atual.evento.brindes.map((x) => ({ ...x }));
    const ids = new Set(brindes.map((x) => x.id));
    for (const br of b.evento!.brindes) {
      if (!ids.has(br.id)) {
        brindes.push({ ...br, ativo: false });
        ids.add(br.id);
      }
    }
    // Toda jogada/ajuste precisa apontar para um brinde do cadastro (senão o estoque fica órfão).
    for (const j of jogadas.values()) {
      if (!ids.has(j.brindeId)) {
        brindes.push({ id: j.brindeId, nome: j.brindeNome, rotulo: j.brindeNome, quantidade: 0, ativo: false });
        ids.add(j.brindeId);
      }
    }
    evento = { ...atual.evento, brindes };
  }

  const t = tx(db, "readwrite");
  for (const l of LOJAS) t.objectStore(l).clear();
  t.objectStore("evento").put(evento);
  for (const j of jogadas.values()) t.objectStore("jogadas").put(j);
  for (const a of ajustes.values()) t.objectStore("ajustes").put(a);
  await fim(t);
  return carregar(db);
}
