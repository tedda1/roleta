/**
 * Cena 3D da roleta. Herda do slide de referência a MECÂNICA (UI plana que ganha profundidade,
 * câmera viva, partículas instanciadas que formam uma figura, tudo em função do tempo) e
 * deixa de fora o que é pesado (raymarching, pós-processamento, sombras, luzes).
 *
 * Orçamento: ~16 draw calls, < 20k triângulos, sem luzes (Basic/Matcap/shaders simples),
 * DPR ≤ 1,5, brilho por sprites aditivos. O resultado NUNCA é decidido aqui.
 *
 * Chegada (CPF confirmado): o painel de CPF "vira" centenas de folhas 3:2 que voam em
 * perspectiva e pousam sobre o disco com a cor de cada fatia (eco das folhas que formam
 * "Better." no slide); a face real aparece por baixo, aro/cubo/pinos crescem, o ponteiro cai
 * e a câmera faz um mergulho até o enquadramento final. Sem roleta (atração/CPF), nada dela
 * é desenhado.
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
  InstancedBufferAttribute,
  InstancedBufferGeometry,
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
import { corLuz, desenharFace } from "@/arte/face";
import { BASES_FATIA, LUZES, PALETA, familiaCanvasTitulo } from "@/arte/paleta";
import { Fatia, TAU, anguloAtual, fatiaSobPonteiro, modPositivo } from "@/core/geometria";
import type { Fase, TotemStore } from "@/core/totem";

const R = 1; // raio da roleta em unidades de cena
const FOV = 30;
const MAX_PINOS = 32;

/** Fases em que a roleta existe na tela; nas demais o participante só vê o CPF. */
const FASES_COM_ROLETA: ReadonlySet<Fase> = new Set<Fase>(["pronto", "girando", "resultado"]);
const DUR_SAIDA = 0.8; // s
const DUR_APRESSADA = 0.35; // s que sobram da chegada quando o giro começa no meio dela
const INCLINACAO_DEITADA = -1.22; // disco quase deitado no início do mergulho da câmera
const LARGURA_FOLHA_600 = 0.092; // largura da folha (3:2) com 600 folhas; escala com √(600/n)
const DUR_VOO = 0.42; // fração da chegada que cada folha leva no ar

type ModoRevelacao = "oculta" | "chegando" | "visivel" | "saindo";

// ---------- easing (tudo em função do tempo) ----------
const saturar = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const faixa = (x: number, a: number, b: number) => saturar((x - a) / (b - a));
function suave(x: number, a: number, b: number): number {
  const k = faixa(x, a, b);
  return k * k * (3 - 2 * k);
}
const inOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const C1 = 1.70158;
const C3 = C1 + 1;
const outBack = (k: number) => 1 + C3 * (k - 1) ** 3 + C1 * (k - 1) ** 2;
const inBack = (k: number) => C3 * k ** 3 - C1 * k ** 2;
function outBounce(k: number): number {
  const n1 = 7.5625;
  const d1 = 2.75;
  if (k < 1 / d1) return n1 * k * k;
  if (k < 2 / d1) {
    const x = k - 1.5 / d1;
    return n1 * x * x + 0.75;
  }
  if (k < 2.5 / d1) {
    const x = k - 2.25 / d1;
    return n1 * x * x + 0.9375;
  }
  const x = k - 2.625 / d1;
  return n1 * x * x + 0.984375;
}

/** Mesma regra de corBase em arte/face.ts (lá não é exportada): base escura da fatia i. */
function corBaseFatia(i: number, n: number): string {
  let c = i % BASES_FATIA.length;
  if (n > 1 && i === n - 1 && c === 0) c = 2;
  return BASES_FATIA[c];
}

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

/**
 * Folhas da chegada. A origem fica no espaço da CÂMERA (presa à tela, onde estava o painel de
 * CPF) e o alvo no espaço local do DISCO (gira com a roleta e acompanha o mergulho da câmera).
 * A interpolação acontece no espaço da câmera, então o mesmo quad sai "de frente" e pousa
 * deitado no disco, com o lado maior na tangente.
 */
