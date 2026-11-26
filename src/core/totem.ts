/**
 * Máquina de estados do totem (fora do React, consumida via useSyncExternalStore).
 *
 * ATRACAO -> CPF -> PRONTO -> [commit] -> GIRANDO -> RESULTADO -> ATRACAO | ESGOTADO
 *
 * Regras de integridade:
 * - O resultado é sorteado e GRAVADO antes de qualquer animação.
 * - O fim do giro é decidido por um timer desta máquina, nunca pelo renderizador.
 * - Ao recarregar com uma jogada "sorteado" pendente, volta direto ao RESULTADO.
 * - A rotação (ângulo) vive fora do estado React: os palcos leem a cada quadro.
 */
import { cpfValido, somenteDigitos } from "./cpf";
import * as db from "./db";
import { Fatia, PlanoGiro, Rotacao, anguloAlvo, anguloAtual, montarFatias, planejarGiro } from "./geometria";
import { ITERACOES_PADRAO, chaveCpf, hashPin, novoSal } from "./hash";
import { ConfigBrindes, ErroRegra, Evento, Jogada, calcularEstoque, cpfJaUsado, itensSorteaveis, novoId } from "./regras";

export type Fase =
  | "carregando"
  | "outraJanela"
  | "erro"
  | "semEvento"
  | "atracao"
  | "cpf"
  | "pronto"
  | "girando"
  | "resultado"
  | "esgotado";

export interface EstadoTotem {
  fase: Fase;
  evento: Evento | null;
  jogadas: Jogada[];
  ajustes: db.Dados["ajustes"];
  estoque: Map<string, number>;
  /** fatias desenhadas agora (retrato congelado durante giro/resultado) */
  fatias: Fatia[];
  digitos: string;
  verificando: boolean;
  aviso: string | null;
  avulsa: boolean;
  jogadaAtual: Jogada | null;
  retomada: boolean;
  erro: string | null;
  persistido: boolean | null;
  /** muda a cada giro; os palcos usam para saber que um giro começou */
  giroId: number;
}

const OMEGA_OCIOSO = (Math.PI * 2) / 60; // 1 volta por minuto
export const TEMPO_OCIOSO_MS = 20_000;
export const TEMPO_RESULTADO_MS = 12_000;
const W0_BOTAO = 9;

function chaveFatias(fs: readonly Fatia[]): string {
  return fs.map((f) => `${f.id}|${f.rotulo}|${f.inicio.toFixed(6)}|${f.largura.toFixed(6)}`).join(";");
}

type Ouvinte = () => void;
type ListenerTique = () => void;

export class TotemStore {
  private estado: EstadoTotem = {
    fase: "carregando",
    evento: null,
    jogadas: [],
    ajustes: [],
    estoque: new Map(),
    fatias: [],
    digitos: "",
    verificando: false,
    aviso: null,
    avulsa: false,
    jogadaAtual: null,
    retomada: false,
    erro: null,
    persistido: null,
    giroId: 0,
  };
  private ouvintes = new Set<Ouvinte>();
  private db: IDBDatabase | null = null;
  private iniciado = false;
  private travado = false;
  private cpfChave: string | null = null;
  private tokenVerificacao = 0;
  private timerOcioso: ReturnType<typeof setTimeout> | null = null;
  private timerGiro: ReturnType<typeof setTimeout> | null = null;
  private tiques = new Set<ListenerTique>();
  private omegaOcioso = OMEGA_OCIOSO;

  /** Rotação atual da roleta (lida pelos palcos em requestAnimationFrame). */
  rotacao: Rotacao = { tipo: "ocioso", base: 0, t0: 0, omega: this.omegaOcioso };

  constructor(private relogio: () => number = () => performance.now()) {}

  // ---------- assinatura ----------
  getEstado = (): EstadoTotem => this.estado;
  assinar = (fn: Ouvinte): (() => void) => {
    this.ouvintes.add(fn);
    return () => this.ouvintes.delete(fn);
  };
  aoTique(fn: ListenerTique): () => void {
    this.tiques.add(fn);
    return () => this.tiques.delete(fn);
  }
  emitirTique(): void {
    this.tiques.forEach((f) => f());
  }

