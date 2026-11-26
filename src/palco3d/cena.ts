/**
 * Cena 3D da roleta. Herda do slide de referência a MECÂNICA (UI plana que ganha profundidade,
 * câmera viva, partículas instanciadas que formam uma figura, tudo em função do tempo) e
 * deixa de fora o que é pesado (raymarching, pós-processamento, sombras, luzes).
 *
 * Orçamento: ~15 draw calls, < 20k triângulos, sem luzes (Basic/Matcap/shaders simples),
 * DPR ≤ 1,5, brilho por sprites aditivos. O resultado NUNCA é decidido aqui.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CatmullRomCurve3,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  OctahedronGeometry,
  PerspectiveCamera,
  PlaneGeometry,
  Points,
  SRGBColorSpace,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
} from "three";
import { desenharFace } from "@/arte/face";
import { LUZES, familiaCanvasTitulo } from "@/arte/paleta";
import { Fatia, anguloAtual, fatiaSobPonteiro } from "@/core/geometria";
import type { Fase, TotemStore } from "@/core/totem";

const R = 1; // raio da roleta em unidades de cena
const FOV = 30;
const MAX_PINOS = 32;

export interface OpcoesCena {
  leve: boolean;
  obterCelula: () => DOMRect | null;
  aoFalhar: (motivo: string) => void;
}

function gerador(semente: number) {
  let s = semente;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

function texturaCanvas(lado: number, desenhar: (ctx: CanvasRenderingContext2D, l: number) => void): CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = lado;
  const ctx = c.getContext("2d")!;
  desenhar(ctx, lado);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

/** Matcap gerado em canvas: dá aparência metálica sem nenhuma luz na cena. */
function matcap(base: string, luz: string, sombra: string): CanvasTexture {
  return texturaCanvas(128, (ctx, l) => {
    const g = ctx.createRadialGradient(l * 0.36, l * 0.3, l * 0.02, l * 0.5, l * 0.5, l * 0.52);
    g.addColorStop(0, luz);
    g.addColorStop(0.45, base);
    g.addColorStop(1, sombra);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, l, l);
    const r = ctx.createRadialGradient(l * 0.7, l * 0.78, 0, l * 0.7, l * 0.78, l * 0.3);
    r.addColorStop(0, "rgba(140,190,255,0.55)");
    r.addColorStop(1, "rgba(140,190,255,0)");
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, l, l);
  });
}

function texturaBrilho(cor: string): CanvasTexture {
  return texturaCanvas(128, (ctx, l) => {
    const g = ctx.createRadialGradient(l / 2, l / 2, 0, l / 2, l / 2, l / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, cor);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, l, l);
  });
}

/** Estrela de 4 pontas (mesmo desenho do cubo central do 2D). */
function texturaEstrela4(): CanvasTexture {
  return texturaCanvas(128, (ctx, l) => {
    const c = l / 2;
    const halo = ctx.createRadialGradient(c, c, 0, c, c, c);
    halo.addColorStop(0, "rgba(255,230,150,0.55)");
    halo.addColorStop(1, "rgba(255,210,63,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, l, l);
    const g = ctx.createRadialGradient(c, c, 0, c, c, c * 0.8);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(0.35, "#fff4d6");
    g.addColorStop(1, "#ffd23f");
    ctx.fillStyle = g;
    ctx.beginPath();
    const pts: [number, number][] = [[0.5, 0.08], [0.58, 0.42], [0.92, 0.5], [0.58, 0.58], [0.5, 0.92], [0.42, 0.58], [0.08, 0.5], [0.42, 0.42]];
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x * l, y * l) : ctx.moveTo(x * l, y * l)));
    ctx.closePath();
    ctx.fill();
  });
}

const VERT_PONTOS = /* glsl */ `
  attribute float aTam;
  attribute float aFase;
  attribute vec3 aCor;
  uniform float uTempo;
  uniform float uEscala;
  varying vec3 vCor;
  varying float vBrilho;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.6 + 0.4 * sin(uTempo * (0.8 + aFase) + aFase * 40.0);
    vBrilho = tw;
    vCor = aCor;
    gl_PointSize = aTam * uEscala * (0.7 + 0.3 * tw) / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG_PONTOS = /* glsl */ `
  varying vec3 vCor;
  varying float vBrilho;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a = a * a * (0.35 + 0.65 * vBrilho);
    gl_FragColor = vec4(vCor * a, a);
  }
