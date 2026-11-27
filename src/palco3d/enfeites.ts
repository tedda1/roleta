/**
 * Enfeites do céu 3D:
 * - linhas das constelações como faixas finas de verdade (largura em pixels, borda suave sem
 *   serrilhado, um vão perto de cada estrela e um brilho que percorre a linha devagar);
 * - estrelas das constelações com núcleo, halo e raios em cruz (difração), cintilando;
 * - estrelas cadentes de fundo, de vez em quando, cruzando o céu longe da roleta.
 * Tudo aditivo (alfa 1: a intensidade já vai na cor, sem multiplicar duas vezes), poucas draw calls (1 por tipo), sem alocação por quadro.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  ShaderMaterial,
  Vector3,
  type Vector2,
  type PerspectiveCamera,
} from "three";

/** Saída de cor igual à dos outros shaders da cena (ver ligarCorCorreta em cena.ts). */
const SAIDA = /* glsl */ `
    #ifdef COR_CORRETA
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
`;

export type UniformesCeu = {
  uTempo: { value: number };
  uEscala: { value: number };
  /** tamanho do framebuffer em pixels (largura, altura) */
  uResolucao: { value: Vector2 };
  uDpr: { value: number };
};

// ---------- linhas das constelações ----------
const VERT_LINHA = /* glsl */ `
  attribute vec3 aB;
  attribute float aT;
  attribute float aLado;
  attribute vec3 aCor;
  attribute float aSemente;
  uniform vec2 uResolucao;
  uniform float uDpr;
  varying float vLado;
  varying float vT;
  varying float vComp;
  varying vec3 vCor;
  varying float vSemente;
  void main() {
    vec4 va = modelViewMatrix * vec4(position, 1.0);
    vec4 vb = modelViewMatrix * vec4(aB, 1.0);
    const float PERTO = -0.15;
    // recorta no plano próximo (a câmera atravessa as constelações na viagem)
    if (va.z > PERTO && vb.z > PERTO) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    if (va.z > PERTO) va = mix(va, vb, (va.z - PERTO) / (va.z - vb.z));
    if (vb.z > PERTO) vb = mix(vb, va, (vb.z - PERTO) / (vb.z - va.z));
    vec4 ca = projectionMatrix * va;
    vec4 cb = projectionMatrix * vb;
    vec2 pa = ca.xy / ca.w * 0.5 * uResolucao;
    vec2 pb = cb.xy / cb.w * 0.5 * uResolucao;
    vec2 d = pb - pa;
    float comp = max(length(d), 1e-4);
    vec2 n = vec2(-d.y, d.x) / comp;
    vec4 c = mix(ca, cb, aT);
    float meia = 2.2 * uDpr; // meia largura da faixa (o núcleo visível tem ~1,3 px)
    c.xy += n * aLado * meia / (0.5 * uResolucao) * c.w;
    gl_Position = c;
    vLado = aLado;
    vT = aT;
    vComp = comp;
    vCor = aCor;
    vSemente = aSemente;
  }
`;

const FRAG_LINHA = /* glsl */ `
  uniform float uTempo;
  uniform float uDpr;
  varying float vLado;
  varying float vT;
  varying float vComp;
  varying vec3 vCor;
  varying float vSemente;
  void main() {
    float atravessa = exp(-vLado * vLado * 5.5);
    float px = vT * vComp;
    float vao = 9.0 * uDpr; // não encosta no centro das estrelas
    float pontas = smoothstep(vao, vao + 10.0 * uDpr, px) * smoothstep(vao, vao + 10.0 * uDpr, vComp - px);
    // brilho que corre pela linha, devagar, cada linha no seu tempo
    float corre = pow(max(0.0, sin(vT * 3.14159 - uTempo * 0.6 + vSemente * 6.28)), 18.0);
    float a = atravessa * pontas * (0.42 + 0.55 * corre);
    vec3 cor = mix(vCor, vec3(1.0), 0.35 + 0.4 * corre);
    gl_FragColor = vec4(cor * a, 1.0);
    ${SAIDA}
  }
`;

