/**
 * Som sintetizado com WebAudio (sem arquivos). Falhas de áudio nunca bloqueiam o fluxo.
 *
 * Os sons de formação da roleta (escolhidos no administrador / tela de teste) passam por uma
 * reverberação gerada uma vez (resposta ao impulso de ruído decaindo), que dá "espaço" sem
 * arquivos de áudio.
 */
import type { SomFormacao } from "@/ui/preferencias";

class Som {
  private ctx: AudioContext | null = null;
  private ultimoTique = 0;
  /** entrada do barramento com reverberação (seco + molhado) */
  private salao: GainNode | null = null;
  ativo = true;

  /** Precisa ser chamado dentro de um gesto do usuário (primeiro toque). */
  desbloquear(): void {
    try {
      if (!this.ctx) {
        const C = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!C) return;
        this.ctx = new C();
      }
      if (this.ctx.state === "suspended") void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  private pronto(): AudioContext | null {
    const ctx = this.ctx;
    return this.ativo && ctx && ctx.state === "running" ? ctx : null;
  }

  /** Barramento com reverb (criado na primeira vez): seco 1, molhado ~0,35. */
  private barramento(ctx: AudioContext): AudioNode {
    if (this.salao) return this.salao;
    const entrada = ctx.createGain();
    const mestre = ctx.createGain();
    mestre.gain.value = 0.9;
    // limitador suave: vários sons somados nunca estouram
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10;
    comp.ratio.value = 6;
    comp.attack.value = 0.003;
    comp.release.value = 0.25;
    entrada.connect(mestre);
    try {
      const dur = 2.4;
      const n = Math.floor(ctx.sampleRate * dur);
      const ir = ctx.createBuffer(2, n, ctx.sampleRate);
      for (let c = 0; c < 2; c++) {
        const d = ir.getChannelData(c);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3.2);
      }
      const conv = ctx.createConvolver();
      conv.buffer = ir;
      const molhado = ctx.createGain();
      molhado.gain.value = 0.35;
      entrada.connect(conv).connect(molhado).connect(mestre);
    } catch {
      /* sem reverb */
    }
    mestre.connect(comp).connect(ctx.destination);
    this.salao = entrada;
    return entrada;
  }

