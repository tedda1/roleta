/**
 * Som sintetizado com WebAudio (sem arquivos). Falhas de áudio nunca bloqueiam o fluxo.
 */
class Som {
  private ctx: AudioContext | null = null;
  private ultimoTique = 0;
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

  private nota(freq: number, inicio: number, dur: number, volume: number, tipo: OscillatorType = "sine") {
    const ctx = this.ctx;
    if (!ctx) return;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = tipo;
    o.frequency.setValueAtTime(freq, inicio);
    g.gain.setValueAtTime(0.0001, inicio);
    g.gain.exponentialRampToValueAtTime(volume, inicio + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, inicio + dur);
    o.connect(g).connect(ctx.destination);
    o.start(inicio);
    o.stop(inicio + dur + 0.02);
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
   * A roleta se formou: "whoosh" de ar subindo, acorde brilhante (Ré maior com 9ª, levemente
   * desafinado para soar cheio) e um cintilar agudo descendo. ~2 s, volume moderado.
   */
  formacao(): void {
    const ctx = this.ctx;
    if (!this.ativo || !ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    try {
      // whoosh: ruído filtrado com o filtro subindo
      const dur = 0.7;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const dados = buf.getChannelData(0);
      for (let i = 0; i < dados.length; i++) dados[i] = Math.random() * 2 - 1;
      const ruido = ctx.createBufferSource();
      ruido.buffer = buf;
      const filtro = ctx.createBiquadFilter();
      filtro.type = "bandpass";
      filtro.Q.value = 1.2;
      filtro.frequency.setValueAtTime(300, t);
      filtro.frequency.exponentialRampToValueAtTime(5000, t + dur);
      const gR = ctx.createGain();
      gR.gain.setValueAtTime(0.0001, t);
      gR.gain.exponentialRampToValueAtTime(0.18, t + dur * 0.8);
      gR.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.15);
      ruido.connect(filtro).connect(gR).connect(ctx.destination);
      ruido.start(t);
      ruido.stop(t + dur + 0.2);

      // acorde no impacto (Ré maior com 9ª), duas vozes levemente desafinadas por nota
      const impacto = t + dur * 0.85;
      for (const f of [293.66, 369.99, 440, 587.33, 659.25]) {
        this.nota(f, impacto, 1.8, 0.05, "sine");
        this.nota(f * 1.004, impacto, 1.6, 0.03, "triangle");
      }
      // cintilar: notas agudas rápidas descendo
      [2349.3, 1975.5, 1760, 1480, 1318.5, 1174.7].forEach((f, i) => this.nota(f, impacto + 0.05 + i * 0.06, 0.5, 0.035));
    } catch {
      /* ignora */
    }
  }

  /** Brilho da revelação: arpejo ascendente. */
  brilho(): void {
    if (!this.ativo || !this.ctx || this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    try {
      [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.nota(f, t + i * 0.09, 0.9, 0.09));
      this.nota(2093, t + 0.45, 1.4, 0.04);
    } catch {
      /* ignora */
    }
  }

  toque(): void {
    if (!this.ativo || !this.ctx || this.ctx.state !== "running") return;
    try {
      this.nota(660, this.ctx.currentTime, 0.06, 0.05, "sine");
    } catch {
      /* ignora */
    }
  }
}

export const som = new Som();