/** Faixas finas entre pares de nós (`segmentos`: [a, b] índices em `nos`). */
export function criarLinhasConstelacao(nos: Vector3[], cores: Color[], segmentos: [number, number][], u: UniformesCeu): Mesh {
  const nv = segmentos.length * 4;
  const pos = new Float32Array(nv * 3);
  const b = new Float32Array(nv * 3);
  const t = new Float32Array(nv);
  const lado = new Float32Array(nv);
  const cor = new Float32Array(nv * 3);
  const semente = new Float32Array(nv);
  const idx: number[] = [];
  segmentos.forEach(([ia, ib], s) => {
    const A = nos[ia];
    const B = nos[ib];
    for (let k = 0; k < 4; k++) {
      const v = s * 4 + k;
      pos.set([A.x, A.y, A.z], v * 3);
      b.set([B.x, B.y, B.z], v * 3);
      t[v] = k < 2 ? 0 : 1;
      lado[v] = k % 2 === 0 ? -1 : 1;
      const c = k < 2 ? cores[ia] : cores[ib];
      cor.set([c.r, c.g, c.b], v * 3);
      semente[v] = (s * 0.618) % 1;
    }
    const o = s * 4;
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  });
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(pos, 3));
  g.setAttribute("aB", new BufferAttribute(b, 3));
  g.setAttribute("aT", new BufferAttribute(t, 1));
  g.setAttribute("aLado", new BufferAttribute(lado, 1));
  g.setAttribute("aCor", new BufferAttribute(cor, 3));
  g.setAttribute("aSemente", new BufferAttribute(semente, 1));
  g.setIndex(idx);
  const m = new ShaderMaterial({
    uniforms: u,
    vertexShader: VERT_LINHA,
    fragmentShader: FRAG_LINHA,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide, // a orientação do quad depende do sentido da linha na tela
  });
  const malha = new Mesh(g, m);
  malha.frustumCulled = false;
  return malha;
}

// ---------- estrelas das constelações (com raios) ----------
const VERT_NO = /* glsl */ `
  attribute float aTam;
  attribute float aFase;
  attribute vec3 aCor;
  uniform float uTempo;
  uniform float uEscala;
  varying vec3 vCor;
  varying float vBrilho;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float tw = 0.65 + 0.35 * sin(uTempo * (0.9 + aFase) + aFase * 40.0);
    vBrilho = tw;
    vCor = aCor;
    gl_PointSize = mv.z > -0.1 ? 0.0 : min(uEscala * 0.11, aTam * uEscala * (0.85 + 0.15 * tw) / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG_NO = /* glsl */ `
  varying vec3 vCor;
  varying float vBrilho;
  void main() {
    vec2 p = gl_PointCoord - 0.5;
    float d2 = dot(p, p);
    float nucleo = exp(-d2 * 1400.0);
    float halo = exp(-d2 * 70.0) * 0.4;
    float raios = exp(-abs(p.x) * 90.0) * exp(-p.y * p.y * 22.0) + exp(-abs(p.y) * 90.0) * exp(-p.x * p.x * 22.0);
    float a = (nucleo * 1.3 + halo + raios * 0.5 * vBrilho) * (0.55 + 0.45 * vBrilho);
    a *= smoothstep(0.25, 0.2, d2); // sem borda quadrada
    gl_FragColor = vec4(mix(vCor, vec3(1.0), min(1.0, nucleo * 0.8)) * a, 1.0);
    ${SAIDA}
  }
