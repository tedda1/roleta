/**
 * Fundo do espaço: nebulosas coloridas e Via Láctea (com faixas de poeira escura) num mapa
 * equiretangular GERADO UMA VEZ NA GPU (ruído fractal 3D com domínio distorcido) e colado numa
 * esfera que acompanha a câmera. Por quadro custa só uma leitura de textura por pixel do fundo,
 * então serve até no nível leve (mapa menor).
 *
 * O mapa guarda a cor "de tela" (sRGB). Sem bloom o shader escreve direto; no alvo HDR do bloom
 * volta para linear (o OutputPass converte no fim), como os outros shaders da cena.
 */
import {
  BackSide,
  LinearFilter,
  LinearMipmapLinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from "three";

/**
 * Normal do plano da Via Láctea: escolhida para a faixa cruzar a vista final (câmera em
 * ~(0; 0,7; 6) olhando para −z) na diagonal, subindo para a direita.
 */
export const NORMAL_BANDA = (() => {
  const vista = new Vector3(0, -0.116, -0.993).normalize();
  const diagonal = new Vector3(0.876, 0.482, 0).normalize();
  return new Vector3().crossVectors(vista, diagonal).normalize();
})();
/** núcleo da galáxia (parte mais clara e quente da faixa): à esquerda e um pouco acima da vista */
const CENTRO_BANDA = new Vector3(-0.55, 0.1, -0.83).normalize();

const VERT_GERAR = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FRAG_GERAR = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform vec3 uBanda;
  uniform vec3 uCentro;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float ruido(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5;
    float s = 0.0;
    for (int i = 0; i < 6; i++) {
      s += a * ruido(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return s;
  }
  // nuvem de nebulosa: ruído com domínio distorcido (filamentos), concentrada numa região do céu
  vec3 nuvem(vec3 d, vec3 centro, float raio, vec3 cor, float escala, float semente, float forca) {
    float ang = acos(clamp(dot(d, normalize(centro)), -1.0, 1.0));
    float regiao = exp(-(ang * ang) / (raio * raio));
    if (regiao < 0.004) return vec3(0.0);
    vec3 q = d * escala + semente;
    vec3 w = vec3(fbm(q + 3.1), fbm(q + 7.7), fbm(q + 1.3));
    float n = fbm(q + 2.2 * w);
    float m = smoothstep(0.4, 0.82, n) * regiao;
    // borda mais quente/clara nos filamentos densos
    vec3 c = mix(cor, cor * 1.6 + 0.06, smoothstep(0.62, 0.9, n));
    return c * m * forca;
  }

  void main() {
    // mesma convenção de UV da SphereGeometry do three
    float fi = vUv.x * 6.2831853;
    float th = (1.0 - vUv.y) * 3.14159265;
    vec3 d = vec3(-cos(fi) * sin(th), cos(th), sin(fi) * sin(th));

    vec3 base = vec3(0.039, 0.133, 0.282); // #0a2248, o azul da paleta
    float b = dot(d, uBanda);
    float faixa = exp(-b * b / 0.022);
    float largo = exp(-b * b / 0.16);
    float nucleo = pow(max(0.0, dot(d, uCentro)), 4.0);
    vec3 cor = base * (0.68 + 0.32 * largo);

    // Via Láctea: brilho difuso + grão + faixas de poeira escura
    float n1 = fbm(d * 3.2 + 11.0);
    float n2 = fbm(d * 14.0 + 4.0);
    // poeira escura só no miolo da faixa, em filamentos finos
    float poeira = smoothstep(0.5, 0.68, fbm(d * 7.0 + vec3(21.0, 3.0, 8.0))) * smoothstep(0.25, 0.8, faixa);
    float brilho = faixa * (0.35 + 0.65 * n1) * (0.6 + 1.2 * nucleo);
    cor += vec3(0.3, 0.37, 0.58) * brilho * 0.85 * (1.0 - 0.75 * poeira);
    cor += vec3(0.55, 0.52, 0.68) * pow(n2, 3.0) * faixa * 0.6 * (1.0 - poeira);
    cor += vec3(0.7, 0.55, 0.38) * nucleo * faixa * 0.22 * (1.0 - 0.7 * poeira);
    cor += vec3(0.14, 0.18, 0.34) * largo * n1 * 0.18;
    cor *= 1.0 - 0.28 * poeira;

    // nebulosas (tons da paleta e da logo, discretas): duas aparecem na vista final, nos
    // cantos (alto à direita, baixo à esquerda); as outras dão cor à viagem
    cor += nuvem(d, vec3(0.42, 0.3, -0.86), 0.5, vec3(0.4, 0.18, 0.5), 2.4, 1.0, 0.85);
    cor += nuvem(d, vec3(-0.5, -0.36, -0.79), 0.48, vec3(0.0, 0.36, 0.42), 2.8, 5.0, 0.8);
    cor += nuvem(d, vec3(0.75, 0.15, -0.6), 0.55, vec3(0.04, 0.26, 0.6), 2.2, 9.0, 0.55);
    cor += nuvem(d, vec3(-0.85, 0.35, 0.2), 0.6, vec3(0.42, 0.16, 0.36), 2.0, 13.0, 0.55);
    cor += nuvem(d, vec3(0.2, -0.4, 0.9), 0.65, vec3(0.5, 0.26, 0.08), 2.3, 17.0, 0.4);
    cor += nuvem(d, vec3(0.6, 0.7, 0.35), 0.55, vec3(0.0, 0.34, 0.34), 2.6, 23.0, 0.45);

    // (as estrelas são pontos de verdade na cena: no mapa viram borrões ao ampliar)

    // dither: sem degraus no gradiente em 8 bits
    cor += (hash(vec3(gl_FragCoord.xy, 7.0)) - 0.5) / 255.0;
    gl_FragColor = vec4(cor, 1.0);
  }
`;

const VERT_CEU = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_CEU = /* glsl */ `
  uniform sampler2D uMapa;
  uniform float uBrilho;
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(uMapa, vUv).rgb * uBrilho;
    #ifdef NO_ALVO_HDR
    c = sRGBTransferEOTF(vec4(c, 1.0)).rgb;
    #endif
    gl_FragColor = vec4(c, 1.0);
  }
`;

export interface Ceu {
  malha: Mesh;
  /** acompanha a câmera (o céu fica "no infinito") */
  seguir: (pos: Vector3) => void;
  descartar: () => void;
}

/** Gera o mapa do céu (uma vez) e devolve a esfera pronta para a cena. */
export function criarCeu(renderer: WebGLRenderer, largura: number): Ceu {
  const lado = Math.min(largura, renderer.capabilities.maxTextureSize);
  const alvo = new WebGLRenderTarget(lado, lado / 2, { depthBuffer: false, generateMipmaps: true });
  alvo.texture.wrapS = RepeatWrapping;
  alvo.texture.minFilter = LinearMipmapLinearFilter;
  alvo.texture.magFilter = LinearFilter;
  alvo.texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());

  const matGerar = new ShaderMaterial({
    uniforms: { uBanda: { value: NORMAL_BANDA }, uCentro: { value: CENTRO_BANDA } },
    vertexShader: VERT_GERAR,
    fragmentShader: FRAG_GERAR,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new Mesh(new PlaneGeometry(2, 2), matGerar);
  quad.frustumCulled = false;
  const cenaGerar = new Scene();
  cenaGerar.add(quad);
  const anterior = renderer.getRenderTarget();
  renderer.setRenderTarget(alvo);
  renderer.render(cenaGerar, new OrthographicCamera(-1, 1, 1, -1, 0, 1));
  renderer.setRenderTarget(anterior);
  quad.geometry.dispose();
  matGerar.dispose();

  const mat = new ShaderMaterial({
    uniforms: { uMapa: { value: alvo.texture }, uBrilho: { value: 1 } },
    vertexShader: VERT_CEU,
    fragmentShader: FRAG_CEU,
    side: BackSide,
    depthTest: false,
    depthWrite: false,
  });
  const malha = new Mesh(new SphereGeometry(150, 64, 32), mat);
  malha.frustumCulled = false;
  malha.renderOrder = -100; // antes de tudo: é o fundo
  return {
    malha,
    seguir: (pos) => malha.position.copy(pos),
    descartar: () => {
      malha.geometry.dispose();
      mat.dispose();
      alvo.dispose();
    },
  };
}