`;

const VERT_FITA = /* glsl */ `
  attribute float aLado;
  attribute float aAo;
  attribute vec3 aCor;
  varying float vLado;
  varying float vAo;
  varying vec3 vCor;
  void main() {
    vLado = aLado;
    vAo = aAo;
    vCor = aCor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_FITA = /* glsl */ `
  uniform float uTempo;
  uniform float uOpacidade;
  varying float vLado;
  varying float vAo;
  varying vec3 vCor;
  void main() {
    float b = 1.0 - abs(vLado);
    float nucleo = pow(b, 8.0) * 1.3 + pow(b, 1.6) * 0.32;
    float onda = 0.65 + 0.35 * sin(vAo * 16.0 - uTempo * 1.1);
    float pontas = smoothstep(0.0, 0.12, vAo) * smoothstep(1.0, 0.85, vAo);
    float a = nucleo * onda * pontas * uOpacidade;
    gl_FragColor = vec4(vCor * a, a);
  }
`;

const VERT_ENXAME = /* glsl */ `
  attribute vec3 aAlvo;
  attribute float aAtraso;
  attribute vec3 aCor;
  uniform float uMix;
  uniform float uTempo;
  uniform float uEscala;
  varying vec3 vCor;
  varying float vM;
  void main() {
    float m = clamp((uMix - aAtraso) / 0.6, 0.0, 1.0);
    m = 1.0 - pow(1.0 - m, 3.0);
    vec3 p = mix(position, aAlvo, m);
    p.xy += 0.018 * vec2(sin(uTempo * 3.0 + aAtraso * 40.0), cos(uTempo * 2.6 + aAtraso * 31.0)) * m;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vCor = aCor;
    vM = m;
    gl_PointSize = (0.03 + 0.075 * m) * uEscala / -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG_ENXAME = /* glsl */ `
  uniform float uAlfa;
  varying vec3 vCor;
  varying float vM;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    a = a * a * uAlfa * (0.25 + 0.75 * vM);
    gl_FragColor = vec4(vCor * a, a);
  }