`;

export function materialNos(u: UniformesCeu): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: u,
    vertexShader: VERT_NO,
    fragmentShader: FRAG_NO,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });
}

// ---------- estrelas cadentes de fundo ----------
const VERT_METEORO = /* glsl */ `
  attribute vec2 aUv;
  attribute float aAlfa;
  attribute vec3 aCor;
  varying vec2 vUv;
  varying float vAlfa;
  varying vec3 vCor;
  void main() {
    vUv = aUv;
    vAlfa = aAlfa;
    vCor = aCor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_METEORO = /* glsl */ `
  varying vec2 vUv;
  varying float vAlfa;
  varying vec3 vCor;
  void main() {
    float y2 = vUv.y * vUv.y;
    float rastro = exp(-y2 * 9.0) * pow(vUv.x, 2.4) * smoothstep(1.0, 0.9, vUv.x);
    float dc = (vUv.x - 0.9) * 9.0;
    float cabeca = exp(-(dc * dc + y2 * 2.2) * 2.5);
    float a = (rastro * 0.8 + cabeca * 1.4) * vAlfa;
    gl_FragColor = vec4(mix(vCor, vec3(1.0), min(1.0, cabeca * 0.8 + 0.25)) * a, 1.0);
    ${SAIDA}
  }
`;

interface Meteoro {
  ativo: boolean;
  idade: number;
  vida: number;
  inicio: Vector3;
  dir: Vector3;
  vel: number;
  comp: number;
  largura: number;
}

/**
 * Pool de cadentes de fundo. Nascem a ~28 u da câmera, dentro do quadro, e cruzam na diagonal
 * (de cima para baixo) em ~1 s. `atualizar` só escreve 4 vértices por cadente ativa.
 */
export class Meteoros {
  readonly malha: Mesh;
  private pool: Meteoro[];
  private espera: number;
  private pos: Float32Array;
  private alfa: Float32Array;
  private cor: Float32Array;
  private vA = new Vector3();
  private vB = new Vector3();
  private vLado = new Vector3();
  private vOlhar = new Vector3();
  private direita = new Vector3();
  private cima = new Vector3();
  private frente = new Vector3();

  constructor(
    n: number,
    private intervalo: [number, number],
    private paleta: Color[],
  ) {
    this.pool = Array.from({ length: n }, () => ({
      ativo: false,
      idade: 0,
      vida: 1,
      inicio: new Vector3(),
      dir: new Vector3(),
      vel: 1,
      comp: 1,
      largura: 0.1,
    }));
    this.espera = 1.5;
    this.pos = new Float32Array(n * 4 * 3);
    this.alfa = new Float32Array(n * 4);
    this.cor = new Float32Array(n * 4 * 3);
    const uv = new Float32Array(n * 4 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      // 0: cauda -, 1: cauda +, 2: cabeça -, 3: cabeça +
      uv.set([0, -1, 0, 1, 1, -1, 1, 1], i * 8);
      const o = i * 4;
      idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage));
    g.setAttribute("aAlfa", new BufferAttribute(this.alfa, 1).setUsage(DynamicDrawUsage));
    g.setAttribute("aCor", new BufferAttribute(this.cor, 3).setUsage(DynamicDrawUsage));
    g.setAttribute("aUv", new BufferAttribute(uv, 2));
    g.setIndex(idx);
    const m = new ShaderMaterial({
      vertexShader: VERT_METEORO,
      fragmentShader: FRAG_METEORO,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.malha = new Mesh(g, m);
    this.malha.frustumCulled = false;
    this.malha.visible = false;
  }

  private lancar(m: Meteoro, i: number, camera: PerspectiveCamera) {
    camera.matrixWorld.extractBasis(this.direita, this.cima, this.frente);
    this.frente.negate();
    const dist = 24 + Math.random() * 10;
    const meiaAlt = Math.tan(((camera.fov / 2) * Math.PI) / 180) * dist;
    const meiaLarg = meiaAlt * camera.aspect;
    // nasce no alto do quadro, em qualquer lado; desce na diagonal para o lado oposto
    const sx = (Math.random() * 2 - 1) * 0.85;
    const sy = 0.25 + Math.random() * 0.7;
    m.inicio
      .copy(camera.position)
      .addScaledVector(this.frente, dist)
      .addScaledVector(this.direita, sx * meiaLarg)
      .addScaledVector(this.cima, sy * meiaAlt);
    const lado = sx > 0 ? -1 : 1;
    m.dir
      .copy(this.direita)
      .multiplyScalar(lado * (0.6 + Math.random() * 0.5))
      .addScaledVector(this.cima, -(0.45 + Math.random() * 0.45))
      .normalize();
    m.vel = meiaAlt * (0.9 + Math.random() * 0.6);
    m.comp = meiaAlt * (0.35 + Math.random() * 0.3);
    m.largura = meiaAlt * 0.012;
    m.vida = 0.8 + Math.random() * 0.6;
    m.idade = 0;
    m.ativo = true;
    // maioria branco-azulada; às vezes numa cor da logo
    const c = Math.random() < 0.35 && this.paleta.length ? this.paleta[Math.floor(Math.random() * this.paleta.length)] : new Color(Math.random() < 0.5 ? "#ffffff" : "#bcd4ff");
    for (let k = 0; k < 4; k++) this.cor.set([c.r, c.g, c.b], (i * 4 + k) * 3);
    (this.malha.geometry.getAttribute("aCor") as BufferAttribute).needsUpdate = true;
  }

  /** `ligado` = false deixa as ativas terminarem e não lança novas. */
  atualizar(dt: number, camera: PerspectiveCamera, ligado: boolean) {
    this.espera -= dt;
    if (ligado && this.espera <= 0) {
      const livre = this.pool.findIndex((m) => !m.ativo);
      if (livre >= 0) this.lancar(this.pool[livre], livre, camera);
      const [a, b] = this.intervalo;
      this.espera = a + Math.random() * (b - a);
    }
    let algum = false;
    const pos = this.pos;
    for (let i = 0; i < this.pool.length; i++) {
      const m = this.pool[i];
      const o = i * 4;
      if (!m.ativo) {
        this.alfa.fill(0, o, o + 4);
        continue;
      }
      m.idade += dt;
      if (m.idade >= m.vida) {
        m.ativo = false;
        this.alfa.fill(0, o, o + 4);
        continue;
      }
      algum = true;
      const u = m.idade / m.vida;
      const a = Math.min(1, u * 6) * (1 - Math.max(0, (u - 0.6) / 0.4)) ** 1.5;
      const cabeca = this.vA.copy(m.inicio).addScaledVector(m.dir, m.vel * m.idade);
      const comp = m.comp * Math.min(1, u * 3);
      const cauda = this.vB.copy(cabeca).addScaledVector(m.dir, -comp);
      this.vOlhar.copy(cabeca).sub(camera.position);
      const l = this.vLado.crossVectors(m.dir, this.vOlhar).normalize().multiplyScalar(m.largura);
      // a cabeça fica a 90% do comprimento da faixa: estende um pouco à frente
      cabeca.addScaledVector(m.dir, comp * 0.11);
      pos.set([cauda.x - l.x, cauda.y - l.y, cauda.z - l.z, cauda.x + l.x, cauda.y + l.y, cauda.z + l.z], o * 3);
      pos.set([cabeca.x - l.x, cabeca.y - l.y, cabeca.z - l.z, cabeca.x + l.x, cabeca.y + l.y, cabeca.z + l.z], o * 3 + 6);
      this.alfa.fill(a, o, o + 4);
    }
    this.malha.visible = algum;
    const g = this.malha.geometry;
    (g.getAttribute("position") as BufferAttribute).needsUpdate = true;
    (g.getAttribute("aAlfa") as BufferAttribute).needsUpdate = true;
  }

  descartar() {
    this.malha.geometry.dispose();
    (this.malha.material as ShaderMaterial).dispose();
  }
}