  private nota(freq: number, inicio: number, dur: number, volume: number, tipo: OscillatorType = "sine", destino?: AudioNode) {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(freq, inicio);
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.exponentialRampToValueAtTime(volume, inicio + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
    o.connect(g).connect(destino ?? ctx.destination);
    o.start(inicio);
    o.stop(inicio + dur + 0.02);
  }

  /** Ruído branco filtrado com envelope (whoosh, estrondo, cintilar). */
  private ruido(ctx: AudioContext, t: number, dur: number, tipo: BiquadFilterType, f0: number, f1: number, vol: number, ataque: number, destino: AudioNode, q = 1) {
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = tipo;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + ataque);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(destino);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** Sino: parciais inarmônicas (como um sino de metal) com decaimentos diferentes. */
  private sino(freq: number, t: number, vol: number, destino: AudioNode) {
    const parciais: [number, number, number][] = [
      [0.5, 0.35, 2.6], // zumbido grave
      [1, 1, 2.2], // fundamental
      [1.19, 0.45, 1.6], // terça menor (o "tom de sino")
      [1.5, 0.35, 1.3],
      [2, 0.5, 1.1],
      [2.74, 0.28, 0.7],
      [3.76, 0.18, 0.45],
    ];
    for (const [r, a, dur] of parciais) this.nota(freq * r, t, dur, vol * a, "sine", destino);
  }

  /** Nota "de metal" (fanfarra): dente de serra com filtro que abre no ataque e fecha. */
  private metal(freq: number, t: number, dur: number, vol: number, destino: AudioNode) {
    const ctx = this.ctx;
    if (!ctx) return;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 2;
    f.frequency.setValueAtTime(freq * 1.5, t);
    f.frequency.exponentialRampToValueAtTime(freq * 7, t + 0.06);
    f.frequency.exponentialRampToValueAtTime(freq * 3, t + Math.min(dur, 0.5));
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.04);
    g.gain.setValueAtTime(vol * 0.8, t + dur * 0.6);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    f.connect(g).connect(destino);
    for (const det of [-6, 5]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.setValueAtTime(freq, t);
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.05);
    }
  }

  /** Tique do ponteiro passando por um pino (limitado a ~25 por segundo). */
  tique(): void {
    if (!this.ativo || !this.ctx || this.ctx.state !== "running") return;
    const agora = this.ctx.currentTime;
    if (agora - this.ultimoTique < 0.04) return;
    this.ultimoTique = agora;
    try {
      this.nota(1800, agora, 0.035, 0.12, "triangle");
      this.nota(900, agora, 0.05, 0.06, "sine");
    } catch {
      /* ignora */
    }
  }

  /**
   * A roleta se formou. `variante` escolhe o efeito (todos ~1,5–2,5 s, volume moderado):
   * - acorde: whoosh subindo + acorde brilhante (Ré maior com 9ª) + cintilar descendo
   * - sinos: três sinos em arpejo (Ré, Lá, Ré) com brilho agudo
   * - cristal: glissando mágico subindo, ecos e cintilações aleatórias
   * - cosmico: estrondo grave que cai + "swell" de sintetizador abrindo
   * - fanfarra: chamada curta de metais (Sol-Dó-Mi-Sol) e acorde final
   * `forcar` toca mesmo com o som do evento desligado (botão de teste).
   */
  formacao(variante: SomFormacao = "acorde", forcar = false): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running" || (!this.ativo && !forcar)) return;
    try {
      const destino = this.barramento(ctx);
      const t = ctx.currentTime + 0.02;
      if (variante === "sinos") this.somSinos(ctx, t, destino);
      else if (variante === "cristal") this.somCristal(ctx, t, destino);
      else if (variante === "cosmico") this.somCosmico(ctx, t, destino);
      else if (variante === "fanfarra") this.somFanfarra(ctx, t, destino);
      else this.somAcorde(ctx, t, destino);
    } catch {
      /* ignora */
    }
  }

  private somAcorde(ctx: AudioContext, t: number, d: AudioNode) {
    const dur = 0.7;
    this.ruido(ctx, t, dur + 0.15, "bandpass", 300, 5000, 0.16, dur * 0.8, d, 1.2);
    const impacto = t + dur * 0.85;
    for (const f of [293.66, 369.99, 440, 587.33, 659.25]) {
      this.nota(f, impacto, 1.8, 0.045, "sine", d);
      this.nota(f * 1.004, impacto, 1.6, 0.028, "triangle", d);
    }
    [2349.3, 1975.5, 1760, 1480, 1318.5, 1174.7].forEach((f, i) => this.nota(f, impacto + 0.05 + i * 0.06, 0.5, 0.03, "sine", d));
  }

  private somSinos(ctx: AudioContext, t: number, d: AudioNode) {
    this.ruido(ctx, t, 0.35, "highpass", 3000, 9000, 0.05, 0.25, d);
    [587.33, 880, 1174.7].forEach((f, i) => this.sino(f, t + 0.3 + i * 0.16, 0.05, d));
    // brilho agudo final
    [2349.3, 2793.8, 3520].forEach((f, i) => this.nota(f, t + 0.85 + i * 0.05, 0.9, 0.014, "sine", d));
  }

  private somCristal(ctx: AudioContext, t: number, d: AudioNode) {
    // glissando: pentatônica de Lá subindo rápido, duas oitavas
    const escala = [880, 987.77, 1108.7, 1318.5, 1480, 1760, 1975.5, 2217.5, 2637, 2960];
    escala.forEach((f, i) => {
      this.nota(f, t + i * 0.045, 0.7, 0.03, "sine", d);
      this.nota(f * 2, t + i * 0.045, 0.25, 0.008, "triangle", d);
    });
    const topo = t + escala.length * 0.045;
    // acorde "de vidro" que fica soando
    for (const f of [1760, 2217.5, 2637, 3520]) this.nota(f, topo, 1.6, 0.018, "sine", d);
    // cintilações aleatórias depois
    for (let i = 0; i < 9; i++) this.nota(3000 + Math.random() * 3500, topo + 0.08 + Math.random() * 0.9, 0.18, 0.012, "sine", d);
  }

  private somCosmico(ctx: AudioContext, t: number, d: AudioNode) {
    // estrondo: seno grave caindo + ruído grave
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.9);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
    o.connect(g).connect(d);
    o.start(t);
    o.stop(t + 1.25);
    this.ruido(ctx, t, 0.9, "lowpass", 1800, 120, 0.25, 0.01, d);
    // "swell": dente de serra desafinado com filtro abrindo (Ré menor → Ré maior, de leve)
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.Q.value = 4;
    f.frequency.setValueAtTime(200, t + 0.1);
    f.frequency.exponentialRampToValueAtTime(3200, t + 1.1);
    f.frequency.exponentialRampToValueAtTime(900, t + 2.4);
    const gp = ctx.createGain();
    gp.gain.setValueAtTime(0.0001, t + 0.1);
    gp.gain.exponentialRampToValueAtTime(0.05, t + 0.9);
    gp.gain.exponentialRampToValueAtTime(0.0001, t + 2.5);
    f.connect(gp).connect(d);
    for (const fr of [146.83, 220, 293.66, 369.99]) {
      for (const det of [-9, 8]) {
        const s = ctx.createOscillator();
        s.type = "sawtooth";
        s.frequency.value = fr;
        s.detune.value = det;
        s.connect(f);
        s.start(t + 0.1);
        s.stop(t + 2.55);
      }
    }
    this.nota(1174.7, t + 0.9, 1.3, 0.02, "sine", d);
    this.nota(1760, t + 1.0, 1.1, 0.014, "sine", d);
  }

  private somFanfarra(ctx: AudioContext, t: number, d: AudioNode) {
    // Sol3 · Dó4 · Mi4 · Sol4 (curtas) e acorde de Dó maior segurado
    const chamada: [number, number, number][] = [
      [392, 0, 0.14],
      [523.25, 0.15, 0.14],
      [659.25, 0.3, 0.14],
      [783.99, 0.45, 0.32],
    ];
    for (const [f, dt, dur] of chamada) this.metal(f, t + dt, dur, 0.06, d);
    const fim = t + 0.8;
    for (const f of [261.63, 392, 523.25, 659.25, 783.99]) this.metal(f, fim, 1.3, 0.035, d);
    this.ruido(ctx, fim, 0.5, "highpass", 5000, 9000, 0.035, 0.01, d); // prato
    [2093, 2637, 3136].forEach((f, i) => this.nota(f, fim + 0.1 + i * 0.07, 0.6, 0.012, "sine", d));
  }

  /** Brilho da revelação: arpejo ascendente. */
  brilho(): void {
    const ctx = this.pronto();
    if (!ctx) return;
    const t = ctx.currentTime;
    try {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.nota(f, t + i * 0.09, 0.9, 0.09));
      this.nota(2093, t + 0.45, 1.4, 0.04);
    } catch {
      /* ignora */
    }
  }

  toque(): void {
    const ctx = this.pronto();
    if (!ctx) return;
    try {
      this.nota(660, ctx.currentTime, 0.06, 0.05, "sine");
    } catch {
      /* ignora */
    }
  }
}

export const som = new Som();