  private set(parcial: Partial<EstadoTotem>): void {
    const novo = { ...this.estado, ...parcial };
    if ("evento" in parcial || "jogadas" in parcial || "ajustes" in parcial || "fase" in parcial || "jogadaAtual" in parcial) {
      novo.estoque = novo.evento ? calcularEstoque(novo.evento, novo.jogadas, novo.ajustes) : new Map();
      const congelado = (novo.fase === "girando" || novo.fase === "resultado") && novo.jogadaAtual;
      const fatias = congelado
        ? montarFatias(novo.jogadaAtual!.fatias)
        : novo.evento
          ? montarFatias(itensSorteaveis(novo.evento, novo.jogadas, novo.ajustes))
          : [];
      // Reaproveita a referência quando nada mudou: evita redesenhar a face (2D e 3D) à toa.
      novo.fatias = chaveFatias(fatias) === chaveFatias(this.estado.fatias) ? this.estado.fatias : fatias;
    }
    this.estado = novo;
    this.ouvintes.forEach((f) => f());
  }

  // ---------- inicialização ----------
  async iniciar(): Promise<void> {
    if (this.iniciado) return;
    this.iniciado = true;
    try {
      if (!globalThis.crypto?.subtle) {
        throw new Error("Este navegador não oferece WebCrypto. Abra a roleta em http://localhost (veja o LEIA-ME).");
      }
      if (typeof indexedDB === "undefined") throw new Error("IndexedDB indisponível neste navegador.");
      // Se outra janela da roleta estiver aberta, espera ela fechar e continua sozinha.
      await this.obterTrava(() => this.set({ fase: "outraJanela" }));
      this.db = await db.abrirDb();
      const persistido = await navigator.storage?.persist?.().catch(() => false);
      const dados = await db.carregar(this.db);
      try {
        this.aplicarDados(dados, persistido ?? null);
      } catch (e) {
        // Mantém os dados no estado para o administrador conseguir exportar/encerrar.
        this.set({ ...dados, persistido: persistido ?? null, fase: "erro", erro: e instanceof Error ? e.message : String(e) });
      }
    } catch (e) {
      this.set({ fase: "erro", erro: e instanceof Error ? e.message : String(e) });
    }
  }

  private obterTrava(aoEsperar: () => void): Promise<void> {
    const locks = (navigator as Navigator & { locks?: LockManager }).locks;
    if (!locks) return Promise.resolve();
    const nome = "roleta-constelacao-instancia";
    const segurar = () => new Promise<void>(() => {}); // mantém a trava enquanto a página existir
    return new Promise((resolve) => {
      locks
        .request(nome, { ifAvailable: true }, (lock) => {
          if (lock) {
            resolve();
            return segurar();
          }
          aoEsperar();
          locks
            .request(nome, () => {
              resolve();
              return segurar();
            })
            .catch(() => resolve());
          return undefined;
        })
        .catch(() => resolve());
    });
  }

  private aplicarDados(d: db.Dados, persistido: boolean | null = this.estado.persistido): void {
    this.limparTimers();
    const pendente = [...d.jogadas].reverse().find((j) => j.status === "sorteado") ?? null;
    if (!d.evento) {
      this.set({ ...d, persistido, fase: "semEvento", jogadaAtual: null });
      return;
    }
    if (pendente && pendente.fatias[pendente.indice]) {
      // Retomada após queda/recarga: mostra o resultado já sorteado, sem novo sorteio.
      const fatias = montarFatias(pendente.fatias);
      const alvo = anguloAlvo(fatias[pendente.indice], pendente.fracao);
      this.rotacao = { tipo: "parado", theta: -alvo };
      this.set({ ...d, persistido, fase: "resultado", jogadaAtual: pendente, retomada: true });
      void this.revelar(pendente);
      return;
    }
    this.set({ ...d, persistido, jogadaAtual: null, retomada: false });
    this.irParaAtracao();
  }

  // ---------- fluxo do participante ----------
  private irParaAtracao(): void {
    this.limparTimers();
    this.cpfChave = null;
    this.tokenVerificacao++;
    const theta = anguloAtual(this.rotacao, this.relogio());
    this.rotacao = { tipo: "ocioso", base: theta, t0: this.relogio(), omega: this.omegaOcioso };
    const vazio = this.estado.evento ? itensSorteaveis(this.estado.evento, this.estado.jogadas, this.estado.ajustes).length === 0 : false;
    this.set({
      fase: !this.estado.evento ? "semEvento" : vazio ? "esgotado" : "atracao",
      digitos: "",
      aviso: null,
      verificando: false,
      avulsa: false,
      jogadaAtual: null,
      retomada: false,
    });
  }