`;

interface Faisca {
  vida: number;
  pos: Vector3;
  vel: Vector3;
}

export class Cena {
  private renderer: WebGLRenderer;
  private cena = new Scene();
  private camera = new PerspectiveCamera(FOV, 1, 0.1, 200);
  private inclinacao = new Group();
  private disco = new Group();
  private canvasFace = document.createElement("canvas");
  private texturaFace: CanvasTexture;
  private pinos: InstancedMesh;
  private ponteiro: Mesh;
  private estrelas: Points;
  private fitas: Mesh[] = [];
  private enxame: Points;
  private faiscas: Points;
  private poolFaiscas: Faisca[] = [];
  private uniformesComuns = { uTempo: { value: 0 }, uEscala: { value: 400 } };
  private matFita: ShaderMaterial;
  private matEnxame: ShaderMaterial;
  private descartaveis: { dispose: () => void }[] = [];

  private fatias: Fatia[] = [];
  private fase: Fase = "carregando";
  private leve: boolean;
  private quadro = 0;
  private ultimoT = 0;
  private acumulado = 0;
  private indicePonteiro = -2;
  private balanco = 0;
  private inclinacaoAtual = 0;
  private aproximacao = 0;
  private mixEnxame = 0;
  private alfaEnxame = 0;
  private tempoResultado = 0;
  private parallax = { x: 0, y: 0, ax: 0, ay: 0 };
  private amostrasQuadro: number[] = [];
  private inicio = performance.now();
  private avaliado = false;
  private dprAtual = 1;
  private destruido = false;
  private falhou = false;
  private ema = 0;
  private lentoDesde = 0;
  private janelaInicio = 0;
  private chaveFace = "";

  constructor(
    private host: HTMLElement,
    private store: TotemStore,
    private opcoes: OpcoesCena,
  ) {
    this.leve = opcoes.leve;
    this.renderer = new WebGLRenderer({ antialias: !this.leve, alpha: false, stencil: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(new Color("#0a2248"));
    this.dprAtual = Math.min(window.devicePixelRatio || 1, this.leve ? 1 : 1.5);
    this.renderer.setPixelRatio(this.dprAtual);
    this.renderer.domElement.style.width = "100%";
    this.renderer.domElement.style.height = "100%";
    this.renderer.domElement.style.display = "block";
    host.appendChild(this.renderer.domElement);
    this.renderer.domElement.addEventListener("webglcontextlost", this.perdeuContexto, false);

    this.cena.add(this.camera);

    // ---------- céu ----------
    this.estrelas = this.criarEstrelas();
    this.cena.add(this.estrelas);
    this.cena.add(this.criarConstelacoes());
    this.matFita = new ShaderMaterial({
      uniforms: { uTempo: this.uniformesComuns.uTempo, uOpacidade: { value: 1 } },
      vertexShader: VERT_FITA,
      fragmentShader: FRAG_FITA,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.descartaveis.push(this.matFita);
    this.criarFitas();

    // halo atrás da roleta
    const halo = new Mesh(
      new PlaneGeometry(R * 4.2, R * 4.2),
      new MeshBasicMaterial({ map: texturaBrilho("rgba(90,140,255,0.45)"), transparent: true, depthWrite: false, blending: AdditiveBlending }),
    );
    halo.position.z = -0.6;
    this.cena.add(halo);

    // ---------- roleta ----------
    this.cena.add(this.inclinacao);
    this.inclinacao.add(this.disco);

    this.texturaFace = new CanvasTexture(this.canvasFace);
    this.texturaFace.colorSpace = SRGBColorSpace;
    this.texturaFace.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    const face = new Mesh(new CircleGeometry(R, 96), new MeshBasicMaterial({ map: this.texturaFace }));
    face.position.z = 0.001;
    this.disco.add(face);

    const metal = new MeshMatcapMaterial({ matcap: matcap("#8fa3d0", "#ffffff", "#1c2134") });
    const ouro = new MeshMatcapMaterial({ matcap: matcap("#ffcf6b", "#fffbe8", "#7a4a12") });
    const azulEscuro = new MeshMatcapMaterial({ matcap: matcap("#22345f", "#6982b0", "#050a1a") });
    this.descartaveis.push(metal, ouro, azulEscuro);

    const lateral = new Mesh(new CylinderGeometry(R, R * 0.97, 0.14, 96, 1, true), azulEscuro);
    lateral.rotation.x = Math.PI / 2;
    lateral.position.z = -0.07;
    this.inclinacao.add(lateral);
    const fundo = new Mesh(new CircleGeometry(R * 0.97, 64), new MeshBasicMaterial({ color: "#050a1a" }));
    fundo.position.z = -0.14;
    fundo.rotation.y = Math.PI;
    this.inclinacao.add(fundo);

    const aro = new Mesh(new TorusGeometry(R * 1.005, 0.035, 12, 120), metal);
    this.inclinacao.add(aro);

    this.pinos = new InstancedMesh(new SphereGeometry(0.028, 10, 8), ouro, MAX_PINOS);
    this.pinos.count = 0;
    this.disco.add(this.pinos);

    const cubo = new Mesh(new CylinderGeometry(0.16, 0.18, 0.08, 48), azulEscuro);
    cubo.rotation.x = Math.PI / 2;
    cubo.position.z = 0.04;
    this.inclinacao.add(cubo);
    const anelCubo = new Mesh(new TorusGeometry(0.165, 0.012, 8, 64), metal);
    anelCubo.position.z = 0.08;
    this.inclinacao.add(anelCubo);
    const estrelaCentral = new Mesh(
      new PlaneGeometry(0.3, 0.3),
      new MeshBasicMaterial({ map: texturaEstrela4(), transparent: true, depthWrite: false }),
    );
    estrelaCentral.position.z = 0.085;
    this.inclinacao.add(estrelaCentral);

    // brilho especular que NÃO gira (vende o volume)
    const brilho = new Mesh(
      new CircleGeometry(R, 64),
      new MeshBasicMaterial({
        map: texturaCanvas(256, (ctx, l) => {
          const g = ctx.createRadialGradient(l * 0.34, l * 0.22, 0, l * 0.34, l * 0.22, l * 0.55);
          g.addColorStop(0, "rgba(255,255,255,0.22)");
          g.addColorStop(1, "rgba(255,255,255,0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, 0, l, l);
        }),
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    brilho.position.z = 0.012;
    this.inclinacao.add(brilho);

    // ponteiro de cristal às 12h, no plano da roleta
    this.ponteiro = new Mesh(new OctahedronGeometry(0.1, 0), metal);
    this.ponteiro.scale.set(0.75, 1.5, 0.55);
    this.ponteiro.geometry.translate(0, -0.08, 0);
    this.ponteiro.position.set(0, R * 1.1, 0.1);
    this.inclinacao.add(this.ponteiro);

    // ---------- revelação: estrelas que formam uma estrela ----------
    this.matEnxame = new ShaderMaterial({
      uniforms: { uMix: { value: 0 }, uTempo: this.uniformesComuns.uTempo, uEscala: this.uniformesComuns.uEscala, uAlfa: { value: 0 } },
      vertexShader: VERT_ENXAME,
      fragmentShader: FRAG_ENXAME,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.descartaveis.push(this.matEnxame);
    this.enxame = this.criarEnxame(this.leve ? 500 : 1100);
    this.enxame.visible = false;
    this.cena.add(this.enxame);

    this.faiscas = this.criarFaiscas(160);
    this.cena.add(this.faiscas);

    this.redimensionar();
    window.addEventListener("resize", this.redimensionar);
    window.addEventListener("pointermove", this.moverPonteiro, { passive: true });
    window.addEventListener("pointerdown", this.tocarFundo, { passive: true });
    document.fonts?.ready.then(() => !this.destruido && this.redesenharFace());

    // pré-compila os shaders antes do primeiro giro; falha de shader = volta para o 2D
    this.renderer.debug.onShaderError = () => this.falhar("falha ao compilar shader");
    this.renderer.compile(this.cena, this.camera);
    this.quadro = requestAnimationFrame(this.passo);
  }

  // ---------- construção ----------
  private criarEstrelas(): Points {
    const n = this.leve ? 900 : 1800;
    const rnd = gerador(11);
    const pos = new Float32Array(n * 3);
    const tam = new Float32Array(n);
    const fase = new Float32Array(n);
    const cor = new Float32Array(n * 3);
    const c = new Color();
    for (let i = 0; i < n; i++) {
      const z = -3 - rnd() * 30;
      const alcance = 0.6 + (-z) * 0.62;
      pos[i * 3] = (rnd() - 0.5) * alcance * 3.2;
      pos[i * 3 + 1] = (rnd() - 0.5) * alcance * 2.2;
      pos[i * 3 + 2] = z;
      tam[i] = rnd() < 0.94 ? 0.04 + rnd() * 0.06 : 0.14 + rnd() * 0.16;
      fase[i] = rnd();
      c.set(rnd() < 0.12 ? "#ffd59a" : rnd() < 0.3 ? "#a9c8ff" : "#ffffff");
      cor.set([c.r, c.g, c.b], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aTam", new BufferAttribute(tam, 1));
    g.setAttribute("aFase", new BufferAttribute(fase, 1));
    g.setAttribute("aCor", new BufferAttribute(cor, 3));
    const m = new ShaderMaterial({
      uniforms: this.uniformesComuns,
      vertexShader: VERT_PONTOS,
      fragmentShader: FRAG_PONTOS,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.descartaveis.push(g, m);
    return new Points(g, m);
  }

  private criarConstelacoes(): Group {
    const rnd = gerador(29);
    const grupo = new Group();
    const linhas: number[] = [];
    const nos: number[] = [];
    const centros = [
      [-3.2, 1.6, -6], [3.4, 1.9, -7], [-3.6, -1.7, -6.5], [3.1, -1.8, -6], [0.4, 2.6, -9],
    ];
    for (const [cx, cy, cz] of centros) {
      let ant: number[] | null = null;
      const q = 4 + Math.floor(rnd() * 3);
      for (let k = 0; k < q; k++) {
        const p = [cx + (rnd() - 0.5) * 2.2, cy + (rnd() - 0.5) * 1.6, cz + (rnd() - 0.5)];
        nos.push(...p);
        if (ant) linhas.push(...ant, ...p);
        ant = p;
      }
    }
    const gl = new BufferGeometry();
    gl.setAttribute("position", new BufferAttribute(new Float32Array(linhas), 3));
    const ml = new LineBasicMaterial({ color: "#a9bbea", transparent: true, opacity: 0.28, depthWrite: false });
    grupo.add(new LineSegments(gl, ml));
    const n = nos.length / 3;
    const gn = new BufferGeometry();
    gn.setAttribute("position", new BufferAttribute(new Float32Array(nos), 3));
    const tam = new Float32Array(n).map((_, i) => 0.35 + (i % 3) * 0.12);
    const fase = new Float32Array(n).map(() => rnd());
    const cor = new Float32Array(n * 3);
    const c = new Color();
    for (let i = 0; i < n; i++) {
      c.set(LUZES[i % LUZES.length]).lerp(new Color("#ffffff"), 0.45);
      cor.set([c.r, c.g, c.b], i * 3);
    }
    gn.setAttribute("aTam", new BufferAttribute(tam, 1));
    gn.setAttribute("aFase", new BufferAttribute(fase, 1));
    gn.setAttribute("aCor", new BufferAttribute(cor, 3));
    const mn = new ShaderMaterial({
      uniforms: this.uniformesComuns,
      vertexShader: VERT_PONTOS,
      fragmentShader: FRAG_PONTOS,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    grupo.add(new Points(gn, mn));
    this.descartaveis.push(gl, ml, gn, mn);
    return grupo;
  }

  /** Fitas luminosas da capa: faixas ao longo de curvas, brilho no shader (sem bloom). */
  private criarFitas(): void {
    const defs: { pts: [number, number, number][]; cores: [string, string]; largura: number }[] = [
      { pts: [[-6, 1.4, -4], [-2.5, 3.6, -5], [0.5, 1.2, -3.5], [3, 3.2, -5], [6.5, 1.8, -4]], cores: [LUZES[0], LUZES[2]], largura: 0.3 },
      { pts: [[-6.5, 3.2, -5], [-3, 0.9, -4], [0.8, 2.8, -6], [4, 0.9, -4], [7, 2.6, -5]], cores: [LUZES[1], LUZES[4]], largura: 0.26 },
      { pts: [[-6.5, -2.4, -4], [-3, -0.8, -5], [0, -2.9, -3.8], [3.5, -1.2, -5], [6.5, -2.8, -4]], cores: [LUZES[0], LUZES[1]], largura: 0.28 },
      { pts: [[-6, -3.4, -5], [-2, -1.4, -6], [1.5, -3.2, -4.5], [4.5, -1.6, -5.5], [7, -3.6, -5]], cores: [LUZES[2], LUZES[5]], largura: 0.22 },
    ];
    if (this.leve) defs.splice(2, 1);
    defs.forEach((d, idx) => {
      const curva = new CatmullRomCurve3(d.pts.map(([x, y, z]) => new Vector3(x, y, z)));
      const n = 140;
      const pos = new Float32Array(n * 2 * 3);
      const lado = new Float32Array(n * 2);
      const ao = new Float32Array(n * 2);
      const cor = new Float32Array(n * 2 * 3);
      const ca = new Color(d.cores[0]);
      const cb = new Color(d.cores[1]);
      const c = new Color();
      const frente = new Vector3(0, 0, 1);
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const p = curva.getPointAt(t);
        const tan = curva.getTangentAt(t);
        const s = new Vector3().crossVectors(tan, frente).normalize();
        const w = d.largura * (0.45 + 0.55 * Math.abs(Math.sin(t * Math.PI * 2.4 + idx)));
        c.copy(ca).lerp(cb, t);
        for (let k = 0; k < 2; k++) {
          const sinal = k === 0 ? -1 : 1;
          const j = i * 2 + k;
          pos.set([p.x + s.x * w * sinal, p.y + s.y * w * sinal, p.z + s.z * w * sinal], j * 3);
          lado[j] = sinal;
          ao[j] = t;
          cor.set([c.r, c.g, c.b], j * 3);
        }
      }
      const indices: number[] = [];
      for (let i = 0; i < n - 1; i++) {
        const a = i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
      const g = new BufferGeometry();
      g.setAttribute("position", new BufferAttribute(pos, 3));
      g.setAttribute("aLado", new BufferAttribute(lado, 1));
      g.setAttribute("aAo", new BufferAttribute(ao, 1));
      g.setAttribute("aCor", new BufferAttribute(cor, 3));
      g.setIndex(indices);
      this.descartaveis.push(g);
      const m = new Mesh(g, this.matFita);
      this.fitas.push(m);
      this.cena.add(m);
    });
  }

  /** Partículas que voam e formam uma estrela de 5 pontas na revelação (1 draw call). */
  private criarEnxame(n: number): Points {
    const rnd = gerador(7);
    const pos = new Float32Array(n * 3);
    const alvo = new Float32Array(n * 3);
    const atraso = new Float32Array(n);
    const cor = new Float32Array(n * 3);
    const vertices: [number, number][] = [];
    for (let k = 0; k < 10; k++) {
      const r = k % 2 === 0 ? 0.95 : 0.4;
      const a = (k / 10) * Math.PI * 2;
      vertices.push([Math.sin(a) * r, Math.cos(a) * r]);
    }
    const c = new Color();
    for (let i = 0; i < n; i++) {
      // origem: espalhado numa casca ao redor
      const th = rnd() * Math.PI * 2;
      const ph = Math.acos(2 * rnd() - 1);
      const rr = 3 + rnd() * 4;
      pos.set([Math.sin(ph) * Math.cos(th) * rr, Math.sin(ph) * Math.sin(th) * rr * 0.7, Math.cos(ph) * rr - 2], i * 3);
      // alvo: contorno da estrela (80%) + preenchimento (20%)
      const k = Math.floor(rnd() * 10);
      const [x0, y0] = vertices[k];
      const [x1, y1] = vertices[(k + 1) % 10];
      const t = rnd();
      let x = x0 + (x1 - x0) * t;
      let y = y0 + (y1 - y0) * t;
      if (rnd() < 0.2) {
        const f = Math.sqrt(rnd());
        x *= f;
        y *= f;
      }
      alvo.set([x * R * 0.72, y * R * 0.72, 0.55 + (rnd() - 0.5) * 0.05], i * 3);
      atraso[i] = rnd() * 0.4;
      c.set(rnd() < 0.6 ? "#ffd23f" : rnd() < 0.5 ? "#fff4d6" : LUZES[Math.floor(rnd() * LUZES.length)]);
      cor.set([c.r, c.g, c.b], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aAlvo", new BufferAttribute(alvo, 3));
    g.setAttribute("aAtraso", new BufferAttribute(atraso, 1));
    g.setAttribute("aCor", new BufferAttribute(cor, 3));
    this.descartaveis.push(g);
    const p = new Points(g, this.matEnxame);
    p.frustumCulled = false;
    return p;
  }

  /** Faíscas ao tocar o céu: pool fixo, atualização na CPU só das vivas. */
  private criarFaiscas(n: number): Points {
    const pos = new Float32Array(n * 3).fill(9999);
    const tam = new Float32Array(n).fill(0.12);
    const fase = new Float32Array(n).map((_, i) => (i * 0.137) % 1);
    const cor = new Float32Array(n * 3);
    const c = new Color();
    for (let i = 0; i < n; i++) {
      c.set(LUZES[i % LUZES.length]).lerp(new Color("#ffffff"), 0.35);
      cor.set([c.r, c.g, c.b], i * 3);
      this.poolFaiscas.push({ vida: 0, pos: new Vector3(9999, 9999, 9999), vel: new Vector3() });
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aTam", new BufferAttribute(tam, 1));
    g.setAttribute("aFase", new BufferAttribute(fase, 1));
    g.setAttribute("aCor", new BufferAttribute(cor, 3));
    const m = new ShaderMaterial({
      uniforms: this.uniformesComuns,
      vertexShader: VERT_PONTOS,
      fragmentShader: FRAG_PONTOS,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.descartaveis.push(g, m);
    const p = new Points(g, m);
    p.frustumCulled = false;
    return p;
  }

  // ---------- API ----------
  definirFatias(fatias: Fatia[]): void {
    this.fatias = fatias;
    this.indicePonteiro = -2;
    const chave = fatias.map((f) => `${f.id}|${f.rotulo}|${f.largura.toFixed(6)}`).join(";");
    if (chave !== this.chaveFace) {
      this.chaveFace = chave;
      this.redesenharFace();
    }
    const m = new Matrix4();
    const n = Math.min(fatias.length > 1 ? fatias.length : 0, MAX_PINOS);
    for (let i = 0; i < n; i++) {
      const phi = fatias[i].inicio;
      m.makeTranslation(Math.sin(phi) * R * 0.975, Math.cos(phi) * R * 0.975, 0.03);
      this.pinos.setMatrixAt(i, m);
    }
    this.pinos.count = n;
    this.pinos.instanceMatrix.needsUpdate = true;
  }

  definirFase(fase: Fase): void {
    if (fase === "resultado" && this.fase !== "resultado") {
      this.tempoResultado = performance.now();
      this.enxame.visible = true;
    }
    this.fase = fase;
  }

  destruir(): void {
    this.destruido = true;
    cancelAnimationFrame(this.quadro);
    window.removeEventListener("resize", this.redimensionar);
    window.removeEventListener("pointermove", this.moverPonteiro);
    window.removeEventListener("pointerdown", this.tocarFundo);
    this.renderer.domElement.removeEventListener("webglcontextlost", this.perdeuContexto);
    this.cena.traverse((o) => {
      const malha = o as Mesh;
      malha.geometry?.dispose?.();
      const mat = malha.material as { dispose?: () => void; map?: { dispose: () => void }; matcap?: { dispose: () => void } } | undefined;
      mat?.map?.dispose();
      mat?.matcap?.dispose();
      mat?.dispose?.();
    });
    this.descartaveis.forEach((d) => d.dispose());
    this.texturaFace.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------- internos ----------
  private redesenharFace = () => {
    desenharFace(this.canvasFace, this.fatias, this.leve ? 768 : 1024);
    this.texturaFace.needsUpdate = true;
    // Se a fonte do título ainda não carregou, redesenha uma vez quando ela chegar.
    const fonte = `600 40px ${familiaCanvasTitulo()}`;
    if (this.fatias.length && document.fonts && !document.fonts.check(fonte)) {
      document.fonts
        .load(fonte)
        .then(() => !this.destruido && document.fonts.check(fonte) && this.redesenharFace())
        .catch(() => {});
    }
  };

  private perdeuContexto = (e: Event) => {
    e.preventDefault();
    this.falhar("o contexto WebGL foi perdido");
  };

  private redimensionar = () => {
    const w = this.host.clientWidth || window.innerWidth;
    const h = this.host.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.uniformesComuns.uEscala.value = h * this.dprAtual * 0.9;
  };

  private moverPonteiro = (e: PointerEvent) => {
    this.parallax.ax = (e.clientX / window.innerWidth - 0.5) * 2;
    this.parallax.ay = (e.clientY / window.innerHeight - 0.5) * 2;
  };

  /** Tocar o céu (fora da roleta e do painel) solta faíscas. */
  private tocarFundo = (e: PointerEvent) => {
    const alvo = e.target as HTMLElement | null;
    if (alvo?.closest("section, button, aside, [data-roleta], [data-ui], [role=dialog]")) return;
    const v = new Vector3((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1, 0.5);
    v.unproject(this.camera);
    const dir = v.sub(this.camera.position).normalize();
    const dist = (-2 - this.camera.position.z) / dir.z;
    const ponto = this.camera.position.clone().add(dir.multiplyScalar(dist));
    let emitidas = 0;
    for (const f of this.poolFaiscas) {
      if (f.vida > 0) continue;
      f.vida = 1;
      f.pos.copy(ponto);
      const a = Math.random() * Math.PI * 2; // cosmético
      const vel = 0.6 + Math.random() * 1.6;
      f.vel.set(Math.cos(a) * vel, Math.sin(a) * vel, (Math.random() - 0.5) * 0.5);
      if (++emitidas >= 28) break;
    }
  };

  private atualizarCamera(dt: number, t: number) {
    const cel = this.opcoes.obterCelula();
    const W = window.innerWidth;
    const H = window.innerHeight;
    let cx = W / 2;
    let cy = H / 2;
    let raio = Math.min(W, H) * 0.35;
    if (cel && cel.width > 0) {
      cx = cel.left + cel.width / 2;
      cy = cel.top + cel.height / 2;
      raio = cel.width / 2;
    }
    const ativo = this.fase === "pronto" || this.fase === "girando" || this.fase === "resultado";
    const alvoInclinacao = ativo ? -0.42 : -0.06;
    const k = 1 - Math.exp(-dt * 2.2);
    this.inclinacaoAtual += (alvoInclinacao - this.inclinacaoAtual) * k;
    this.inclinacao.rotation.x = this.inclinacaoAtual;
    const alvoAprox = this.fase === "resultado" ? 1 : 0;
    this.aproximacao += (alvoAprox - this.aproximacao) * (1 - Math.exp(-dt * 1.5));

    // parallax amortecido + deriva senoidal (câmera nunca parada)
    const p = this.parallax;
    const kp = 1 - Math.exp(-dt * 2);
    p.x += (p.ax - p.x) * kp;
    p.y += (p.ay - p.y) * kp;
    const giroFinal = this.fase === "girando" || this.fase === "resultado";
    const amplitude = this.leve ? 0 : giroFinal ? 0.25 : 1;
    const az = (Math.sin(t * 0.21) * 0.05 + p.x * 0.07) * amplitude;
    const el = (0.06 + Math.sin(t * 0.17) * 0.025 + p.y * 0.04) * amplitude + (ativo ? 0.05 : 0);

    const tanMeio = Math.tan(((FOV / 2) * Math.PI) / 180);
    const dist = ((R * 1.12 * H) / (2 * raio * tanMeio)) * (1 - 0.08 * this.aproximacao);
    this.camera.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    this.camera.lookAt(0, 0, 0);
    // desloca a projeção para a roleta cair exatamente na célula do layout
    this.camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    this.camera.updateProjectionMatrix();
  }

  private atualizarFaiscas(dt: number) {
    const attr = this.faiscas.geometry.getAttribute("position") as BufferAttribute;
    let mudou = false;
    this.poolFaiscas.forEach((f, i) => {
      if (f.vida <= 0) return;
      f.vida -= dt * 0.9;
      f.vel.multiplyScalar(1 - dt * 1.8);
      f.pos.addScaledVector(f.vel, dt);
      if (f.vida <= 0) f.pos.set(9999, 9999, 9999);
      attr.setXYZ(i, f.pos.x, f.pos.y, f.pos.z);
      mudou = true;
    });
    if (mudou) attr.needsUpdate = true;
  }

  private falhar(motivo: string) {
    if (this.falhou) return;
    this.falhou = true;
    this.opcoes.aoFalhar(motivo);
  }

  /**
   * Avaliação inicial (por tempo, normalizada pelo vsync da tela) + monitor contínuo.
   * Só rebaixa; troca para o 2D fora do giro (o estado vive no TotemStore, nada se perde).
   */
  private avaliarDesempenho(dtMs: number, agora: number) {
    if (agora - this.inicio < 1500) return;
    this.ema = this.ema ? this.ema * 0.95 + dtMs * 0.05 : dtMs;
    if (this.ema > 45) {
      if (!this.lentoDesde) this.lentoDesde = agora;
      else if (agora - this.lentoDesde > 3000 && this.fase !== "girando") {
        this.falhar(`desempenho insuficiente (≈${this.ema.toFixed(0)} ms por quadro)`);
        return;
      }
    } else this.lentoDesde = 0;

    if (this.avaliado) return;
    if (!this.janelaInicio) this.janelaInicio = agora;
    this.amostrasQuadro.push(dtMs);
    const n = this.amostrasQuadro.length;
    const ord = [...this.amostrasQuadro].sort((a, b) => a - b);
    const mediana = ord[Math.floor(n / 2)];
    if (n >= 15 && mediana > 60) {
      this.falhar(`desempenho insuficiente (${mediana.toFixed(0)} ms por quadro)`);
      return;
    }
    if (agora - this.janelaInicio < 2000 && n < 90) return;
    const periodo = Math.max(6, ord[Math.floor(n * 0.1)]); // ~16,7 ms em 60 Hz; ~33 ms em 30 Hz
    const limiteFalha = Math.max(34, periodo * 2.2);
    const limiteReduz = Math.max(21, periodo * 1.4);
    this.amostrasQuadro = [];
    this.janelaInicio = 0;
    if (mediana > limiteFalha) {
      this.falhar(`desempenho insuficiente (${mediana.toFixed(0)} ms por quadro)`);
    } else if (mediana > limiteReduz && this.dprAtual > 0.75) {
      this.dprAtual = this.dprAtual > 1 ? 1 : 0.75;
      this.renderer.setPixelRatio(this.dprAtual);
      this.redimensionar();
    } else {
      this.avaliado = true;
    }
  }

  private passo = (agora: number) => {
    if (this.destruido || this.falhou) return;
    this.quadro = requestAnimationFrame(this.passo);
    try {
      this.desenharQuadro(agora);
    } catch (e) {
      cancelAnimationFrame(this.quadro);
      this.falhar(e instanceof Error ? e.message : "erro no laço 3D");
    }
  };

  private desenharQuadro(agora: number) {
    const dtBruto = this.ultimoT ? Math.min(100, agora - this.ultimoT) : 16;
    this.ultimoT = agora;

    // no modo leve, ocioso a ~30 fps (o tempo pulado entra no dt para as animações não ficarem lentas)
    const ocioso = this.fase === "atracao" || this.fase === "esgotado" || this.fase === "semEvento";
    this.acumulado += dtBruto;
    if (this.leve && ocioso && this.acumulado < 32) return;
    const dtMs = Math.min(100, this.acumulado);
    this.acumulado = 0;
    const dt = dtMs / 1000;
    const t = (agora - this.inicio) / 1000;
    this.uniformesComuns.uTempo.value = t;

    // rotação vem da máquina de estados; aqui só desenhamos
    const theta = anguloAtual(this.store.rotacao, agora);
    this.disco.rotation.z = -theta;
    const i = fatiaSobPonteiro(this.fatias, theta);
    if (i !== this.indicePonteiro) {
      if (this.indicePonteiro !== -2 && this.store.rotacao.tipo !== "ocioso") {
        this.balanco = 1;
        this.store.emitirTique();
      }
      this.indicePonteiro = i;
    }
    this.balanco *= Math.exp(-dt * 9);
    this.ponteiro.rotation.z = 0.35 * this.balanco;

    // revelação
    if (this.fase === "resultado") {
      const tr = (agora - this.tempoResultado) / 1000;
      this.mixEnxame = Math.min(1.4, tr / 1.4);
      this.alfaEnxame = Math.min(1, tr * 2);
    } else {
      this.mixEnxame = Math.max(0, this.mixEnxame - dt * 0.9);
      this.alfaEnxame = Math.max(0, this.alfaEnxame - dt * 1.2);
      if (this.alfaEnxame <= 0) this.enxame.visible = false;
    }
    this.matEnxame.uniforms.uMix.value = this.mixEnxame;
    this.matEnxame.uniforms.uAlfa.value = this.alfaEnxame;

    for (const f of this.fitas) f.rotation.z = Math.sin(t * 0.05) * 0.01;
    this.atualizarFaiscas(dt);
    this.atualizarCamera(dt, t);
    this.renderer.render(this.cena, this.camera);
    this.avaliarDesempenho(dtMs, agora);
  }
}