const VERT_FOLHAS = /* glsl */ `
  attribute vec3 aOrigem;
  attribute vec3 aAlvo;
  attribute float aAtraso;
  attribute vec4 aGiro;
  attribute vec3 aCor;
  attribute float aArco;
  uniform mat4 uMatrizDisco;
  uniform float uProg;
  uniform float uDurVoo;
  uniform float uEscalaOrigem;
  varying vec3 vCor;
  varying vec2 vUv;
  varying float vLuz;
  varying float vM;
  vec3 girar(vec3 v, vec3 e, float a) {
    float c = cos(a);
    float s = sin(a);
    return v * c + cross(e, v) * s + e * dot(e, v) * (1.0 - c);
  }
  void main() {
    float m = clamp((uProg - aAtraso) / uDurVoo, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - m, 3.0);
    mat4 mvDisco = viewMatrix * uMatrizDisco;
    float ang = atan(aAlvo.x, aAlvo.y);
    float ca = cos(ang);
    float sa = sin(ang);
    vec2 local = vec2(position.x * ca + position.y * sa, -position.x * sa + position.y * ca);
    vec3 centroAlvo = (mvDisco * vec4(aAlvo, 1.0)).xyz;
    vec3 cantoAlvo = (mvDisco * vec4(local, 0.0, 0.0)).xyz;
    vec3 normalAlvo = normalize((mvDisco * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
    float arco = sin(3.14159265 * e);
    vec3 centro = mix(aOrigem, centroAlvo, e);
    centro.z += arco * aArco;
    centro.xy += arco * aArco * 0.18 * vec2(aGiro.y, -aGiro.x);
    // zero na decolagem e no pouso: a folha sai "de frente" (como o cartão) e pousa deitada
    float giro = aGiro.w * sin(3.14159265 * e);
    vec3 canto = girar(mix(position * uEscalaOrigem, cantoAlvo, e), aGiro.xyz, giro);
    vec3 n = girar(normalize(mix(vec3(0.0, 0.0, 1.0), normalAlvo, e) + vec3(0.0, 0.0, 1e-3)), aGiro.xyz, giro);
    vLuz = abs(n.z);
    vCor = aCor;
    vUv = uv;
    vM = m;
    gl_Position = projectionMatrix * vec4(centro + canto, 1.0);
  }
`;