  /** Qualquer toque reinicia o contador de ociosidade. */
  tocar(): void {
    const f = this.estado.fase;
    if (f === "cpf" || f === "pronto") this.agendarOcioso(TEMPO_OCIOSO_MS, () => this.irParaAtracao());
  }

  comecar(): void {
    if (this.estado.fase !== "atracao") return;
    this.set({ fase: "cpf", digitos: "", aviso: null });
    this.tocar();
  }

  digitar(d: string): void {
    if (!/^\d$/.test(d)) return;
    if (this.estado.fase === "atracao") this.comecar();
    if (this.estado.fase !== "cpf" || this.estado.avulsa) return;
    if (this.estado.digitos.length >= 11) return;
    const digitos = this.estado.digitos + d;
    this.set({ digitos, aviso: null });
    this.tocar();
    if (digitos.length === 11) void this.verificar(digitos);
  }

  apagar(): void {
    const f = this.estado.fase;
    if (f !== "cpf" && f !== "pronto") return;
    if (this.estado.avulsa) return;
    this.tokenVerificacao++;
    this.cpfChave = null;
    this.set({ fase: "cpf", digitos: this.estado.digitos.slice(0, -1), aviso: null, verificando: false });
    this.tocar();
  }

  limpar(): void {
    const f = this.estado.fase;
    if (f !== "cpf" && f !== "pronto") return;
    this.tokenVerificacao++;
    this.cpfChave = null;
    this.set({ fase: "cpf", digitos: "", aviso: null, verificando: false, avulsa: false });
    this.tocar();
  }

  cancelar(): void {
    const f = this.estado.fase;
    if (f === "cpf" || f === "pronto") this.irParaAtracao();
  }

  private async verificar(digitos: string): Promise<void> {
    const ev = this.estado.evento;
    if (!ev) return;
    if (!cpfValido(digitos)) {
      this.set({ aviso: "CPF inválido. Confira os números." });
      return;
    }
    const token = ++this.tokenVerificacao;
    this.set({ verificando: true });
    try {
      const chave = await chaveCpf(digitos, ev.sal, ev.iteracoes);
      if (token !== this.tokenVerificacao) return;
      if (cpfJaUsado(this.estado.jogadas, chave)) {
        this.set({ verificando: false, aviso: "Este CPF já participou. Obrigado!" });
        return;
      }
      this.cpfChave = chave;
      this.set({ verificando: false, fase: "pronto" });
      this.tocar();
    } catch (e) {
      if (token !== this.tokenVerificacao) return;
      this.set({ verificando: false, aviso: e instanceof Error ? e.message : "Falha ao verificar o CPF." });
    }
  }

  /** Liga/desliga o giro lento de atração (modo leve desliga para economizar quadros). */
  definirMovimentoOcioso(ativo: boolean): void {
    this.omegaOcioso = ativo ? OMEGA_OCIOSO : 0;
    if (this.rotacao.tipo === "ocioso") {
      const agora = this.relogio();
      this.rotacao = { tipo: "ocioso", base: anguloAtual(this.rotacao, agora), t0: agora, omega: this.omegaOcioso };
    }
  }

  /** Arrasto com o dedo antes do giro (apenas visual; não decide nada). */
  arrastar(theta: number): void {
    if (this.estado.fase !== "pronto" && this.estado.fase !== "atracao") return;
    this.rotacao = { tipo: "parado", theta };
    this.tocar();
  }

  /** Fim de um arrasto que não virou giro: a roleta volta a girar devagar dali. */
  soltarSemGiro(): void {
    if (this.rotacao.tipo !== "parado") return;
    if (this.estado.fase === "atracao" || this.estado.fase === "pronto") {
      this.rotacao = { tipo: "ocioso", base: this.rotacao.theta, t0: this.relogio(), omega: this.omegaOcioso };
    }
  }

  /** Lança a roleta. Grava o resultado ANTES de animar. w0 em rad/s; sentido +1 horário. */
  async girar(w0: number = W0_BOTAO, sentido = 1): Promise<void> {
    if (this.travado || this.estado.fase !== "pronto" || !this.db) return;
    const chave = this.estado.avulsa ? `avulsa#${novoId()}` : this.cpfChave;
    if (!chave) return;
    this.travado = true;
    this.limparTimers();
    try {
      const jogada = await db.commitJogada(this.db, { cpfChave: chave, avulsa: this.estado.avulsa, agora: Date.now() });
      const fatias = montarFatias(jogada.fatias);
      const alvo = anguloAlvo(fatias[jogada.indice], jogada.fracao);
      const agora = this.relogio();
      const plano: PlanoGiro = planejarGiro({ theta0: anguloAtual(this.rotacao, agora), alvo, sentido, w0 });
      this.rotacao = { tipo: "giro", plano, t0: agora };
      this.cpfChave = null;
      this.set({
        fase: "girando",
        jogadas: [...this.estado.jogadas, jogada],
        jogadaAtual: jogada,
        digitos: "",
        aviso: null,
        avulsa: false,
        retomada: false,
        giroId: this.estado.giroId + 1,
      });
      this.timerGiro = setTimeout(() => void this.terminarGiro(jogada, plano), plano.T * 1000 + 250);
    } catch (e) {
      this.cpfChave = null;
      if (e instanceof ErroRegra && e.codigo === "esgotado") {
        this.irParaAtracao();
      } else {
        const aviso = e instanceof ErroRegra ? e.message : "Não foi possível registrar a jogada. Chame a equipe.";
        if (!(e instanceof ErroRegra)) console.error(e);
        // limpa o CPF da tela e volta a contar a ociosidade
        this.set({ fase: "cpf", digitos: "", verificando: false, aviso, avulsa: false });
        this.tocar();
      }
    } finally {
      this.travado = false;
    }
  }

  private async terminarGiro(jogada: Jogada, plano: PlanoGiro): Promise<void> {
    if (this.estado.jogadaAtual?.id !== jogada.id) return;
    this.rotacao = { tipo: "parado", theta: plano.thetaFinal };
    this.set({ fase: "resultado" });
    await this.revelar(jogada);
    this.agendarOcioso(TEMPO_RESULTADO_MS, () => this.fecharResultado());
  }

  private async revelar(jogada: Jogada): Promise<void> {
    if (!this.db) return;
    for (const espera of [0, 300, 1000, 3000]) {
      if (espera) await new Promise((r) => setTimeout(r, espera));
      try {
        const nova = await db.marcarRevelada(this.db, jogada.id, Date.now());
        this.set({ jogadas: this.estado.jogadas.map((j) => (j.id === nova.id ? nova : j)) });
        return;
      } catch (e) {
        console.error("Falha ao marcar jogada como revelada", e);
      }
    }
  }

  fecharResultado(): void {
    if (this.estado.fase !== "resultado") return;
    this.irParaAtracao();
  }

  // ---------- administrador ----------
  private tentativasPin = 0;
  private pinBloqueadoAte = 0;

  /** Segundos restantes de bloqueio do PIN (0 = liberado). Sobrevive a fechar/abrir o admin. */
  bloqueioPin(): number {
    return Math.max(0, Math.ceil((this.pinBloqueadoAte - Date.now()) / 1000));
  }

  async verificarPin(pin: string, config: ConfigBrindes | null): Promise<boolean> {
    if (this.bloqueioPin() > 0) return false;
    const ev = this.estado.evento;
    const ok = ev ? (await hashPin(pin, ev.sal)) === ev.pinHash : !!config && pin === config.pin;
    if (ok) this.tentativasPin = 0;
    else if (++this.tentativasPin >= 5) {
      this.tentativasPin = 0;
      this.pinBloqueadoAte = Date.now() + 60_000;
    }
    return ok;
  }

  private exigirDb(): IDBDatabase {
    if (!this.db) throw new Error("Banco de dados não aberto.");
    return this.db;
  }

  private async recarregar(): Promise<void> {
    this.aplicarDados(await db.carregar(this.exigirDb()));
  }