const FRAG_FOLHAS = /* glsl */ `
  uniform float uAlfa;
  uniform float uSumir;
  varying vec3 vCor;
  varying vec2 vUv;
  varying float vLuz;
  varying float vM;
  void main() {
    vec2 b = min(vUv, 1.0 - vUv);
    float borda = 1.0 - smoothstep(0.0, 0.08, min(b.x, b.y / 1.5));
    float reflexo = pow(vLuz, 10.0) * (1.0 - vM);
    vec3 cor = vCor * (0.45 + 0.65 * vLuz) + vec3(0.85, 0.92, 1.0) * (borda * 0.28 + reflexo * 0.45);
    float a = uAlfa * (1.0 - uSumir * vM) * 0.95;
    gl_FragColor = vec4(cor, a);
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

  // peças da roleta animadas na chegada/saída
  private halo: Mesh;
  private matHalo: MeshBasicMaterial;
  private face: Mesh;
  private matFace: MeshBasicMaterial;
  private lateral: Mesh;
  private fundo: Mesh;
  private aro: Mesh;
  private cubo: Mesh;
  private anelCubo: Mesh;
  private estrelaCentral: Mesh;
  private brilho: Mesh;
  private matBrilho: MeshBasicMaterial;
  private matrizPino = new Matrix4();

  // folhas da chegada (1 draw call)
  private folhas: Mesh;
  private matFolhas: ShaderMaterial;
  private nFolhas: number;
  private larguraFolha: number;
  private ordemFolhas: Uint16Array;
  private chaveFolhas: Float32Array;
  private rndFolhas = gerador(97);
  private corTmp = new Color();
  private corTmp2 = new Color();
  private vTmp = new Vector3();

  // revelação da roleta: 0 = só a tela de CPF, 1 = roleta inteira no lugar
  private modoRevelacao: ModoRevelacao = "oculta";
  private revelacao = 0;
  private tRevelacao = 0;
  private durChegada: number;
  private fatorChegada = 1;
  private rSaida = 1;
  private brilhoSaidaEmitido = false;
  private reavaliado = false;
  private folhasPendentes = false;
  /** 1 = câmera no início do mergulho (longe, alta), 0 = enquadramento normal. */
  private afastamento = 0;
  private distBase = 7;
  private primeiraFase = true;

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
    this.durChegada = this.leve ? 1.8 : 2.6;
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
    this.matHalo = new MeshBasicMaterial({ map: texturaBrilho("rgba(90,140,255,0.45)"), transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.halo = new Mesh(new PlaneGeometry(R * 4.2, R * 4.2), this.matHalo);
    this.halo.position.z = -0.6;
    this.cena.add(this.halo);

    // ---------- roleta ----------
    this.cena.add(this.inclinacao);
    this.inclinacao.add(this.disco);

    this.texturaFace = new CanvasTexture(this.canvasFace);
    this.texturaFace.colorSpace = SRGBColorSpace;
    this.texturaFace.anisotropy = Math.min(4, this.renderer.capabilities.getMaxAnisotropy());
    // transparente para surgir por opacidade sob as folhas (depthWrite continua ligado)
    this.matFace = new MeshBasicMaterial({ map: this.texturaFace, transparent: true });
    this.face = new Mesh(new CircleGeometry(R, 96), this.matFace);
    this.face.position.z = 0.001;
    this.disco.add(this.face);

    const metal = new MeshMatcapMaterial({ matcap: matcap("#8fa3d0", "#ffffff", "#1c2134") });
    const ouro = new MeshMatcapMaterial({ matcap: matcap("#ffcf6b", "#fffbe8", "#7a4a12") });
    const azulEscuro = new MeshMatcapMaterial({ matcap: matcap("#22345f", "#6982b0", "#050a1a") });
    this.descartaveis.push(metal, ouro, azulEscuro);

    this.lateral = new Mesh(new CylinderGeometry(R, R * 0.97, 0.14, 96, 1, true), azulEscuro);
    this.lateral.rotation.x = Math.PI / 2;
    this.lateral.position.z = -0.07;
    this.inclinacao.add(this.lateral);
    this.fundo = new Mesh(new CircleGeometry(R * 0.97, 64), new MeshBasicMaterial({ color: "#050a1a" }));
    this.fundo.position.z = -0.14;
    this.fundo.rotation.y = Math.PI;
    this.inclinacao.add(this.fundo);

    this.aro = new Mesh(new TorusGeometry(R * 1.005, 0.035, 12, 120), metal);
    this.inclinacao.add(this.aro);

    this.pinos = new InstancedMesh(new SphereGeometry(0.028, 10, 8), ouro, MAX_PINOS);
    this.pinos.count = 0;
    this.disco.add(this.pinos);

    this.cubo = new Mesh(new CylinderGeometry(0.16, 0.18, 0.08, 48), azulEscuro);
    this.cubo.rotation.x = Math.PI / 2;
    this.cubo.position.z = 0.04;
    this.inclinacao.add(this.cubo);
    this.anelCubo = new Mesh(new TorusGeometry(0.165, 0.012, 8, 64), metal);
    this.anelCubo.position.z = 0.08;
    this.inclinacao.add(this.anelCubo);
    this.estrelaCentral = new Mesh(
      new PlaneGeometry(0.3, 0.3),
      new MeshBasicMaterial({ map: texturaEstrela4(), transparent: true, depthWrite: false }),
    );
    this.estrelaCentral.position.z = 0.085;
    this.inclinacao.add(this.estrelaCentral);

    // brilho especular que NÃO gira (vende o volume)
    this.matBrilho = new MeshBasicMaterial({
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
    });
    this.brilho = new Mesh(new CircleGeometry(R, 64), this.matBrilho);
    this.brilho.position.z = 0.012;
    this.inclinacao.add(this.brilho);

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
    // a face é transparente (para aparecer por opacidade): enxame e faíscas vão depois dela
    this.enxame.renderOrder = 2;
    this.cena.add(this.enxame);

    this.faiscas = this.criarFaiscas(160);
    this.faiscas.renderOrder = 2;
    this.cena.add(this.faiscas);

    // ---------- chegada: folhas que viram roleta ----------
    this.nFolhas = this.leve ? 250 : 600;
    this.larguraFolha = LARGURA_FOLHA_600 * Math.sqrt(600 / this.nFolhas);
    this.ordemFolhas = new Uint16Array(this.nFolhas);
    this.chaveFolhas = new Float32Array(this.nFolhas);
    this.matFolhas = new ShaderMaterial({
      uniforms: {
        uMatrizDisco: { value: this.disco.matrixWorld },
        uProg: { value: 0 },
        uDurVoo: { value: DUR_VOO },
        uEscalaOrigem: { value: 1 },
        uAlfa: { value: 0 },
        uSumir: { value: 0 },
      },
      vertexShader: VERT_FOLHAS,
      fragmentShader: FRAG_FOLHAS,
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
    });
    this.descartaveis.push(this.matFolhas);
    this.folhas = this.criarFolhas(this.nFolhas);
    this.cena.add(this.folhas);

    this.redimensionar();
    window.addEventListener("resize", this.redimensionar);
    window.addEventListener("pointermove", this.moverPonteiro, { passive: true });
    window.addEventListener("pointerdown", this.tocarFundo, { passive: true });
    document.fonts?.ready.then(() => !this.destruido && this.redesenharFace());

    // pré-compila os shaders antes do primeiro giro; falha de shader = volta para o 2D
    // (folhas e enxame ficam visíveis só durante a compilação, para não travar na 1ª chegada)
    this.renderer.debug.onShaderError = () => this.falhar("falha ao compilar shader");
    this.folhas.visible = true;
    this.enxame.visible = true;
    this.renderer.compile(this.cena, this.camera);
    this.enxame.visible = false;
    this.aplicarOculta();
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

  /**
   * Folhas 3:2 instanciadas (1 draw call). Alvo fixo: espiral de Vogel numa coroa do disco
   * (uniforme por área). Origem e cor são preenchidas a cada chegada (prepararFolhas).
   */
  private criarFolhas(n: number): Mesh {
    const rnd = gerador(41);
    const w = this.larguraFolha / 2;
    const h = this.larguraFolha / 3;
    const g = new InstancedBufferGeometry();
    g.setAttribute("position", new BufferAttribute(new Float32Array([-w, -h, 0, w, -h, 0, -w, h, 0, w, h, 0]), 3));
    g.setAttribute("uv", new BufferAttribute(new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), 2));
    g.setIndex([0, 1, 2, 2, 1, 3]);
    const alvo = new Float32Array(n * 3);
    const atraso = new Float32Array(n);
    const giro = new Float32Array(n * 4);
    const r0 = 0.16;
    const r1 = 0.95;
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n;
      const rr = Math.sqrt(r0 * r0 + t * (r1 * r1 - r0 * r0)) * R;
      const phi = modPositivo(i * 2.399963229728653 + (rnd() - 0.5) * 0.08, TAU);
      alvo.set([Math.sin(phi) * rr, Math.cos(phi) * rr, 0.02 + rnd() * 0.012], i * 3);
      // pouso escalonado: varredura horária a partir das 12h + acaso
      atraso[i] = 0.04 + 0.22 * rnd() + 0.12 * (phi / TAU);
      const th = rnd() * TAU;
      const z = rnd() * 2 - 1;
      const s = Math.sqrt(1 - z * z);
      const voltas = (rnd() < 0.5 ? -1 : 1) * Math.PI * (1.5 + rnd() * 2.5);
      giro.set([s * Math.cos(th), s * Math.sin(th), z, voltas], i * 4);
    }
    g.setAttribute("aAlvo", new InstancedBufferAttribute(alvo, 3));
    g.setAttribute("aAtraso", new InstancedBufferAttribute(atraso, 1));
    g.setAttribute("aGiro", new InstancedBufferAttribute(giro, 4));
    g.setAttribute("aOrigem", new InstancedBufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aCor", new InstancedBufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("aArco", new InstancedBufferAttribute(new Float32Array(n), 1));
    g.instanceCount = n;
    this.descartaveis.push(g);
    const malha = new Mesh(g, this.matFolhas);
    malha.frustumCulled = false;
    malha.renderOrder = 1; // depois da face, testando profundidade contra ela
    return malha;
  }

  /**
   * Preenche origem (grade sobre o retângulo central onde estava o painel de CPF, desprojetada
   * para um plano entre a câmera e a roleta, no espaço da câmera, já com o setViewOffset) e a
   * cor da fatia sob cada alvo. Roda uma vez por chegada, nunca por quadro.
   */
  private prepararFolhas(): void {
    const n = this.nFolhas;
    const rnd = this.rndFolhas;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rw = Math.min(W * 0.9, Math.max(300, W * 0.34));
    const rh = Math.min(H * 0.9, Math.max(380, H * 0.6));
    const celH = Math.sqrt((rw * rh) / (1.5 * n));
    const celW = celH * 1.5;
    const cols = Math.max(1, Math.round(rw / celW));
    const linhas = Math.ceil(n / cols);
    const x0 = W / 2 - ((cols - 1) * celW) / 2;
    const y0 = H / 2 - ((linhas - 1) * celH) / 2;
    const d = this.distBase * 0.55;
    const pxParaVista = (2 * d * Math.tan(((FOV / 2) * Math.PI) / 180)) / H;
    this.matFolhas.uniforms.uEscalaOrigem.value = (celW * 0.9 * pxParaVista) / this.larguraFolha;

    // centro do painel -> centro do disco, bordas do painel -> aro
    for (let k = 0; k < n; k++) {
      const dx = ((k % cols) - (cols - 1) / 2) / cols;
      const dy = (Math.floor(k / cols) - (linhas - 1) / 2) / linhas;
      this.chaveFolhas[k] = dx * dx + dy * dy + rnd() * 0.01;
      this.ordemFolhas[k] = k;
    }
    const chave = this.chaveFolhas;
    this.ordemFolhas.sort((a, b) => chave[a] - chave[b]);

    const g = this.folhas.geometry;
    const origem = g.getAttribute("aOrigem") as InstancedBufferAttribute;
    const cor = g.getAttribute("aCor") as InstancedBufferAttribute;
    const arco = g.getAttribute("aArco") as InstancedBufferAttribute;
    const alvo = g.getAttribute("aAlvo") as InstancedBufferAttribute;
    const nf = this.fatias.length;
    const v = this.vTmp;
    for (let i = 0; i < n; i++) {
      const k = this.ordemFolhas[i];
      const sx = x0 + (k % cols) * celW + (rnd() - 0.5) * celW * 0.12;
      const sy = y0 + Math.floor(k / cols) * celH + (rnd() - 0.5) * celH * 0.12;
      v.set((sx / W) * 2 - 1, -(sy / H) * 2 + 1, 0.5).applyMatrix4(this.camera.projectionMatrixInverse);
      v.multiplyScalar((d * (0.94 + rnd() * 0.12)) / -v.z);
      origem.setXYZ(i, v.x, v.y, v.z);
      arco.setX(i, (0.05 + rnd() * 0.17) * this.distBase);

      const ax = alvo.getX(i);
      const ay = alvo.getY(i);
      const rr = Math.sqrt(ax * ax + ay * ay) / R;
      if (nf) {
        const f = this.fatias[fatiaSobPonteiro(this.fatias, -modPositivo(Math.atan2(ax, ay), TAU))] ?? this.fatias[0];
        const j = f.indice;
        this.corTmp.set(corBaseFatia(j, nf)).lerp(this.corTmp2.set(corLuz(j, nf)), 0.2 + 0.55 * rr * rr);
      } else {
        this.corTmp.set(PALETA.azulClaro);
      }
      this.corTmp.multiplyScalar(0.9 + rnd() * 0.25).convertLinearToSRGB();
      cor.setXYZ(i, this.corTmp.r, this.corTmp.g, this.corTmp.b);
    }
    origem.needsUpdate = true;
    cor.needsUpdate = true;
    arco.needsUpdate = true;
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
    this.pinos.count = Math.min(fatias.length > 1 ? fatias.length : 0, MAX_PINOS);
    this.posicionarPinos(this.modoRevelacao === "chegando" ? this.revelacao : 1);
  }

  definirFase(fase: Fase): void {
    const anterior = this.fase;
    const comRoleta = FASES_COM_ROLETA.has(fase);
    if (comRoleta && (this.modoRevelacao === "oculta" || this.modoRevelacao === "saindo")) {
      // cena que já nasce com roleta (recarga em "resultado", troca 2D/3D): sem animação
      if (this.primeiraFase || anterior === "carregando") this.mostrarDireto();
      else this.iniciarChegada();
    } else if (!comRoleta && (this.modoRevelacao === "chegando" || this.modoRevelacao === "visivel")) {
      this.iniciarSaida();
    }
    // o giro começou no meio da chegada: termina rápido, com o ponteiro já no lugar
    if (fase === "girando" && this.modoRevelacao === "chegando") {
      this.fatorChegada = Math.max(this.fatorChegada, (this.durChegada - this.tRevelacao) / DUR_APRESSADA);
    }
    this.primeiraFase = false;

    if (fase === "resultado" && this.fase !== "resultado") {
      this.tempoResultado = performance.now();
      this.enxame.visible = true;
    }
    this.fase = fase;
  }

  /** true quando a roleta terminou de chegar e está inteira no lugar. */
  revelacaoConcluida(): boolean {
    return this.modoRevelacao === "visivel";
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
    // envia a textura à GPU agora (com a roleta oculta), e não no meio da animação de chegada
    try {
      this.renderer.initTexture(this.texturaFace);
    } catch {
      /* se falhar, o envio acontece no primeiro quadro, como antes */
    }
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

  // ---------- revelação (chegada / saída da roleta) ----------
  private iniciarChegada() {
    this.modoRevelacao = "chegando";
    this.tRevelacao = 0;
    this.revelacao = 0;
    this.fatorChegada = 1;
    this.folhasPendentes = true;
    this.matFolhas.uniforms.uProg.value = 0;
    this.matFolhas.uniforms.uAlfa.value = 0;
  }

  private iniciarSaida() {
    this.rSaida = Math.max(0.05, this.revelacao);
    this.modoRevelacao = "saindo";
    this.tRevelacao = 0;
    // roleta que mal começou a se formar não solta o anel de faíscas
    this.brilhoSaidaEmitido = this.revelacao < 0.5;
    this.folhasPendentes = false;
  }

  private mostrarDireto() {
    const primeiraChegada = this.modoRevelacao === "chegando";
    this.modoRevelacao = "visivel";
    this.revelacao = 1;
    this.aplicarVisivel();
    // a avaliação inicial mediu a cena sem roleta: refaz com a roleta montada
    if (primeiraChegada && !this.reavaliado) {
      this.reavaliado = true;
      this.avaliado = false;
      this.amostrasQuadro = [];
      this.janelaInicio = 0;
    }
  }

  /** Avança o relógio da revelação (antes da câmera, que usa o afastamento). */
  private avancarRevelacao(dt: number) {
    if (this.modoRevelacao === "chegando") {
      this.tRevelacao += dt * this.fatorChegada;
      const u = Math.min(1, this.tRevelacao / this.durChegada);
      this.revelacao = u;
      // a câmera recua rápido enquanto o painel se desfaz (o céu ganha profundidade, sem
      // salto) e depois mergulha até o enquadramento final
      const recuo = 0.14;
      this.afastamento =
        u < recuo ? Math.max(this.afastamento, 1 - (1 - u / recuo) ** 3) : 1 - inOutCubic(faixa(u, recuo, 0.95));
      if (u >= 1) this.mostrarDireto();
      return;
    }
    this.afastamento *= Math.exp(-dt * 5);
    if (this.modoRevelacao === "saindo") {
      this.tRevelacao += dt;
      const u = Math.min(1, this.tRevelacao / DUR_SAIDA);
      this.revelacao = this.rSaida * (1 - u);
      if (u >= 1) {
        this.modoRevelacao = "oculta";
        this.revelacao = 0;
        this.aplicarOculta();
      }
    }
  }

  /** Aplica o estado do quadro às peças (depois da câmera: as folhas desprojetam com ela). */
  private aplicarRevelacao(dt: number) {
    if (this.modoRevelacao === "chegando") {
      if (this.folhasPendentes) {
        this.prepararFolhas();
        this.folhasPendentes = false;
      }
      this.aplicarChegada(this.revelacao);
    } else if (this.modoRevelacao === "saindo") {
      this.aplicarSaida(Math.min(1, this.tRevelacao / DUR_SAIDA), dt);
    }
  }

  private escalar(obj: Mesh, s: number, z0: number) {
    obj.visible = s > 0.001;
    obj.scale.setScalar(Math.max(s, 1e-4));
    obj.position.z = z0 * s;
  }

  /** Pinos surgem um a um, no sentido horário a partir das 12h. */
  private posicionarPinos(u: number) {
    const n = this.pinos.count;
    const m = this.matrizPino;
    for (let i = 0; i < n; i++) {
      const phi = this.fatias[i].inicio;
      const ini = 0.64 + 0.2 * (i / n);
      const s = u >= 1 ? 1 : Math.max(0, outBack(faixa(u, ini, ini + 0.12)));
      m.makeScale(s, s, s);
      m.setPosition(Math.sin(phi) * R * 0.975, Math.cos(phi) * R * 0.975, 0.03);
      this.pinos.setMatrixAt(i, m);
    }
    this.pinos.instanceMatrix.needsUpdate = true;
  }

  private aplicarChegada(u: number) {
    this.inclinacao.visible = true;
    this.inclinacao.scale.setScalar(1);
    this.halo.visible = true;

    // folhas: surgem no lugar do painel, voam, pousam e somem quando a face aparece
    const uf = this.matFolhas.uniforms;
    uf.uProg.value = u;
    uf.uAlfa.value = suave(u, 0, 0.05) * (1 - suave(u, 0.84, 0.98));
    uf.uSumir.value = suave(u, 0.7, 0.95);
    this.folhas.visible = uf.uAlfa.value > 0.001;

    const opFace = suave(u, 0.6, 0.88);
    this.matFace.opacity = opFace;
    this.face.visible = opFace > 0.001;

    // estrutura cresce com outBack
    const sAro = outBack(faixa(u, 0.5, 0.78));
    this.escalar(this.aro, sAro, 0);
    const sLado = outBack(faixa(u, 0.52, 0.8));
    this.escalar(this.lateral, sLado, -0.07);
    this.escalar(this.fundo, sLado, -0.14);
    const sCubo = outBack(faixa(u, 0.62, 0.86));
    this.escalar(this.cubo, sCubo, 0.04);
    this.escalar(this.anelCubo, sCubo, 0.08);
    this.escalar(this.estrelaCentral, outBack(faixa(u, 0.7, 0.92)), 0.085);
    this.matBrilho.opacity = suave(u, 0.78, 1);
    this.brilho.visible = this.matBrilho.opacity > 0.001;
    this.posicionarPinos(u);

    // ponteiro cai de cima e quica
    const kp = faixa(u, 0.72, 1);
    this.ponteiro.visible = kp > 0;
    this.ponteiro.position.y = R * 1.1 + (1 - outBounce(kp)) * 1.3;

    // halo acende e dá um flash curto quando as folhas viram face
    const flash = Math.exp(-(((u - 0.8) / 0.06) ** 2));
    this.matHalo.opacity = suave(u, 0.4, 0.85);
    this.matHalo.color.setScalar(1 + flash * 2.2);
    this.halo.scale.setScalar(1 + flash * 0.35);
  }

  /** Saída: a roleta toma impulso, encolhe e se desfaz em faíscas (sem folhas). */
  private aplicarSaida(u: number, dt: number) {
    const s = Math.max(1e-4, this.rSaida * (1 - inBack(u)));
    this.inclinacao.scale.setScalar(s);
    this.matFace.opacity = Math.min(this.matFace.opacity, 1 - suave(u, 0.4, 0.9));
    this.matBrilho.opacity = Math.min(this.matBrilho.opacity, 1 - suave(u, 0.15, 0.5));
    const flash = Math.exp(-(((u - 0.55) / 0.12) ** 2));
    this.matHalo.opacity = Math.min(1, this.rSaida * 1.5) * (1 - suave(u, 0.6, 1));
    this.matHalo.color.setScalar(1 + flash * 2.5);
    this.halo.scale.setScalar(Math.max(1e-4, s * (1 + flash * 0.4)));
    const uf = this.matFolhas.uniforms;
    uf.uAlfa.value = Math.max(0, uf.uAlfa.value - dt * 5);
    this.folhas.visible = uf.uAlfa.value > 0.001;
    if (!this.brilhoSaidaEmitido && u >= 0.55) {
      this.brilhoSaidaEmitido = true;
      this.emitirBrilhoSaida(s);
    }
  }

  private emitirBrilhoSaida(s: number) {
    this.inclinacao.updateMatrixWorld();
    const total = this.leve ? 36 : 64;
    let k = 0;
    for (const f of this.poolFaiscas) {
      if (f.vida > 0) continue;
      const a = (k / total) * TAU;
      f.pos.set(Math.sin(a) * R * s, Math.cos(a) * R * s, 0.05);
      this.inclinacao.localToWorld(f.pos);
      const vel = 0.8 + Math.random() * 1.4; // cosmético
      f.vel.set(Math.sin(a) * vel, Math.cos(a) * vel * 0.8, (Math.random() - 0.2) * 0.8);
      f.vida = 1;
      if (++k >= total) break;
    }
  }

  /** Roleta inteira no lugar (fim da chegada ou cena que já nasce com roleta). */
  private aplicarVisivel() {
    this.afastamento = 0;
    this.inclinacao.visible = true;
    this.inclinacao.scale.setScalar(1);
    this.halo.visible = true;
    this.halo.scale.setScalar(1);
    this.matHalo.opacity = 1;
    this.matHalo.color.setScalar(1);
    this.folhas.visible = false;
    this.matFolhas.uniforms.uAlfa.value = 0;
    this.matFace.opacity = 1;
    this.face.visible = true;
    this.escalar(this.aro, 1, 0);
    this.escalar(this.lateral, 1, -0.07);
    this.escalar(this.fundo, 1, -0.14);
    this.escalar(this.cubo, 1, 0.04);
    this.escalar(this.anelCubo, 1, 0.08);
    this.escalar(this.estrelaCentral, 1, 0.085);
    this.matBrilho.opacity = 1;
    this.brilho.visible = true;
    this.ponteiro.visible = true;
    this.ponteiro.position.y = R * 1.1;
    this.posicionarPinos(1);
  }

  /** Só a tela de CPF: nada da roleta é desenhado. */
  private aplicarOculta() {
    this.inclinacao.visible = false;
    this.inclinacao.scale.setScalar(1);
    this.halo.visible = false;
    this.folhas.visible = false;
    this.matFolhas.uniforms.uAlfa.value = 0;
  }

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
    // mergulho da chegada: o disco começa quase deitado e levanta até a inclinação normal
    const af = this.afastamento;
    this.inclinacao.rotation.x = this.inclinacaoAtual + (INCLINACAO_DEITADA - this.inclinacaoAtual) * af;
    const alvoAprox = this.fase === "resultado" ? 1 : 0;
    this.aproximacao += (alvoAprox - this.aproximacao) * (1 - Math.exp(-dt * 1.5));

    // parallax amortecido + deriva senoidal (câmera nunca parada)
    const p = this.parallax;
    const kp = 1 - Math.exp(-dt * 2);
    p.x += (p.ax - p.x) * kp;
    p.y += (p.ay - p.y) * kp;
    const giroFinal = this.fase === "girando" || this.fase === "resultado";
    const amplitude = this.leve ? 0 : giroFinal ? 0.25 : 1;
    // durante a chegada a câmera vem de longe, do alto e de lado (como a câmera viva do slide)
    const az = (Math.sin(t * 0.21) * 0.05 + p.x * 0.07) * amplitude + 0.5 * af * af;
    const el = (0.06 + Math.sin(t * 0.17) * 0.025 + p.y * 0.04) * amplitude + (ativo ? 0.05 : 0) + 0.55 * af;

    const tanMeio = Math.tan(((FOV / 2) * Math.PI) / 180);
    this.distBase = ((R * 1.12 * H) / (2 * raio * tanMeio)) * (1 - 0.08 * this.aproximacao);
    const dist = this.distBase * (1 + 0.9 * af);
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
        // primeiro tenta baixar a resolução; só cai para o 2D se já estiver no mínimo
        if (this.dprAtual > 0.75) {
          this.dprAtual = this.dprAtual > 1 ? 1 : 0.75;
          this.renderer.setPixelRatio(this.dprAtual);
          this.redimensionar();
          this.ema = 0;
          this.lentoDesde = 0;
          return;
        }
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
    this.avancarRevelacao(dt);
    this.atualizarCamera(dt, t);
    this.aplicarRevelacao(dt);
    this.atualizarFaiscas(dt);
    this.renderer.render(this.cena, this.camera);
    this.avaliarDesempenho(dtMs, agora);
  }
}