  async abrirEvento(config: ConfigBrindes): Promise<void> {
    const banco = this.exigirDb();
    const atual = await db.carregar(banco);
    if (atual.evento) throw new Error("Já existe um evento aberto. Encerre-o antes.");
    const sal = novoSal();
    const evento: Evento = {
      id: novoId(),
      nome: config.evento,
      criadoEm: Date.now(),
      sal,
      iteracoes: ITERACOES_PADRAO,
      pinHash: await hashPin(config.pin, sal),
      modoSorteio: config.modoSorteio,
      som: config.som,
      brindes: config.brindes.map((b) => ({ ...b })),
    };
    await db.salvarEvento(banco, evento);
    await this.recarregar();
  }

  async alterarSom(som: boolean): Promise<void> {
    const ev = this.estado.evento;
    if (!ev) return;
    await db.salvarEvento(this.exigirDb(), { ...ev, som });
    this.set({ evento: { ...ev, som } });
  }

  async ajustarEstoque(brindeId: string, delta: number): Promise<void> {
    const banco = this.exigirDb();
    const ajuste = await db.adicionarAjuste(banco, brindeId, delta, delta > 0 ? "acréscimo manual" : "baixa manual", Date.now());
    this.set({ ajustes: [...this.estado.ajustes, ajuste] });
    if (this.estado.fase === "esgotado" || this.estado.fase === "atracao") this.irParaAtracao();
  }

  async estornar(jogadaId: string, devolver: boolean): Promise<void> {
    if (this.estado.jogadaAtual?.id === jogadaId && this.estado.fase === "girando") {
      throw new Error("Aguarde o giro terminar para estornar esta jogada.");
    }
    const nova = await db.estornarJogada(this.exigirDb(), jogadaId, devolver, Date.now());
    this.set({ jogadas: this.estado.jogadas.map((j) => (j.id === nova.id ? nova : j)) });
    const f = this.estado.fase;
    if (f === "esgotado" || f === "atracao" || (f === "resultado" && this.estado.jogadaAtual?.id === jogadaId)) this.irParaAtracao();
  }

  async consultarCpf(cpf: string): Promise<Jogada[]> {
    const ev = this.estado.evento;
    const d = somenteDigitos(cpf);
    if (!ev || !cpfValido(d)) return [];
    const chave = await chaveCpf(d, ev.sal, ev.iteracoes);
    return this.estado.jogadas.filter((j) => j.cpfChave === chave || j.cpfChave.startsWith(`${chave}#estornado#`));
  }

  liberarAvulsa(): void {
    const f = this.estado.fase;
    if (f === "resultado") throw new Error("Toque em Concluir na tela de resultado e tente de novo.");
    if (f === "esgotado") throw new Error("Não há brindes em estoque.");
    if (f !== "atracao" && f !== "cpf" && f !== "pronto") throw new Error("Abra o evento antes.");
    this.tokenVerificacao++;
    this.cpfChave = null;
    this.set({ fase: "pronto", avulsa: true, digitos: "", aviso: null, verificando: false });
    this.tocar();
  }

  exportar(): db.Backup {
    const { evento, jogadas, ajustes } = this.estado;
    return db.montarBackup({ evento, jogadas, ajustes }, Date.now());
  }

  async importar(backup: db.Backup, substituir: boolean): Promise<void> {
    if (this.estado.fase === "girando") throw new Error("Aguarde o giro terminar.");
    const dados = await db.importarBackup(this.exigirDb(), backup, substituir);
    this.aplicarDados(dados);
  }

  async encerrarEvento(): Promise<void> {
    if (this.estado.fase === "girando") throw new Error("Aguarde o giro terminar.");
    await db.limparTudo(this.exigirDb());
    await this.recarregar();
  }

  /** Fase em que o administrador pode ser aberto sem atrapalhar um giro. */
  podeAbrirAdmin(): boolean {
    return this.estado.fase !== "girando";
  }

  // ---------- util ----------
  private agendarOcioso(ms: number, fn: () => void): void {
    if (this.timerOcioso) clearTimeout(this.timerOcioso);
    this.timerOcioso = setTimeout(fn, ms);
  }

  private limparTimers(): void {
    if (this.timerOcioso) clearTimeout(this.timerOcioso);
    if (this.timerGiro) clearTimeout(this.timerGiro);
    this.timerOcioso = null;
    this.timerGiro = null;
  }

  /** Só para testes: injeta um banco já aberto. */
  async iniciarComDb(banco: IDBDatabase): Promise<void> {
    this.iniciado = true;
    this.db = banco;
    this.aplicarDados(await db.carregar(banco), true);
  }
}
