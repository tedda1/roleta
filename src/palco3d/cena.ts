/**
 * Cena 3D da roleta. Herda do slide de referência a MECÂNICA (UI plana que ganha profundidade,
 * câmera viva, partículas que formam uma figura, tudo em função do tempo) e deixa de fora o
 * que é pesado (raymarching, pós-processamento, sombras, luzes).
 *
 * Orçamento: ~16 draw calls, < 20k triângulos, sem luzes (Basic/Matcap/shaders simples),
 * DPR ≤ 1,5, brilho por sprites aditivos. O resultado NUNCA é decidido aqui.
 *
 * Duas entradas (OpcoesCena.entrada) com o mesmo roteiro base de 8 s ("tau"), comprimido pela
 * duração real: "cadentes" ~6 s (~4 s no leve), "estrela" ~5 s (~3,5 s no leve). As duas usam a
 * mesma viagem (curva CatmullRom, câmera de perseguição, riscos de warp, constelações) e a mesma
 * formação da roleta (tau 6,6 → 8).
 *
 * Entrada "cadentes" (padrão), a viagem com as estrelas cadentes nas cores da logo:
 *  1. NASCIMENTO (tau 0–0,8): do centro da tela (onde estava o cartão do CPF) brota um ponto de
 *     luz e dele se abre, em leque, uma revoada de cadentes coloridas.
 *  2. VIAGEM (tau 0,8–5,3): um "líder" invisível percorre a curva e a câmera o persegue; as
 *     cadentes voam em formação ao lado e à frente da câmera (deslocamentos no referencial da
 *     curva, com ondulação própria), com rastros coloridos. Riscos de warp, fitas e
 *     constelações passam; as constelações acendem quando a revoada passa perto e cada uma se
 *     liga por linhas de luz a uma cadente.
 *  3. CHEGADA (tau ~4,7–6,6): o líder freia rumo ao centro da roleta e a câmera se afasta até o
 *     enquadramento final; cada cadente troca a formação por uma espiral horária em volta do
 *     líder (no plano do disco), que se fecha no centro em tau 6,6.
 *  4. FORMAÇÃO: flash, onda de choque, face revelada, arco do aro nas cores da logo, pinos, o
 *     medalhão com a logo nasce onde elas se juntaram e o ponteiro cai.
 * 2 draw calls para todas as cadentes (faixas dos rastros + cabeças), arrays pré-alocados; o
 * referencial do líder é calculado uma vez por amostra de rastro e serve a todas.
 *
 * Centro da roleta: MEDALHÃO (disco perolado + anel dourado + logo da empresa por cima, sem luz).
 * A logo vem de /marca/logo-oncologygroup.webp; se faltar, fica só o medalhão.
 *
 * Entrada "estrela" (estrela viajante), "Constelação: a nossa força é brilhar juntos" — cada
 * estrela é uma pessoa, cada conexão uma parceria:
 *  1. NASCIMENTO: no centro da tela (onde o cartão do CPF vira um ponto de luz) acende uma
 *     estrela: núcleo quente, halo, flare de 4 pontas girando devagar, brilho pulsante.
 *  2. VIAGEM: a estrela percorre uma curva (CatmullRom) entre as constelações e as fitas; a
 *     câmera a persegue (atrás e de lado, com leve rolagem nas curvas). As estrelas do fundo
 *     viram riscos de luz proporcionais à velocidade e a estrela deixa um rastro. Ao passar
 *     perto de 3 constelações, os nós acendem e linhas de luz os ligam à estrela.
 *  3. CHEGADA: a curva termina no centro da roleta; a estrela freia, cresce e pulsa, e a
 *     câmera se afasta girando até o enquadramento final (o mesmo da célula do layout).
 *  4. TRANSFORMAÇÃO: supernova curta (flash + onda de choque no plano do disco); a face se
 *     revela de dentro para fora com borda luminosa, um arco de luz percorre o aro, os pinos
 *     surgem como pequenas estrelas, o cubo nasce onde a estrela parou e o ponteiro cai.
 * Tocar a tela durante a chegada pula para o pouso (~0,75 s, igual nas duas entradas: a viagem
 * se apaga onde está, a câmera sai da perseguição em tempo real, o roteiro salta para o fim da
 * espiral/pouso e a formação segue). No instante em que a roleta se forma
 * (flash) a cena dispara `roleta:formou` (uma vez por chegada animada; a interface toca o som).
 * Ao terminar (ou quando a roleta é mostrada direto) dispara `roleta:chegada-concluida`.
 * Sem roleta (atração/CPF), nada dela é desenhado.
 *
 * Ao parar (girando → resultado, ~3 s): a fatia sob o ponteiro acende (setor com borda e
 * varredura de luz no plano do disco, que fica levemente aceso até sair do resultado), o
 * ponteiro pulsa com uma estrela na ponta, uma explosão de estrelas cadentes e faíscas nas
 * cores da logo sai do ponteiro e da fatia e se espalha pelo céu, e um anel de luz (onda +
 * arco colorido no aro) se expande.
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
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
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
  Texture,
  TextureLoader,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  HalfFloatType,
  NeutralToneMapping,
  NoToneMapping,
  Vector2,
} from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { PERFIS, type NivelQualidade, type PerfilQualidade } from "./qualidade";
import { desenharFace } from "@/arte/face";
import { LUZES, familiaCanvasTitulo } from "@/arte/paleta";
import { Fatia, TAU, anguloAtual, fatiaSobPonteiro, modPositivo } from "@/core/geometria";
import type { Fase, TotemStore } from "@/core/totem";

const R = 1; // raio da roleta em unidades de cena
const FOV = 30;
const TAN_MEIO_FOV = Math.tan(((FOV / 2) * Math.PI) / 180);
const MAX_PINOS = 32;
const EIXO_Y = new Vector3(0, 1, 0);

/** Fases em que a roleta existe na tela; nas demais o participante só vê o CPF. */
const FASES_COM_ROLETA: ReadonlySet<Fase> = new Set<Fase>(["pronto", "girando", "resultado"]);
const COR_FUNDO = "#0a2248";
// bloom do nível alto: força, raio e limiar de luminância (cena em espaço linear)
const BLOOM_FORCA = 0.55;
const BLOOM_RAIO = 0.45;
const BLOOM_LIMIAR = 0.72;
const DUR_SAIDA = 0.8; // s
const DUR_APRESSADA = 0.45; // s que sobram da chegada quando o giro começa no meio dela
const DUR_PULO = 0.75; // s que sobram da chegada depois de um toque na tela
/** No pulo: s reais em que a viagem se apaga onde está (no máximo 30% do que sobra). */
const DUR_APAGAR_PULO = 0.18;
/** Ponto do roteiro para onde o pulo salta: a estrela já está a ~0,2 u do pouso. */
const T_RETOMA = 6.4;
/** Câmera solta da perseguição (pulo/saída): o peso cai por exp(-dt·K), em tempo real. */
const K_SAIDA_PERSEG = 7.5;
/** ... e a pose de perseguição freia por exp(-dt·K) em vez de parar de uma vez. */
const K_FREIO_PERSEG = 6;
const IGNORA_TOQUE_MS = 300; // o toque que confirmou o CPF não pode pular a chegada
const EVENTO_CHEGADA = "roleta:chegada-concluida";
const EVENTO_FORMOU = "roleta:formou";
const INCLINACAO_ATIVA = -0.42;
const COS_INC = Math.cos(INCLINACAO_ATIVA);
const SIN_INC = Math.sin(INCLINACAO_ATIVA);

// ---------- roteiro da chegada (segundos do roteiro base de 8 s; a duração real comprime) ----------
const DUR_CHEGADA = 5; // entrada "estrela"
const DUR_CHEGADA_LEVE = 3.5;
const DUR_CHEGADA_CAD = 6; // entrada "cadentes" (viagem + revoada)
const DUR_CHEGADA_CAD_LEVE = 4;
const T_PARTIDA = 0.8; // fim do nascimento, a estrela parte
const T_POUSO = 6.6; // a estrela para no centro da roleta: supernova
const T_FIM = 8;
/** Perfil de velocidade da viagem (trapézio): fração acelerando e fração freando. */
const ACEL = 0.14;
const FREIO = 0.22;
const VMAX = 1 / (1 - ACEL / 2 - FREIO / 2);
const D_ATRAS = 2.2; // distância (ao longo da curva) da câmera de perseguição atrás da estrela
const CAIXA_WARP = 22; // lado do cubo de riscos que acompanha a câmera
const N_GRUPOS = 5; // constelações do céu (criarConstelacoes)
const GRUPOS_ACESOS = 3;
const MAX_AMOSTRAS = 90; // janela da avaliação de desempenho (quadros)
const Z_CENTRO = 0.085; // centro do medalhão: onde a estrela viajante/as cadentes se juntam

// ---------- medalhão do centro (logo da empresa) ----------
const URL_LOGO = "/marca/logo-oncologygroup.webp";
const PROPORCAO_LOGO = 1009 / 2000; // altura / largura do arquivo
const R_MEDALHAO = 0.2; // os rótulos da face começam em 0,24
const Z_MEDALHAO = 0.08; // topo do cubo
const LARGURA_LOGO = 0.8; // fração do diâmetro do disco ocupada pela logo
/** Com bloom (cena linear, limiar BLOOM_LIMIAR): o disco claro fica logo abaixo do limiar. */
const BRILHO_DISCO_BLOOM = 0.74;
const BRILHO_LOGO_BLOOM = 0.88;

// ---------- estrelas cadentes (entrada e explosão do resultado) ----------
/** Cores da logo, na ordem do arco do aro; as escuras são clareadas (corLogo) para o fundo escuro. */
const CORES_LOGO = ["#0a8fd6", "#e98300", "#a873a8", "#009a8e", "#4fb3b5", "#76b72a", "#00205b", "#f2d42a", "#a50f15"] as const;
const N_CORES_LOGO = CORES_LOGO.length;
/** Parâmetros por cadente (Float32Array, passo NP): ver prepararCadentes/prepararExplosao. */
const NP = 20;
const P_OF = 0; // entrada: deslocamento na revoada (lado, cima, frente no referencial do líder)
const P_OA = 3; // entrada: amplitude da ondulação de cada eixo
const P_OFASE = 6; // entrada: fase da ondulação de cada eixo
const P_OW = 9; // entrada: frequência da ondulação (rad por s do roteiro)
const P_P0 = 0; // explosão: origem
const P_T0 = 3; // explosão: velocidade (u/s)
const P_E = 6; // explosão: vetor de curva (u/s²)
const P_T_INI = 12; // instante em que aparece (roteiro | s reais)
const P_T_ESP = 13; // entrada: instante em que entra na espiral | explosão: duração da vida
const P_R_E = 14; // entrada: raio da espiral na entrada
const P_FI_E = 15; // entrada: ângulo (horário desde as 12h, no disco) na entrada
const P_H0 = 16; // entrada: altura acima do disco na entrada
/** Espiral: ângulo percorrido = ESP_A·k + ESP_B·k² (k = 0..1), ~1,75 volta acelerando. */
const ESP_A = 5;
const ESP_B = 6;
/** s do roteiro antes da entrada na espiral em que a revoada começa a virar espiral. */
const MISTURA_ESP = 0.6;
const LAG_RASTRO_CAD = 0.22; // s do roteiro cobertos pelo rastro de cada cadente na entrada
const LAG_RASTRO_EXP = 0.3; // s reais cobertos pelo rastro na explosão do resultado
/** Referencial do líder por amostra de rastro: posição, lado, cima, frente (12 floats). */
const NQ = 12;

// ---------- celebração ao parar (s reais) ----------
const DUR_CELEBRA = 3;
const BRILHO_FATIA_FINAL = 0.35; // a fatia vencedora fica levemente acesa até sair do resultado

/**
 * Pontos fixos da rota, no mundo. Antes deles vêm o nascimento (centro da tela) e um ponto
 * logo à frente; depois, o centro da roleta. Passa entre constelações e entre as fitas;
 * ~51 unidades, ~11 u/s no cruzeiro, raio de curva mínimo ~1 (sem quinas para a câmera).
 */
const ROTA: readonly (readonly [number, number, number])[] = [
  [-2.0, 0.1, -6.2], // entre as duas constelações da esquerda, entre as fitas
  [-0.6, 1.3, -10.5], // por baixo da constelação do alto
  [1.5, 0.8, -14.4], // fundo do céu: curva larga para a direita
  [4.2, 0.3, -15.4],
  [6.4, -0.2, -13.4],
  [6.4, -0.1, -10.2], // voltando
  [4.5, 0.5, -6.4], // rente à constelação da direita
  [4.4, 0.9, 0.4], // ao lado da roleta, entre as fitas
  [4.4, 1.1, 3.0], // laço do lado da câmera
  [3.9, 1.25, 4.4],
  [2.7, 1.35, 4.95],
  [1.5, 1.1, 4.4],
  [1.0, 0.85, 3.2], // aproximação final
];

type ModoRevelacao = "oculta" | "chegando" | "visivel" | "saindo";

// ---------- easing (tudo em função do tempo) ----------
const saturar = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const faixa = (x: number, a: number, b: number) => saturar((x - a) / (b - a));
function suave(x: number, a: number, b: number): number {
  const k = faixa(x, a, b);
  return k * k * (3 - 2 * k);
}
const inOutCubic = (k: number) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const outCubic = (k: number) => 1 - (1 - k) ** 3;
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

/** Posição (0..1, por comprimento de arco) da viagem no instante tau: trapézio acelera/cruza/freia. */
function sDoRoteiro(tau: number): number {
  const k = faixa(tau, T_PARTIDA, T_POUSO);
  if (k < ACEL) return (VMAX * k * k) / (2 * ACEL);
  if (k < 1 - FREIO) return saturar(VMAX * (ACEL / 2 + k - ACEL));
  const r = 1 - k;
  return saturar(1 - (VMAX * r * r) / (2 * FREIO));
}

export type EntradaCena = "cadentes" | "estrela";

export interface OpcoesCena {
  nivel: NivelQualidade;
  obterCelula: () => DOMRect | null;
  aoFalhar: (motivo: string) => void;
  /** animação de chegada da roleta; ausente = "cadentes" */
  entrada?: EntradaCena;
}

/** Cor da logo em espaço de trabalho (linear); tons muito escuros sobem de luminosidade (sRGB HSL). */
function corLogo(hex: string, alvo = new Color()): Color {
  alvo.set(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  alvo.getHSL(hsl, SRGBColorSpace);
  if (hsl.l < 0.45) alvo.setHSL(hsl.h, hsl.s, 0.45, SRGBColorSpace);
  return alvo;
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
function matcap(base: string, luz: string, sombra: string, lado = 128): CanvasTexture {
  if (lado > 128) return matcapRico(base, luz, sombra, lado);
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

/**
 * Matcap "de estúdio" para os níveis normal/alta: sombreamento esférico, luz principal
 * forte e pequena, luz de preenchimento, reflexo de horizonte e borda clara (fresnel).
 */
function matcapRico(base: string, luz: string, sombra: string, lado: number): CanvasTexture {
  return texturaCanvas(lado, (ctx, l) => {
    const c = l / 2;
    const r = l / 2;
    // corpo: degradê esférico
    const corpo = ctx.createRadialGradient(c * 0.82, c * 0.7, r * 0.05, c, c, r);
    corpo.addColorStop(0, luz);
    corpo.addColorStop(0.35, base);
    corpo.addColorStop(0.8, sombra);
    corpo.addColorStop(1, sombra);
    ctx.fillStyle = corpo;
    ctx.fillRect(0, 0, l, l);
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.clip();
    // reflexo de horizonte (faixa clara levemente curva, típica de metal polido)
    const horiz = ctx.createLinearGradient(0, c * 0.95, 0, c * 1.25);
    horiz.addColorStop(0, "rgba(255,255,255,0)");
    horiz.addColorStop(0.45, "rgba(255,255,255,0.28)");
    horiz.addColorStop(0.55, "rgba(255,255,255,0.05)");
    horiz.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = horiz;
    ctx.beginPath();
    ctx.ellipse(c, c * 1.1, r * 1.05, r * 0.22, 0, 0, Math.PI * 2);
    ctx.fill();
    // luz de preenchimento azulada embaixo à direita (céu da identidade)
    const fill = ctx.createRadialGradient(c * 1.45, c * 1.55, 0, c * 1.45, c * 1.55, r * 0.6);
    fill.addColorStop(0, "rgba(120,180,255,0.55)");
    fill.addColorStop(1, "rgba(120,180,255,0)");
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, l, l);
    // borda (fresnel): anel claro fino perto da silhueta
    const borda = ctx.createRadialGradient(c, c, r * 0.82, c, c, r);
    borda.addColorStop(0, "rgba(255,255,255,0)");
    borda.addColorStop(0.85, "rgba(200,220,255,0.28)");
    borda.addColorStop(1, "rgba(255,255,255,0.05)");
    ctx.fillStyle = borda;
    ctx.fillRect(0, 0, l, l);
    // luz principal: brilho pequeno e intenso, com halo suave
    const kx = c * 0.62;
    const ky = c * 0.5;
    const halo = ctx.createRadialGradient(kx, ky, 0, kx, ky, r * 0.42);
    halo.addColorStop(0, "rgba(255,255,255,0.75)");
    halo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, l, l);
    const nucleo = ctx.createRadialGradient(kx, ky, 0, kx, ky, r * 0.09);
    nucleo.addColorStop(0, "rgba(255,255,255,1)");
    nucleo.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = nucleo;
    ctx.fillRect(0, 0, l, l);
    ctx.restore();
  });
}

function texturaBrilho(cor: string, lado = 128): CanvasTexture {
  return texturaCanvas(lado, (ctx, l) => {
    const g = ctx.createRadialGradient(l / 2, l / 2, 0, l / 2, l / 2, l / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.18, cor);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, l, l);
  });
}

/**
 * Disco do medalhão: branco perolado com degradê suave (luz no alto à esquerda, borda um pouco
 * mais fechada) e um leve furta-cor; claro o bastante para o azul-marinho e o vermelho da logo
 * aparecerem, sem chegar ao branco puro.
 */
function texturaPerola(lado = 256): CanvasTexture {
  return texturaCanvas(lado, (ctx, l) => {
    const c = l / 2;
    const g = ctx.createRadialGradient(c * 0.72, c * 0.6, l * 0.02, c, c, c);
    g.addColorStop(0, "#fbfaf7");
    g.addColorStop(0.55, "#f1eee8");
    g.addColorStop(0.88, "#e2ddd6");
    g.addColorStop(1, "#cfc9c2");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, l, l);
    // furta-cor de pérola: rosado embaixo à direita, azulado em cima, bem suaves
    const rosa = ctx.createRadialGradient(c * 1.45, c * 1.5, 0, c * 1.45, c * 1.5, c * 0.9);
    rosa.addColorStop(0, "rgba(240,205,215,0.35)");
    rosa.addColorStop(1, "rgba(240,205,215,0)");
    ctx.fillStyle = rosa;
    ctx.fillRect(0, 0, l, l);
    const azul = ctx.createRadialGradient(c * 1.3, c * 0.45, 0, c * 1.3, c * 0.45, c * 0.7);
    azul.addColorStop(0, "rgba(200,220,240,0.3)");
    azul.addColorStop(1, "rgba(200,220,240,0)");
    ctx.fillStyle = azul;
    ctx.fillRect(0, 0, l, l);
  });
}

/** Máscara (no alfa) do halo da estrela viajante. */
function texturaHaloEstrela(lado = 128): CanvasTexture {
  return texturaCanvas(lado, (ctx, l) => {
    const c = l / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.07, "rgba(255,255,255,0.9)");
    g.addColorStop(0.18, "rgba(255,255,255,0.4)");
    g.addColorStop(0.45, "rgba(255,255,255,0.1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, l, l);
  });
}

/** Máscara (no alfa) dos raios em cruz: dois losangos finos com gradiente radial. */
function texturaRaios(lado = 256): CanvasTexture {
  return texturaCanvas(lado, (ctx, l) => {
    const c = l / 2;
    const g = ctx.createRadialGradient(c, c, 0, c, c, c);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.2, "rgba(255,255,255,0.5)");
    g.addColorStop(0.6, "rgba(255,255,255,0.12)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    const e = l * 0.016;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      ctx.beginPath();
      ctx.moveTo(c - dx * c, c - dy * c);
      ctx.lineTo(c + dy * e, c + dx * e);
      ctx.lineTo(c + dx * c, c + dy * c);
      ctx.lineTo(c - dy * e, c - dx * e);
      ctx.closePath();
      ctx.fill();
    }
  });
}

// tamanho limitado (proporcional à tela): estrelas que passam rente à câmera na viagem não
// viram manchas gigantes; no enquadramento normal nenhum ponto chega perto do limite
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
    gl_PointSize = min(uEscala * 0.06, aTam * uEscala * (0.7 + 0.3 * tw) / -mv.z);
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
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
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
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/**
 * Enxame de faíscas da celebração (resultado): tudo na GPU, sem atualização na CPU. `position`
 * guarda a velocidade inicial (u/s); a origem vem de uniforms (ponteiro ou fatia, por aFonte):
 * p = origem + v·(1 − e^(−k·t))/k + gravidade leve.
 */
const VERT_ENXAME = /* glsl */ `
  attribute float aAtraso;
  attribute float aVida;
  attribute float aFonte;
  attribute vec3 aCor;
  uniform vec3 uOrigemA;
  uniform vec3 uOrigemB;
  uniform float uT;
  uniform float uTempo;
  uniform float uEscala;
  varying vec3 vCor;
  varying float vA;
  void main() {
    float tt = max(0.0, uT - aAtraso);
    float vida = clamp(1.0 - tt / aVida, 0.0, 1.0);
    vec3 p = mix(uOrigemA, uOrigemB, aFonte) + position * ((1.0 - exp(-1.7 * tt)) / 1.7) + vec3(0.0, -0.28, 0.0) * tt * tt;
    float tw = 0.6 + 0.4 * sin(uTempo * 17.0 + aAtraso * 90.0);
    vA = step(0.0, uT - aAtraso) * vida * vida * tw;
    vCor = aCor;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = (vA <= 0.0 || mv.z > -0.1) ? 0.0 : min(uEscala * 0.05, (0.025 + 0.04 * vida) * uEscala / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG_ENXAME = /* glsl */ `
  uniform float uAlfa;
  varying vec3 vCor;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    float nucleo = smoothstep(0.16, 0.0, d);
    a = a * a * uAlfa * vA;
    gl_FragColor = vec4((vCor + vec3(0.9) * nucleo) * a, a);
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/**
 * Cabeças das estrelas cadentes: 1 ponto por cadente (posição e brilho atualizados na CPU),
 * halo colorido + núcleo branco + raios em cruz curtos. Tamanho limitado (passam rente à câmera).
 */
const VERT_CAD_CABECA = /* glsl */ `
  attribute float aBrilho;
  attribute float aTam;
  attribute vec3 aCor;
  uniform float uEscala;
  varying vec3 vCor;
  varying float vB;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vB = aBrilho;
    vCor = aCor;
    float tam = aTam * (0.65 + 0.35 * min(aBrilho, 1.6)) * uEscala / max(0.05, -mv.z);
    gl_PointSize = (aBrilho < 0.002 || mv.z > -0.1) ? 0.0 : clamp(tam, 2.0, uEscala * 0.07);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG_CAD_CABECA = /* glsl */ `
  uniform float uMestre;
  varying vec3 vCor;
  varying float vB;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d2 = dot(c, c);
    float halo = exp(-d2 * 26.0);
    float nucleo = exp(-d2 * 300.0);
    float raios = exp(-abs(c.x) * 70.0) * exp(-abs(c.y) * 8.0) + exp(-abs(c.y) * 70.0) * exp(-abs(c.x) * 8.0);
    vec3 cor = vCor * (halo * 0.9 + raios * 0.55) + vec3(1.0) * (nucleo * 1.5 + halo * halo * 0.25);
    gl_FragColor = vec4(cor * vB * uMestre, 1.0);
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/** Rastros das cadentes: todas as faixas numa só geometria (1 draw call); branco na cabeça, cor da logo na cauda. */
const VERT_CAD_RASTRO = /* glsl */ `
  attribute float aAo;
  attribute float aLado;
  attribute float aAlfa;
  attribute vec3 aCor;
  varying float vAo;
  varying float vLado;
  varying float vAlfa;
  varying vec3 vCor;
  void main() {
    vAo = aAo;
    vLado = aLado;
    vAlfa = aAlfa;
    vCor = aCor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_CAD_RASTRO = /* glsl */ `
  uniform float uMestre;
  varying float vAo;
  varying float vLado;
  varying float vAlfa;
  varying vec3 vCor;
  void main() {
    float b = 1.0 - abs(vLado);
    float nucleo = pow(b, 4.0) * 1.1 + b * 0.25;
    float desbota = pow(1.0 - vAo, 1.5);
    vec3 cor = mix(vec3(1.0, 0.97, 0.9), vCor, smoothstep(0.0, 0.22, vAo));
    gl_FragColor = vec4(cor * nucleo * desbota * vAlfa * uMestre, 1.0);
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/**
 * Destaque da fatia vencedora, no plano do disco (filho do disco: gira com ele). Ângulos no
 * referencial da roleta (horário desde as 12h, como os pinos): preenchimento pulsante, bordas
 * radiais e externa acesas e uma varredura de luz do centro para fora. Descarte cedo fora dela.
 */
const FRAG_SETOR = /* glsl */ `
  uniform float uIni;
  uniform float uLarg;
  uniform float uAlfa;
  uniform float uPulso;
  uniform float uVarre;
  uniform float uMestre;
  uniform vec3 uCor;
  varying vec2 vUv;
  varying vec2 vP;
  void main() {
    float r = length(vP);
    if (uAlfa < 0.002 || r > 1.04 || r < 0.14) discard;
    float rel = mod(atan(vP.x, vP.y) - uIni, 6.2831853);
    bool dentro = rel < uLarg;
    float dAng = dentro ? min(rel, uLarg - rel) : min(rel - uLarg, 6.2831853 - rel);
    float dB = dAng * max(r, 0.2); // distância (em arco) até a borda radial mais próxima
    if (!dentro && dB > 0.07) discard;
    float inteira = step(6.28, uLarg); // fatia única: sem bordas radiais
    float bordaLado = exp(-(dB / 0.016) * (dB / 0.016)) * smoothstep(0.14, 0.3, r) * step(r, 0.99) * (1.0 - inteira);
    float dExt = (r - 0.975) / 0.02;
    float bordaExt = exp(-dExt * dExt) * (dentro ? 1.0 : exp(-(dB / 0.03) * (dB / 0.03)));
    float ent = dentro ? 1.0 : 0.0;
    float fill = ent * (0.16 + 0.14 * uPulso) * smoothstep(0.16, 0.32, r) * (0.5 + 0.5 * r) * step(r, 0.99);
    float dv = (r - uVarre) / 0.09;
    float varre = ent * exp(-dv * dv) * 0.7;
    float borda = (bordaLado + bordaExt) * (0.75 + 0.5 * uPulso);
    vec3 cor = uCor * (fill + varre) + vec3(1.0, 0.93, 0.75) * borda;
    gl_FragColor = vec4(cor * uAlfa * uMestre, 1.0);
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/**
 * Face da roleta com revelação radial: amostra a MESMA CanvasTexture (sRGB, decodificada pela
 * GPU) e converte para a saída com colorspace_fragment. Com uRaio ≥ 1 e uBorda = 0 o resultado
 * é idêntico ao MeshBasicMaterial({ map, transparent }) de antes.
 */
const VERT_FACE = /* glsl */ `
  varying vec2 vUv;
  varying vec2 vP;
  void main() {
    vUv = uv;
    vP = position.xy;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_FACE = /* glsl */ `
  uniform sampler2D uMapa;
  uniform float uRaio;
  uniform float uBorda;
  uniform float uOpacidade;
  varying vec2 vUv;
  varying vec2 vP;
  void main() {
    vec4 tex = texture2D(uMapa, vUv);
    float r = length(vP);
    float dentro = 1.0 - smoothstep(uRaio - 0.05, uRaio, r);
    float db = (r - uRaio + 0.02) / 0.035;
    float borda = uBorda * exp(-db * db);
    vec3 cor = tex.rgb * dentro + vec3(1.0, 0.78, 0.42) * borda;
    float a = clamp(dentro + borda, 0.0, 1.0) * tex.a * uOpacidade;
    gl_FragColor = vec4(cor, a);
    #include <colorspace_fragment>
    #ifdef COR_CORRETA
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/** Estrela viajante: 1 quad virado para a câmera, halo + raios em cruz (2 máscaras) + núcleo. */
const VERT_UV = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_ESTRELA = /* glsl */ `
  uniform sampler2D uHalo;
  uniform sampler2D uRaios;
  uniform float uGiro;
  uniform float uBrilho;
  uniform float uRaiosForca;
  uniform float uMestre;
  uniform vec3 uCor;
  varying vec2 vUv;
  void main() {
    vec2 c = vUv - 0.5;
    float cs = cos(uGiro);
    float sn = sin(uGiro);
    vec2 r1 = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs);
    vec2 r2 = vec2(r1.x - r1.y, r1.x + r1.y) * 1.2; // cruz menor a 45°
    float halo = texture2D(uHalo, c * 1.7 + 0.5).a;
    float raios = texture2D(uRaios, r1 + 0.5).a + 0.35 * texture2D(uRaios, r2 + 0.5).a;
    float nucleo = exp(-dot(c, c) * 1500.0);
    vec3 cor = uCor * (halo * 0.95 + raios * uRaiosForca) + vec3(1.0) * (nucleo * 1.6 + halo * halo * 0.55);
    gl_FragColor = vec4(cor * uBrilho * uMestre, 1.0);
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/** Rastro: faixa sobre a própria curva, atrás da estrela; afina e desbota na cauda. */
const VERT_RASTRO = /* glsl */ `
  attribute float aAo;
  attribute float aLado;
  varying float vAo;
  varying float vLado;
  void main() {
    vAo = aAo;
    vLado = aLado;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_RASTRO = /* glsl */ `
  uniform float uAlfa;
  uniform float uMestre;
  uniform vec3 uCorCabeca;
  uniform vec3 uCorMeio;
  uniform vec3 uCorCauda;
  varying float vAo;
  varying float vLado;
  void main() {
    float b = 1.0 - abs(vLado);
    float nucleo = pow(b, 5.0) * 1.2 + b * 0.3;
    float desbota = pow(1.0 - vAo, 1.6);
    vec3 cor = mix(uCorCabeca, uCorMeio, smoothstep(0.0, 0.3, vAo));
    cor = mix(cor, uCorCauda, smoothstep(0.3, 1.0, vAo));
    gl_FragColor = vec4(cor * nucleo * desbota * uAlfa * uMestre, 1.0);
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/**
 * Riscos de velocidade (hiperespaço): cada risco tem uma base fixa num cubo que "dá a volta"
 * em torno da câmera (mod), e a ponta é esticada na direção do movimento. 1 draw call.
 */
const VERT_WARP = /* glsl */ `
  attribute float aPonta;
  attribute vec3 aCor;
  uniform vec3 uCam;
  uniform vec3 uVel;
  uniform float uEstica;
  uniform float uForca;
  uniform float uCaixa;
  varying vec3 vCor;
  varying float vA;
  void main() {
    vec3 rel = mod(position - uCam + 0.5 * uCaixa, uCaixa) - 0.5 * uCaixa;
    float d = length(rel);
    vec3 p = uCam + rel + uVel * uEstica * aPonta;
    vA = uForca * (1.0 - 0.85 * aPonta) * smoothstep(0.5 * uCaixa, 0.28 * uCaixa, d) * smoothstep(0.4, 1.6, d);
    vCor = aCor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG_WARP = /* glsl */ `
  uniform float uMestre;
  varying vec3 vCor;
  varying float vA;
  void main() {
    gl_FragColor = vec4(vCor * vA * uMestre, 1.0);
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/** Brilho de cada constelação (uniform array) lido por grupo, sem indexação dinâmica. */
const GLSL_ACESO = /* glsl */ `
  uniform float uAceso[${N_GRUPOS}];
  float acesoDe(float g) {
    float ac = 0.0;
    for (int i = 0; i < ${N_GRUPOS}; i++) ac += uAceso[i] * (1.0 - step(0.5, abs(g - float(i))));
    return ac;
  }
`;

/**
 * Ligações: linhas do grupo (nó→nó) e de cada nó até o alvo do grupo (a ponta segue uAlvos:
 * a estrela viajante, ou a cadente que acendeu aquela constelação).
 */
const VERT_LIGACOES = /* glsl */ `
  attribute float aPonta;
  attribute float aGrupo;
  attribute float aTipo;
  uniform vec3 uAlvos[${N_GRUPOS}];
  ${GLSL_ACESO}
  varying float vA;
  varying float vPonta;
  varying float vTipo;
  vec3 alvoDe(float g) {
    vec3 a = vec3(0.0);
    for (int i = 0; i < ${N_GRUPOS}; i++) a += uAlvos[i] * (1.0 - step(0.5, abs(g - float(i))));
    return a;
  }
  void main() {
    vA = acesoDe(aGrupo);
    vPonta = aPonta;
    vTipo = aTipo;
    vec3 p = mix(position, alvoDe(aGrupo), aPonta);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const FRAG_LIGACOES = /* glsl */ `
  uniform float uTempo;
  uniform float uMestre;
  varying float vA;
  varying float vPonta;
  varying float vTipo;
  void main() {
    float pulso = 0.5 + 0.5 * sin(vPonta * 18.0 - uTempo * 14.0);
    float aEstrela = vA * (0.3 + 0.7 * pulso) * (0.45 + 0.55 * vPonta);
    float a = mix(vA * 0.85, aEstrela, vTipo) * uMestre;
    vec3 cor = mix(vec3(0.62, 0.76, 1.0), vec3(1.0, 0.86, 0.55), vTipo);
    gl_FragColor = vec4(cor * a, 1.0);
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/** Nós das constelações que acendem quando a estrela passa. */
const VERT_NOS = /* glsl */ `
  attribute float aGrupo;
  attribute float aTam;
  uniform float uEscala;
  ${GLSL_ACESO}
  varying float vA;
  void main() {
    float ac = acesoDe(aGrupo);
    vA = ac;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = ac < 0.002 ? 0.0 : min(uEscala * 0.08, aTam * (0.7 + 1.5 * ac) * uEscala / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG_NOS = /* glsl */ `
  uniform float uMestre;
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    float nucleo = smoothstep(0.12, 0.0, d);
    vec3 cor = vec3(1.0, 0.86, 0.55) * a * a + vec3(1.0) * nucleo;
    gl_FragColor = vec4(cor * vA * uMestre, 1.0);
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

/**
 * Anel da transformação, no plano do disco: onda de choque que se expande e arco de luz que
 * percorre o aro (horário, a partir das 12h) com uma estrela na cabeça. O quad cresce com a
 * onda (uRaioQuad) para não pintar a tela inteira à toa.
 */
const VERT_ANEL = /* glsl */ `
  uniform float uRaioQuad;
  varying vec2 vP;
  void main() {
    vP = position.xy * uRaioQuad;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG_ANEL = /* glsl */ `
  uniform float uOnda;
  uniform float uAlfaOnda;
  uniform float uArco;
  uniform float uAlfaArco;
  uniform float uMestre;
  uniform float uCoresMix;
  uniform vec3 uCoresArco[${N_CORES_LOGO}];
  varying vec2 vP;
  // cores da logo em volta do aro (horário desde as 12h), com transição suave entre vizinhas
  vec3 corArco(float ang) {
    float f = ang / 6.2831853 * ${N_CORES_LOGO}.0;
    vec3 c = vec3(0.0);
    float soma = 0.0;
    for (int i = 0; i < ${N_CORES_LOGO}; i++) {
      float d = abs(f - float(i) - 0.5);
      d = min(d, ${N_CORES_LOGO}.0 - d);
      float w = max(0.0, 1.0 - d);
      c += uCoresArco[i] * w;
      soma += w;
    }
    return c / max(soma, 0.001);
  }
  void main() {
    float r = length(vP);
    float esp = 0.04 + 0.1 * uOnda;
    float dOnda = (r - uOnda) / esp;
    // descarte cedo (antes de atan/exp): fora da coroa da onda e do seu recheio, e longe do aro
    // (a cabeça do arco e a cruz cabem na faixa ALCANCE_ARO em torno dele)
    bool naOnda = uAlfaOnda > 0.002 && (abs(dOnda) < 3.0 || (r < uOnda && uAlfaOnda > 0.08));
    bool noAro = uAlfaArco > 0.002 && abs(r - 1.005) < ALCANCE_ARO;
    if (!naOnda && !noAro) discard;
    float onda = exp(-dOnda * dOnda) + 0.12 * step(r, uOnda) * (r / max(uOnda, 0.001));
    onda *= uAlfaOnda;
    float arco = min(uArco, 6.2831853);
    float ang = mod(atan(vP.x, vP.y), 6.2831853);
    float atras = arco - ang;
    float rastro = step(0.0, atras) * (0.3 + 0.7 * exp(-atras * 1.6));
    float dAro = (r - 1.005) / 0.028;
    float faixaAro = exp(-dAro * dAro);
    vec2 d = vP - vec2(sin(arco), cos(arco)) * 1.005;
    float cabeca = 0.0009 / (dot(d, d) + 0.0009);
    #if COM_CRUZ
    float cruz = exp(-abs(d.x) * 90.0) * exp(-abs(d.y) * 9.0) + exp(-abs(d.y) * 90.0) * exp(-abs(d.x) * 9.0);
    #else
    float cruz = 0.0;
    #endif
    float luzRastro = faixaAro * rastro * uAlfaArco;
    float luz = (cabeca * 1.4 + cruz * 0.8) * uAlfaArco;
    // entrada cadentes / celebração: o rastro do arco pinta o aro com as cores da logo
    vec3 corRastro = vec3(1.0, 0.9, 0.62);
    if (uCoresMix > 0.001 && luzRastro > 0.001) corRastro = mix(corRastro, corArco(ang) * 1.3 + 0.08, uCoresMix);
    vec3 cor = vec3(1.0, 0.86, 0.55) * onda + corRastro * luzRastro + vec3(1.0, 0.9, 0.62) * luz;
    gl_FragColor = vec4(cor * uMestre, 1.0);
    #ifdef COR_CORRETA
    // converte só o TOM para a saída (sRGB); a intensidade (queda do brilho) fica como foi ajustada
    float pico = max(max(gl_FragColor.r, gl_FragColor.g), gl_FragColor.b);
    if (pico > 0.0) gl_FragColor.rgb = sRGBTransferOETF(vec4(gl_FragColor.rgb / pico, 1.0)).rgb * pico;
    #ifdef NO_ALVO_HDR
    // bloom: a cena vai para um alvo linear e o OutputPass converte no fim; volta o valor "de tela" para linear
    gl_FragColor.rgb = sRGBTransferEOTF(vec4(gl_FragColor.rgb, 1.0)).rgb;
    #endif
    // sem NaN/infinito: no alvo HDR do bloom eles se espalham e apagam a tela
    gl_FragColor = (any(isnan(gl_FragColor)) || any(isinf(gl_FragColor))) ? vec4(0.0) : clamp(gl_FragColor, 0.0, 16.0);
    #endif
  }
`;

interface Faisca {
  vida: number;
  pos: Vector3;
  vel: Vector3;
}

interface GrupoConstelacao {
  centro: Vector3;
  nos: Vector3[];
  /** distância mínima da rota atual ao centro (calculada a cada chegada) */
  dMin: number;
  ativo: boolean;
  memoria: number;
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
  private uFace: { uMapa: { value: CanvasTexture }; uRaio: { value: number }; uBorda: { value: number }; uOpacidade: { value: number } };
  private lateral: Mesh;
  private fundo: Mesh;
  private aro: Mesh;
  private cubo: Mesh;
  private anelCubo: Mesh;
  /** medalhão do centro: disco perolado + logo (o anel dourado é o anelCubo) */
  private medalhao = new Group();
  private matDisco: MeshBasicMaterial;
  private matLogo: MeshBasicMaterial;
  private logo: Mesh;
  private logoCarregada = false;
  private brilho: Mesh;
  private matBrilho: MeshBasicMaterial;
  private matrizPino = new Matrix4();
  private pinoEmitido = new Uint8Array(MAX_PINOS);
  /** ângulo (horário, desde as 12h) já percorrido pelo arco de luz; Infinity = pinos prontos */
  private arcoPinos = Infinity;
  private thetaAtual = 0;

  // ---------- chegada: estrela viajante (até 6 draw calls extras, só durante a chegada) ----------
  private uMestre = { value: 1 }; // apaga tudo da viagem de uma vez (saída no meio)
  private estrelaViajante: Mesh;
  private uEstrela = {
    uHalo: { value: null as CanvasTexture | null },
    uRaios: { value: null as CanvasTexture | null },
    uGiro: { value: 0 },
    uBrilho: { value: 0 },
    uRaiosForca: { value: 1 },
    uMestre: this.uMestre,
    uCor: { value: new Color("#ffd98a") },
  };
  private rastro: Mesh;
  private nRastro: number;
  private pontosRastro: Float32Array;
  private uRastro = {
    uAlfa: { value: 1 },
    uMestre: this.uMestre,
    uCorCabeca: { value: new Color("#fff1c9") },
    uCorMeio: { value: new Color(LUZES[4]) },
    uCorCauda: { value: new Color(LUZES[0]) },
  };
  private warp: LineSegments;
  private uWarp = {
    uCam: { value: new Vector3() },
    uVel: { value: new Vector3() },
    uEstica: { value: 0 },
    uForca: { value: 0 },
    uCaixa: { value: CAIXA_WARP },
    uMestre: this.uMestre,
  };
  private gruposConst: GrupoConstelacao[] = [];
  private aceso = new Float32Array(N_GRUPOS);
  private ligacoes!: LineSegments;
  private nosAcesos!: Points;
  /** ponta das ligações de cada constelação (estrela viajante ou a cadente escolhida) */
  private alvosLig: Vector3[] = Array.from({ length: N_GRUPOS }, () => new Vector3());
  /** cadentes: índice da cadente ligada a cada constelação enquanto ela está acesa (-1 = nenhuma) */
  private cadDoGrupo = new Int8Array(N_GRUPOS).fill(-1);
  private anel: Mesh;
  private uAnel = {
    uRaioQuad: { value: 1.2 },
    uOnda: { value: 0 },
    uAlfaOnda: { value: 0 },
    uArco: { value: 0 },
    uAlfaArco: { value: 0 },
    uMestre: this.uMestre,
    uCoresMix: { value: 0 },
    uCoresArco: { value: new Float32Array(N_CORES_LOGO * 3) },
  };

  // ---------- estrelas cadentes (2 draw calls: faixas dos rastros + cabeças) ----------
  /** entrada desta chegada (lida das opções a cada chegada) */
  private entradaAtual: EntradaCena = "cadentes";
  /** 0 = desligadas, 1 = entrada (tempo do roteiro), 2 = explosão do resultado (s reais) */
  private modoCadentes: 0 | 1 | 2 = 0;
  private nCad: number;
  private nRastroCad: number;
  private cadParam: Float32Array;
  private cadAmostras: Float32Array;
  /** referencial do líder (NQ floats) em cada instante amostrado pelos rastros (j = 0: agora) */
  private cadLider: Float32Array;
  private cadCabecas!: Points;
  private cadRastros!: Mesh;
  /** cores (linear) de cada cadente: rgb por cadente */
  private cadCores: Float32Array;
  private uCad = { uMestre: this.uMestre, uEscala: this.uniformesComuns.uEscala };
  private vEsp = new Vector3();
  private formouEmitido = false;

  // ---------- celebração ao parar ----------
  private setor: Mesh;
  private uSetor = {
    uIni: { value: 0 },
    uLarg: { value: 0 },
    uAlfa: { value: 0 },
    uPulso: { value: 0 },
    uVarre: { value: 0 },
    uMestre: this.uMestre,
    uCor: { value: new Color("#ffd98a") },
  };
  /** s reais desde o início da celebração; < 0 = sem celebração */
  private tCelebra = -1;
  /** 1 durante o resultado; cai para 0 ao sair dele (apaga a celebração sem corte) */
  private mestreCelebra = 0;
  private origemPonteiro = new Vector3();
  private origemFatia = new Vector3();

  // rota da viagem (pontos pré-alocados; a curva é refeita uma vez por chegada)
  private pontosCurva: Vector3[] = Array.from({ length: ROTA.length + 3 }, () => new Vector3());
  private curva = new CatmullRomCurve3(this.pontosCurva, false, "centripetal");
  private compCurva = 0;
  private velCruzeiro = 0;
  private sViagem = 0;
  private velViagem = 0;
  private viagemPendente = false;
  private supernovaEmitida = false;
  /** 0 = câmera no enquadramento da célula, 1 = câmera de perseguição */
  private pesoPerseguicao = 0;
  /** posição (0..1) na curva usada pela pose de perseguição; = sViagem até a câmera se soltar */
  private sPerseg = 0;
  /** velocidade (fração da curva por s real) da pose solta; freia sozinha */
  private velPerseg = 0;
  /** pulo/saída: a câmera deixa de seguir o roteiro e sai da perseguição em tempo real */
  private perseguicaoSolta = false;
  /** pulo: s reais que faltam para a viagem terminar de se apagar (o roteiro fica parado) */
  private apagarRestante = 0;
  private apagarTotal = 0;
  /** pulo: s reais do salto do roteiro (T_RETOMA) até o fim da chegada */
  private durRetomada = 0;
  /** o roteiro saltou para perto do pouso: o rastro antigo não volta */
  private saltouRoteiro = false;
  /** brilho geral da viagem nesta chegada (apaga no pulo, reacende no pouso) */
  private mestreChegada = 1;
  private rolagemPerseg = 0;

  // vetores de trabalho (nada é alocado por quadro)
  private vA = new Vector3();
  private vB = new Vector3();
  private vT1 = new Vector3();
  private vEstrela = new Vector3();
  private vTanEstrela = new Vector3();
  private vBase = new Vector3();
  private vTanCam = new Vector3();
  private vLado = new Vector3();
  private vCima = new Vector3();
  private vLadoRastro = new Vector3(1, 0, 0);
  private posEnq = new Vector3();
  private posPerseg = new Vector3();
  private alvoPerseg = new Vector3();

  // revelação da roleta: 0 = só a tela de CPF, 1 = roleta inteira no lugar
  private modoRevelacao: ModoRevelacao = "oculta";
  private revelacao = 0;
  private tRevelacao = 0;
  /** tempo no roteiro base (0..T_FIM) */
  private tau = 0;
  private dtRoteiro = 0;
  private durChegada: number;
  private fatorChegada = 1;
  private inicioChegada = 0;
  private rSaida = 1;
  private brilhoSaidaEmitido = false;
  private reavaliado = false;
  private distBase = 7;
  private primeiraFase = true;

  private fatias: Fatia[] = [];
  private fase: Fase = "carregando";
  private leve: boolean;
  private nivel: NivelQualidade;
  private perfil: PerfilQualidade;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private quadro = 0;
  private ultimoT = 0;
  private acumulado = 0;
  private indicePonteiro = -2;
  private balanco = 0;
  private inclinacaoAtual = 0;
  /** amplitude da deriva/parallax e elevação extra da fase ativa, amortecidas (sem salto) */
  private ampAtual = 1;
  private elAtivo = 0;
  private aproximacao = 0;
  private parallax = { x: 0, y: 0, ax: 0, ay: 0 };
  /** amostras da avaliação inicial, mantidas ORDENADAS (inserção): mediana sem alocar */
  private amostrasQuadro = new Float32Array(MAX_AMOSTRAS);
  private nAmostras = 0;
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
    this.nivel = opcoes.nivel;
    this.perfil = PERFIS[opcoes.nivel];
    this.leve = opcoes.nivel === "leve";
    this.ampAtual = this.leve ? 0 : 1;
    // redefinida a cada chegada pela entrada escolhida (iniciarChegada)
    this.durChegada = this.leve ? DUR_CHEGADA_CAD_LEVE : DUR_CHEGADA_CAD;
    this.renderer = new WebGLRenderer({ antialias: this.perfil.antialias, alpha: false, stencil: false, powerPreference: "high-performance" });
    this.renderer.setClearColor(new Color(COR_FUNDO));
    this.dprAtual = Math.min(window.devicePixelRatio || 1, this.perfil.dprMax);
    // teto de pixels: em telas 4K o DPR alto custaria caro demais (nunca abaixo de 1)
    const pixelsTela = Math.max(1, window.innerWidth * window.innerHeight);
    this.dprAtual = Math.max(Math.min(1, this.dprAtual), Math.min(this.dprAtual, Math.sqrt(this.perfil.pixelsMax / pixelsTela)));
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
    this.matHalo = new MeshBasicMaterial({ map: texturaBrilho("rgba(90,140,255,0.45)", this.perfil.ladoSprite), transparent: true, depthWrite: false, blending: AdditiveBlending });
    this.halo = new Mesh(new PlaneGeometry(R * 4.2, R * 4.2), this.matHalo);
    this.halo.position.z = -0.6;
    this.cena.add(this.halo);

    // ---------- roleta ----------
    this.cena.add(this.inclinacao);
    this.inclinacao.add(this.disco);

    // o canvas já nasce no tamanho final: a textura não pode subir para a GPU num tamanho e mudar depois
    this.canvasFace.width = this.canvasFace.height = this.perfil.ladoFace;
    this.texturaFace = new CanvasTexture(this.canvasFace);
    this.texturaFace.colorSpace = SRGBColorSpace;
    this.texturaFace.anisotropy = Math.min(this.perfil.anisotropia, this.renderer.capabilities.getMaxAnisotropy());
    // transparente (depthWrite continua ligado) e com revelação radial na chegada
    this.uFace = { uMapa: { value: this.texturaFace }, uRaio: { value: 2 }, uBorda: { value: 0 }, uOpacidade: { value: 1 } };
    const matFace = new ShaderMaterial({ uniforms: this.uFace, vertexShader: VERT_FACE, fragmentShader: FRAG_FACE, transparent: true });
    this.face = new Mesh(new CircleGeometry(R, 96), matFace);
    this.face.position.z = 0.001;
    this.disco.add(this.face);

    const metal = new MeshMatcapMaterial({ matcap: matcap("#8fa3d0", "#ffffff", "#1c2134", this.perfil.ladoMatcap) });
    const ouro = new MeshMatcapMaterial({ matcap: matcap("#ffcf6b", "#fffbe8", "#7a4a12", this.perfil.ladoMatcap) });
    const azulEscuro = new MeshMatcapMaterial({ matcap: matcap("#22345f", "#6982b0", "#050a1a", this.perfil.ladoMatcap) });
    this.descartaveis.push(metal, ouro, azulEscuro);

    this.lateral = new Mesh(new CylinderGeometry(R, R * 0.97, 0.14, 96, 1, true), azulEscuro);
    this.lateral.rotation.x = Math.PI / 2;
    this.lateral.position.z = -0.07;
    this.inclinacao.add(this.lateral);
    this.fundo = new Mesh(new CircleGeometry(R * 0.97, 64), new MeshBasicMaterial({ color: "#050a1a" }));
    this.fundo.position.z = -0.14;
    this.fundo.rotation.y = Math.PI;
    this.inclinacao.add(this.fundo);

    this.aro = new Mesh(new TorusGeometry(R * 1.005, 0.035, this.leve ? 12 : 24, this.leve ? 120 : 200), metal);
    this.inclinacao.add(this.aro);

    this.pinos = new InstancedMesh(new SphereGeometry(0.028, this.leve ? 10 : 20, this.leve ? 8 : 14), ouro, MAX_PINOS);
    this.pinos.count = 0;
    this.disco.add(this.pinos);

    this.cubo = new Mesh(new CylinderGeometry(R_MEDALHAO + 0.005, R_MEDALHAO + 0.025, 0.08, 48), azulEscuro);
    this.cubo.rotation.x = Math.PI / 2;
    this.cubo.position.z = 0.04;
    this.inclinacao.add(this.cubo);
    // anel metálico fino (ouro com reflexo prateado do matcap) em volta do medalhão
    this.anelCubo = new Mesh(new TorusGeometry(R_MEDALHAO + 0.004, 0.009, this.leve ? 8 : 16, this.leve ? 64 : 96), ouro);
    this.anelCubo.position.z = Z_MEDALHAO;
    this.inclinacao.add(this.anelCubo);

    // medalhão: disco perolado (opaco) + logo por cima (transparente), ambos sem luz
    this.matDisco = new MeshBasicMaterial({ map: texturaPerola(Math.max(256, Math.min(512, this.perfil.ladoSprite))) });
    const disco = new Mesh(new CircleGeometry(R_MEDALHAO, 64), this.matDisco);
    disco.position.z = 0.0015;
    this.medalhao.add(disco);
    // até a logo chegar, um texel transparente: o programa do shader já nasce com "map"
    const provisoria = new DataTexture(new Uint8Array(4), 1, 1);
    provisoria.colorSpace = SRGBColorSpace;
    provisoria.needsUpdate = true;
    this.descartaveis.push(provisoria);
    this.matLogo = new MeshBasicMaterial({ map: provisoria, transparent: true, depthWrite: false });
    const larguraLogo = 2 * R_MEDALHAO * LARGURA_LOGO;
    this.logo = new Mesh(new PlaneGeometry(larguraLogo, larguraLogo * PROPORCAO_LOGO), this.matLogo);
    this.logo.position.z = 0.003;
    this.medalhao.add(this.logo);
    this.medalhao.position.z = Z_MEDALHAO;
    this.inclinacao.add(this.medalhao);
    this.carregarLogo();

    // brilho especular que NÃO gira (vende o volume)
    this.matBrilho = new MeshBasicMaterial({
      map: texturaCanvas(Math.max(256, Math.min(1024, this.perfil.ladoSprite)), (ctx, l) => {
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

    // ---------- celebração: faíscas que saem do ponteiro e da fatia vencedora ----------
    this.matEnxame = new ShaderMaterial({
      uniforms: {
        uOrigemA: { value: this.origemPonteiro },
        uOrigemB: { value: this.origemFatia },
        uT: { value: 0 },
        uTempo: this.uniformesComuns.uTempo,
        uEscala: this.uniformesComuns.uEscala,
        uAlfa: { value: 0 },
      },
      vertexShader: VERT_ENXAME,
      fragmentShader: FRAG_ENXAME,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.descartaveis.push(this.matEnxame);
    this.enxame = this.criarEnxame(this.leve ? 240 : 700);
    this.enxame.visible = false;
    // a face é transparente: enxame e faíscas vão depois dela
    this.enxame.renderOrder = 2;
    this.cena.add(this.enxame);

    this.faiscas = this.criarFaiscas(160);
    this.faiscas.renderOrder = 2;
    this.cena.add(this.faiscas);

    // ---------- chegada: estrela viajante ----------
    this.estrelaViajante = this.criarEstrelaViajante();
    this.cena.add(this.estrelaViajante);
    this.nRastro = this.leve ? 36 : 64;
    this.pontosRastro = new Float32Array(this.nRastro * 3);
    this.rastro = this.criarRastro(this.nRastro);
    this.cena.add(this.rastro);
    this.warp = this.criarWarp(this.leve ? 160 : 560);
    this.cena.add(this.warp);
    this.criarLigacoes();
    this.anel = this.criarAnel();
    this.inclinacao.add(this.anel);
    const cores = this.uAnel.uCoresArco.value;
    const cTmp = new Color();
    CORES_LOGO.forEach((hex, i) => corLogo(hex, cTmp).toArray(cores, i * 3));

    // ---------- estrelas cadentes (entrada e explosão do resultado) ----------
    this.nCad = this.leve ? 10 : this.nivel === "alta" ? 24 : 18;
    this.nRastroCad = this.leve ? 14 : 22;
    this.cadParam = new Float32Array(this.nCad * NP);
    this.cadAmostras = new Float32Array(this.nRastroCad * 3);
    this.cadLider = new Float32Array(this.nRastroCad * NQ);
    this.cadCores = new Float32Array(this.nCad * 3);
    this.criarCadentes();

    // ---------- destaque da fatia vencedora ----------
    this.setor = new Mesh(
      new CircleGeometry(R * 1.04, 96),
      new ShaderMaterial({
        uniforms: this.uSetor,
        vertexShader: VERT_FACE,
        fragmentShader: FRAG_SETOR,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    );
    this.setor.position.z = 0.006;
    this.setor.renderOrder = 2;
    this.setor.visible = false;
    this.disco.add(this.setor);

    if (this.perfil.bloom) this.ligarBloom();
    this.ajustarBrilhoMedalhao();
    this.redimensionar();
    window.addEventListener("resize", this.redimensionar);
    window.addEventListener("pointermove", this.moverPonteiro, { passive: true });
    window.addEventListener("pointerdown", this.tocarFundo, { passive: true });
    document.fonts?.ready.then(() => !this.destruido && this.redesenharFace());

    // pré-compila os shaders antes da 1ª chegada; falha de shader = volta para o 2D
    // (peças da viagem e enxame ficam visíveis só durante a compilação)
    this.renderer.debug.onShaderError = () => this.falhar("falha ao compilar shader");
    const daViagem: { visible: boolean }[] = [
      this.estrelaViajante, this.rastro, this.warp, this.ligacoes, this.nosAcesos, this.anel, this.enxame,
      this.cadCabecas, this.cadRastros, this.setor,
    ];
    daViagem.forEach((o) => (o.visible = true));
    // níveis normal/alta: todos os shaders próprios convertem a cor para a saída (sRGB), como a face
    if (!this.leve) this.ligarCorCorreta();
    this.renderer.compile(this.cena, this.camera);
    if (this.composer) {
      try {
        this.composer.render();
      } catch {
        this.desligarBloom();
      }
    }
    this.enxame.visible = false;
    this.setor.visible = false;
    // a logo foi compilada com a textura provisória; só aparece quando o arquivo chegar
    this.logo.visible = this.logoCarregada;
    this.aplicarOculta();
    this.avisarNivel();
    this.quadro = requestAnimationFrame(this.passo);
  }

  // ---------- construção ----------
  /**
   * Logo do medalhão (WebP com fundo transparente): sRGB, mipmaps, anisotropia do perfil. Sobe
   * para a GPU assim que carrega; se o arquivo faltar ou falhar, fica só o medalhão.
   */
  private carregarLogo() {
    new TextureLoader().load(
      URL_LOGO,
      (tex: Texture) => {
        if (this.destruido) {
          tex.dispose();
          return;
        }
        tex.colorSpace = SRGBColorSpace;
        tex.generateMipmaps = true;
        tex.anisotropy = Math.min(this.perfil.anisotropia, this.renderer.capabilities.getMaxAnisotropy());
        tex.needsUpdate = true;
        this.descartaveis.push(tex);
        this.matLogo.map = tex;
        this.matLogo.needsUpdate = true;
        try {
          this.renderer.initTexture(tex);
        } catch {
          /* sobe no primeiro quadro em que aparecer */
        }
        this.logoCarregada = true;
        this.logo.visible = true;
      },
      undefined,
      () => {
        if (!this.destruido) console.warn(`Logo do medalhão indisponível (${URL_LOGO}); seguindo só com o medalhão.`);
      },
    );
  }

  /**
   * Medalhão sem luz (MeshBasic): sem bloom sai como desenhado; com bloom (cena linear, limiar
   * BLOOM_LIMIAR) o disco claro fica logo abaixo do limiar, para não virar uma mancha de luz.
   */
  private ajustarBrilhoMedalhao() {
    const bloom = !!this.composer;
    this.matDisco.color.setScalar(bloom ? BRILHO_DISCO_BLOOM : 1);
    this.matLogo.color.setScalar(bloom ? BRILHO_LOGO_BLOOM : 1);
  }

  private criarEstrelas(): Points {
    const n = this.leve ? 900 : 1800;
    // casca de estrelas ao redor de toda a cena, só nas direções que a câmera final NÃO vê:
    // dá céu à viagem quando a câmera olha para trás/lados, sem mudar o fundo final
    const nCasca = this.leve ? 900 : 2200;
    const total = n + nCasca;
    const rnd = gerador(11);
    const pos = new Float32Array(total * 3);
    const tam = new Float32Array(total);
    const fase = new Float32Array(total);
    const cor = new Float32Array(total * 3);
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
    const rc = gerador(23);
    for (let i = n; i < total; i++) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let tentativa = 0; tentativa < 24; tentativa++) {
        const th = rc() * TAU;
        const cz = rc() * 2 - 1;
        const s = Math.sqrt(1 - cz * cz);
        const r = 12 + rc() * 36;
        x = s * Math.cos(th) * r;
        y = s * Math.sin(th) * r * 0.8;
        z = cz * r;
        // vista da câmera final (~(0; 0,7; 6) olhando para -z): fora de um cone de ~52°
        const dx = x;
        const dy = y - 0.7;
        const dz = z - 6;
        if (-dz / Math.sqrt(dx * dx + dy * dy + dz * dz) < 0.62) break;
      }
      pos.set([x, y, z], i * 3);
      tam[i] = rc() < 0.93 ? 0.1 + rc() * 0.16 : 0.32 + rc() * 0.2;
      fase[i] = rc();
      c.set(rc() < 0.12 ? "#ffd59a" : rc() < 0.3 ? "#a9c8ff" : "#ffffff");
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
    const p = new Points(g, m);
    p.frustumCulled = false; // a câmera viaja por dentro da nuvem
    return p;
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
      const nosGrupo: Vector3[] = [];
      const centro = new Vector3();
      for (let k = 0; k < q; k++) {
        const p = [cx + (rnd() - 0.5) * 2.2, cy + (rnd() - 0.5) * 1.6, cz + (rnd() - 0.5)];
        nos.push(...p);
        if (ant) linhas.push(...ant, ...p);
        ant = p;
        const v = new Vector3(p[0], p[1], p[2]);
        nosGrupo.push(v);
        centro.add(v);
      }
      this.gruposConst.push({ centro: centro.divideScalar(q), nos: nosGrupo, dMin: Infinity, ativo: false, memoria: 0 });
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

  /**
   * Faíscas da celebração (1 draw call, animadas só na GPU): `position` é a velocidade inicial,
   * para cima, para os lados e para a câmera; metade sai do ponteiro, metade da fatia vencedora.
   */
  private criarEnxame(n: number): Points {
    const rnd = gerador(7);
    const vel = new Float32Array(n * 3);
    const atraso = new Float32Array(n);
    const vida = new Float32Array(n);
    const fonte = new Float32Array(n);
    const cor = new Float32Array(n * 3);
    const c = new Color();
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU;
      const z = rnd() * 2 - 1;
      const sz = Math.sqrt(1 - z * z);
      const v = 0.9 + rnd() * 2.6;
      // esfera achatada e puxada para cima/para a câmera: o céu da frente se enche
      vel.set([Math.cos(a) * sz * v * 1.25, (Math.sin(a) * sz * 0.8 + 0.45) * v, (z * 0.5 + 0.35) * v], i * 3);
      atraso[i] = rnd() * rnd() * 0.35;
      vida[i] = 1.3 + rnd() * 1.2;
      fonte[i] = i % 2;
      if (rnd() < 0.22) c.set("#fff4d6");
      else corLogo(CORES_LOGO[Math.floor(rnd() * N_CORES_LOGO)], c);
      cor.set([c.r, c.g, c.b], i * 3);
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(vel, 3));
    g.setAttribute("aAtraso", new BufferAttribute(atraso, 1));
    g.setAttribute("aVida", new BufferAttribute(vida, 1));
    g.setAttribute("aFonte", new BufferAttribute(fonte, 1));
    g.setAttribute("aCor", new BufferAttribute(cor, 3));
    this.descartaveis.push(g);
    const p = new Points(g, this.matEnxame);
    p.frustumCulled = false;
    return p;
  }

  /**
   * Estrelas cadentes: cabeças (Points, 1 ponto por cadente) e rastros (todas as faixas numa
   * geometria indexada, 2 vértices por amostra). Posição/brilho atualizados na CPU em arrays
   * pré-alocados; cor e forma (aAo/aLado) fixas. 2 draw calls.
   */
  private criarCadentes(): void {
    const n = this.nCad;
    const m = this.nRastroCad;
    const c = new Color();
    for (let i = 0; i < n; i++) corLogo(CORES_LOGO[i % N_CORES_LOGO], c).toArray(this.cadCores, i * 3);

    const gc = new BufferGeometry();
    const posC = new BufferAttribute(new Float32Array(n * 3), 3);
    posC.setUsage(DynamicDrawUsage);
    const brilho = new BufferAttribute(new Float32Array(n), 1);
    brilho.setUsage(DynamicDrawUsage);
    const tam = new Float32Array(n).map((_, i) => 0.1 + ((i * 7) % 5) * 0.012);
    gc.setAttribute("position", posC);
    gc.setAttribute("aBrilho", brilho);
    gc.setAttribute("aTam", new BufferAttribute(tam, 1));
    gc.setAttribute("aCor", new BufferAttribute(this.cadCores.slice(), 3));
    const mc = new ShaderMaterial({
      uniforms: this.uCad,
      vertexShader: VERT_CAD_CABECA,
      fragmentShader: FRAG_CAD_CABECA,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
    this.cadCabecas = new Points(gc, mc);
    this.cadCabecas.frustumCulled = false;
    this.cadCabecas.renderOrder = 3;
    this.cadCabecas.visible = false;
    this.cena.add(this.cadCabecas);

    const nv = n * m * 2;
    const gr = new BufferGeometry();
    const posR = new BufferAttribute(new Float32Array(nv * 3), 3);
    posR.setUsage(DynamicDrawUsage);
    const alfa = new BufferAttribute(new Float32Array(nv), 1);
    alfa.setUsage(DynamicDrawUsage);
    const ao = new Float32Array(nv);
    const lado = new Float32Array(nv);
    const cor = new Float32Array(nv * 3);
    const indices: number[] = [];
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) {
        for (let k = 0; k < 2; k++) {
          const v = (i * m + j) * 2 + k;
          ao[v] = j / (m - 1);
          lado[v] = k === 0 ? -1 : 1;
          cor[v * 3] = this.cadCores[i * 3];
          cor[v * 3 + 1] = this.cadCores[i * 3 + 1];
          cor[v * 3 + 2] = this.cadCores[i * 3 + 2];
        }
        if (j < m - 1) {
          const a = (i * m + j) * 2;
          indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
    }
    gr.setAttribute("position", posR);
    gr.setAttribute("aAlfa", alfa);
    gr.setAttribute("aAo", new BufferAttribute(ao, 1));
    gr.setAttribute("aLado", new BufferAttribute(lado, 1));
    gr.setAttribute("aCor", new BufferAttribute(cor, 3));
    gr.setIndex(indices);
    const mr = new ShaderMaterial({
      uniforms: { uMestre: this.uMestre },
      vertexShader: VERT_CAD_RASTRO,
      fragmentShader: FRAG_CAD_RASTRO,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    this.cadRastros = new Mesh(gr, mr);
    this.cadRastros.frustumCulled = false;
    this.cadRastros.renderOrder = 2;
    this.cadRastros.visible = false;
    this.cena.add(this.cadRastros);
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

  /** Estrela viajante: 1 quad aditivo, sem teste de profundidade, desenhado por último. */
  private criarEstrelaViajante(): Mesh {
    const halo = texturaHaloEstrela(this.perfil.ladoSprite);
    const raios = texturaRaios(Math.min(2048, this.perfil.ladoSprite * 2));
    this.uEstrela.uHalo.value = halo;
    this.uEstrela.uRaios.value = raios;
    const m = new ShaderMaterial({
      uniforms: this.uEstrela,
      vertexShader: VERT_UV,
      fragmentShader: FRAG_ESTRELA,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
    });
    this.descartaveis.push(halo, raios);
    const malha = new Mesh(new PlaneGeometry(1, 1), m);
    malha.frustumCulled = false;
    malha.renderOrder = 3;
    return malha;
  }

  /** Rastro: n pontos ao longo da curva → faixa de 2n vértices atualizada na CPU (1 draw call). */
  private criarRastro(n: number): Mesh {
    const pos = new Float32Array(n * 2 * 3);
    const ao = new Float32Array(n * 2);
    const lado = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 2; k++) {
        ao[i * 2 + k] = i / (n - 1);
        lado[i * 2 + k] = k === 0 ? -1 : 1;
      }
    }
    const indices: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const g = new BufferGeometry();
    const attr = new BufferAttribute(pos, 3);
    attr.setUsage(DynamicDrawUsage);
    g.setAttribute("position", attr);
    g.setAttribute("aAo", new BufferAttribute(ao, 1));
    g.setAttribute("aLado", new BufferAttribute(lado, 1));
    g.setIndex(indices);
    const m = new ShaderMaterial({
      uniforms: this.uRastro,
      vertexShader: VERT_RASTRO,
      fragmentShader: FRAG_RASTRO,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    const malha = new Mesh(g, m);
    malha.frustumCulled = false;
    malha.renderOrder = 2;
    return malha;
  }

  /** Riscos de hiperespaço: n segmentos num cubo que acompanha a câmera (1 draw call). */
  private criarWarp(n: number): LineSegments {
    const rnd = gerador(53);
    const pos = new Float32Array(n * 2 * 3);
    const ponta = new Float32Array(n * 2);
    const cor = new Float32Array(n * 2 * 3);
    const c = new Color();
    for (let i = 0; i < n; i++) {
      const x = (rnd() - 0.5) * CAIXA_WARP;
      const y = (rnd() - 0.5) * CAIXA_WARP;
      const z = (rnd() - 0.5) * CAIXA_WARP;
      const r = rnd();
      c.set(r < 0.55 ? "#ffffff" : r < 0.8 ? "#a9c8ff" : r < 0.92 ? "#ffd59a" : LUZES[Math.floor(rnd() * LUZES.length)]);
      c.multiplyScalar(0.55 + rnd() * 0.45);
      for (let k = 0; k < 2; k++) {
        const j = i * 2 + k;
        pos.set([x, y, z], j * 3);
        ponta[j] = k;
        cor.set([c.r, c.g, c.b], j * 3);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new BufferAttribute(pos, 3));
    g.setAttribute("aPonta", new BufferAttribute(ponta, 1));
    g.setAttribute("aCor", new BufferAttribute(cor, 3));
    const m = new ShaderMaterial({
      uniforms: this.uWarp,
      vertexShader: VERT_WARP,
      fragmentShader: FRAG_WARP,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    const linhas = new LineSegments(g, m);
    linhas.frustumCulled = false;
    linhas.renderOrder = 1;
    return linhas;
  }

  /**
   * Constelações que acendem na viagem: linhas (nó→nó do grupo e estrela→nó; a ponta da
   * estrela vem de um uniform) e os nós com brilho extra. 2 draw calls, só quando acesas.
   */
  private criarLigacoes(): void {
    const pos: number[] = [];
    const ponta: number[] = [];
    const grupo: number[] = [];
    const tipo: number[] = [];
    const posNos: number[] = [];
    const grupoNos: number[] = [];
    const tamNos: number[] = [];
    this.gruposConst.forEach((g, gi) => {
      g.nos.forEach((no, k) => {
        posNos.push(no.x, no.y, no.z);
        grupoNos.push(gi);
        tamNos.push(0.3 + (k % 3) * 0.1);
        pos.push(no.x, no.y, no.z, no.x, no.y, no.z);
        ponta.push(0, 1);
        grupo.push(gi, gi);
        tipo.push(1, 1);
        if (k > 0) {
          const a = g.nos[k - 1];
          pos.push(a.x, a.y, a.z, no.x, no.y, no.z);
          ponta.push(0, 0);
          grupo.push(gi, gi);
          tipo.push(0, 0);
        }
      });
    });
    const gl = new BufferGeometry();
    gl.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    gl.setAttribute("aPonta", new BufferAttribute(new Float32Array(ponta), 1));
    gl.setAttribute("aGrupo", new BufferAttribute(new Float32Array(grupo), 1));
    gl.setAttribute("aTipo", new BufferAttribute(new Float32Array(tipo), 1));
    const ml = new ShaderMaterial({
      uniforms: { uAlvos: { value: this.alvosLig }, uAceso: { value: this.aceso }, uTempo: this.uniformesComuns.uTempo, uMestre: this.uMestre },
      vertexShader: VERT_LIGACOES,
      fragmentShader: FRAG_LIGACOES,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.ligacoes = new LineSegments(gl, ml);
    this.ligacoes.frustumCulled = false;
    this.ligacoes.renderOrder = 1;
    this.cena.add(this.ligacoes);

    const gn = new BufferGeometry();
    gn.setAttribute("position", new BufferAttribute(new Float32Array(posNos), 3));
    gn.setAttribute("aGrupo", new BufferAttribute(new Float32Array(grupoNos), 1));
    gn.setAttribute("aTam", new BufferAttribute(new Float32Array(tamNos), 1));
    const mn = new ShaderMaterial({
      uniforms: { uAceso: { value: this.aceso }, uEscala: this.uniformesComuns.uEscala, uMestre: this.uMestre },
      vertexShader: VERT_NOS,
      fragmentShader: FRAG_NOS,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.nosAcesos = new Points(gn, mn);
    this.nosAcesos.frustumCulled = false;
    this.nosAcesos.renderOrder = 1;
    this.cena.add(this.nosAcesos);
  }

  /**
   * Onda de choque + arco do aro: um disco no plano da roleta (1 draw call). Disco em vez de
   * quad (sem os cantos) e descarte cedo no shader; no modo leve, sem a cruz da cabeça do arco.
   */
  private criarAnel(): Mesh {
    const m = new ShaderMaterial({
      uniforms: this.uAnel,
      defines: { COM_CRUZ: this.leve ? 0 : 1, ALCANCE_ARO: this.leve ? "0.3" : "0.45" },
      vertexShader: VERT_ANEL,
      fragmentShader: FRAG_ANEL,
      transparent: true,
      depthWrite: false,
      depthTest: false,
      blending: AdditiveBlending,
      side: DoubleSide,
    });
    // raio 1 (escalado por uRaioQuad, como o quad 2×2 de antes): vP continua = position.xy · raio
    const malha = new Mesh(new CircleGeometry(1, 64), m);
    malha.position.z = 0.04;
    malha.frustumCulled = false;
    malha.renderOrder = 2;
    return malha;
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
    this.posicionarPinos();
  }

  definirFase(fase: Fase): void {
    const anterior = this.fase;
    const comRoleta = FASES_COM_ROLETA.has(fase);
    if (comRoleta && (this.modoRevelacao === "oculta" || this.modoRevelacao === "saindo")) {
      // só a entrada em "pronto" vinda de uma fase sem roleta (CPF confirmado) faz a viagem;
      // cena que já nasce com roleta (recarga, troca 2D/3D) ou fase com roleta recuperada
      // ("resultado" depois de outraJanela/importação): roleta direto, sem animação
      const viaja = !this.primeiraFase && anterior !== "carregando" && fase === "pronto" && !FASES_COM_ROLETA.has(anterior);
      if (viaja) this.iniciarChegada();
      else this.mostrarDireto();
    } else if (!comRoleta && (this.modoRevelacao === "chegando" || this.modoRevelacao === "visivel")) {
      this.iniciarSaida();
    }
    // o giro começou no meio da chegada: termina rápido, com o ponteiro já no lugar
    if (fase === "girando" && this.modoRevelacao === "chegando") this.acelerarChegada(DUR_APRESSADA);
    this.primeiraFase = false;

    // celebração só quando o giro termina (não em "resultado" recuperado sem giro)
    if (fase === "resultado" && anterior === "girando" && this.modoRevelacao === "visivel") this.iniciarCelebracao();
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
    this.desligarBloom(false);
    this.renderer.dispose();
    // dispose() não libera o contexto: sem isto cada troca 2D/3D deixa um contexto vivo até o GC
    try {
      this.renderer.forceContextLoss();
    } catch {
      /* contexto já perdido ou extensão indisponível */
    }
    this.renderer.domElement.remove();
  }

  // ---------- internos ----------
  private redesenharFace = () => {
    const ladoAntes = this.canvasFace.width;
    desenharFace(this.canvasFace, this.fatias, this.perfil.ladoFace);
    // se o tamanho mudou, a textura já alocada na GPU precisa ser recriada (senão fica vazia)
    if (this.canvasFace.width !== ladoAntes) this.texturaFace.dispose();
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
    this.composer?.setPixelRatio(this.dprAtual);
    this.composer?.setSize(w, h);
    this.camera.aspect = w / h;
    this.uniformesComuns.uEscala.value = h * this.dprAtual * 0.9;
  };

  private moverPonteiro = (e: PointerEvent) => {
    this.parallax.ax = (e.clientX / window.innerWidth - 0.5) * 2;
    this.parallax.ay = (e.clientY / window.innerHeight - 0.5) * 2;
  };

  /** Tocar a tela durante a chegada acelera o resto; fora dela, tocar o céu solta faíscas. */
  private tocarFundo = (e: PointerEvent) => {
    if (this.modoRevelacao === "chegando") {
      if (performance.now() - this.inicioChegada > IGNORA_TOQUE_MS) this.acelerarChegada(DUR_PULO);
      return;
    }
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
    this.tau = 0;
    this.dtRoteiro = 0;
    this.revelacao = 0;
    this.fatorChegada = 1;
    this.inicioChegada = performance.now();
    this.viagemPendente = true;
    this.sViagem = 0;
    this.velViagem = 0;
    this.supernovaEmitida = false;
    this.pinoEmitido.fill(0);
    this.arcoPinos = 0;
    this.aceso.fill(0);
    for (const g of this.gruposConst) g.memoria = 0;
    this.uMestre.value = 1;
    this.mestreChegada = 1;
    this.perseguicaoSolta = false;
    this.apagarRestante = 0;
    this.apagarTotal = 0;
    this.durRetomada = 0;
    this.saltouRoteiro = false;
    this.entradaAtual = this.opcoes.entrada === "estrela" ? "estrela" : "cadentes";
    const cadentes = this.entradaAtual === "cadentes";
    this.durChegada = cadentes ? (this.leve ? DUR_CHEGADA_CAD_LEVE : DUR_CHEGADA_CAD) : this.leve ? DUR_CHEGADA_LEVE : DUR_CHEGADA;
    this.modoCadentes = cadentes ? 1 : 0;
    this.cadDoGrupo.fill(-1);
    this.formouEmitido = false;
    // uma celebração que ainda se apagava some (as cadentes passam a ser da entrada)
    this.encerrarCelebracao();
  }

  /** A roleta se formou (flash): avisa a interface (som), uma vez por chegada animada. */
  private emitirFormou() {
    if (this.formouEmitido) return;
    this.formouEmitido = true;
    window.dispatchEvent(new CustomEvent(EVENTO_FORMOU));
  }

  /** Velocidade atual da estrela no roteiro, em fração da curva por segundo real. */
  private velCurvaReal(): number {
    return ((this.velViagem * VMAX) / (T_POUSO - T_PARTIDA)) * (T_FIM / this.durChegada) * this.fatorChegada;
  }

  /** A câmera deixa de seguir o roteiro: a pose de perseguição continua pela curva e freia. */
  private soltarPerseguicao() {
    if (this.perseguicaoSolta) return;
    this.perseguicaoSolta = true;
    this.sPerseg = this.sViagem;
    this.velPerseg = this.modoRevelacao === "chegando" ? this.velCurvaReal() : 0;
  }

  private avancarPerseguicaoSolta(dt: number) {
    this.sPerseg = Math.min(1, this.sPerseg + this.velPerseg * dt);
    this.velPerseg *= Math.exp(-dt * K_FREIO_PERSEG);
  }

  /**
   * Pulo (toque) ou giro no meio da chegada: o que falta termina em ~`dur` segundos SEM
   * comprimir a perseguição. Com a viagem em curso, ela se apaga onde está (o roteiro para)
   * enquanto a câmera sai da perseguição em tempo real; o roteiro então salta para perto do
   * pouso e a supernova e a formação seguem com fator moderado. Perto do pouso, só acelera.
   * Igual nas duas entradas: nas cadentes a revoada se apaga junto e reacende já no fim da
   * espiral (T_RETOMA), fechando no centro.
   */
  private acelerarChegada(dur: number) {
    this.soltarPerseguicao();
    if (this.apagarRestante > 0) {
      // já se apagando (giro depois de um toque): só encurta o que falta
      // (mantém o brilho atual: restante/total não muda no quadro do ajuste)
      const apagar = Math.min(this.apagarRestante, dur * 0.3);
      this.durRetomada = Math.min(this.durRetomada, dur - apagar);
      this.apagarTotal = (this.apagarTotal * apagar) / this.apagarRestante;
      this.apagarRestante = apagar;
      return;
    }
    if (this.tau < T_RETOMA && !this.saltouRoteiro) {
      this.apagarTotal = this.apagarRestante = Math.min(DUR_APAGAR_PULO, dur * 0.3);
      this.durRetomada = dur - this.apagarTotal;
      return;
    }
    this.fatorChegada = Math.max(this.fatorChegada, (this.durChegada - this.tRevelacao) / dur);
  }

  private iniciarSaida() {
    this.soltarPerseguicao();
    this.rSaida = Math.max(0.05, this.revelacao);
    this.modoRevelacao = "saindo";
    this.tRevelacao = 0;
    // roleta que mal começou a se formar não solta o anel de faíscas
    this.brilhoSaidaEmitido = this.revelacao < 0.5;
    this.viagemPendente = false;
    this.apagarRestante = 0;
  }

  private mostrarDireto() {
    const primeiraChegada = this.modoRevelacao === "chegando";
    // a câmera termina de sair da perseguição sozinha (sem salto), já fora da chegada
    if (this.pesoPerseguicao > 0.0005) this.soltarPerseguicao();
    // chegada que terminou sem passar pelo quadro do flash (giro/pulo no fim): o som sai igual;
    // roleta mostrada direto, sem animação, não dispara
    if (primeiraChegada) this.emitirFormou();
    this.encerrarCelebracao();
    this.modoRevelacao = "visivel";
    this.revelacao = 1;
    this.apagarRestante = 0;
    this.aplicarVisivel();
    // a avaliação inicial mediu a cena sem roleta: refaz com a roleta montada
    if (primeiraChegada && !this.reavaliado) {
      this.reavaliado = true;
      this.avaliado = false;
      this.nAmostras = 0;
      this.janelaInicio = 0;
    }
    // a interface mostra o painel (botão Girar) quando a roleta está inteira; em microtarefa
    // para que ouvintes registrados nos efeitos do mesmo commit do React já existam
    queueMicrotask(() => {
      if (!this.destruido && this.modoRevelacao === "visivel") window.dispatchEvent(new CustomEvent(EVENTO_CHEGADA));
    });
  }

  /** Avança o relógio da revelação (antes da câmera, que usa o peso da perseguição). */
  private avancarRevelacao(dt: number) {
    const saidaPerseg = Math.exp(-dt * K_SAIDA_PERSEG);
    if (this.modoRevelacao === "chegando") {
      if (this.apagarRestante > 0) {
        // pulo: o roteiro para; a estrela segue com a câmera, freando, e a viagem se apaga
        this.apagarRestante = Math.max(0, this.apagarRestante - dt);
        this.mestreChegada = this.apagarTotal > 0 ? this.apagarRestante / this.apagarTotal : 0;
        this.avancarPerseguicaoSolta(dt);
        this.sViagem = this.sPerseg;
        this.velViagem *= Math.exp(-dt * K_FREIO_PERSEG);
        this.dtRoteiro = 0;
        this.pesoPerseguicao *= saidaPerseg;
        if (this.apagarRestante <= 0) {
          // salta para perto do pouso (com tudo apagado); supernova e formação com fator moderado
          this.saltouRoteiro = true;
          this.tau = T_RETOMA;
          this.tRevelacao = (T_RETOMA / T_FIM) * this.durChegada;
          this.fatorChegada = ((T_FIM - T_RETOMA) / T_FIM) * this.durChegada / Math.max(0.05, this.durRetomada);
          this.revelacao = faixa(this.tau, T_POUSO, T_FIM);
          this.perfilViagem(faixa(this.tau, T_PARTIDA, T_POUSO));
        }
        return;
      }
      const dtR = dt * this.fatorChegada;
      this.tRevelacao += dtR;
      const u = Math.min(1, this.tRevelacao / this.durChegada);
      this.tau = u * T_FIM;
      this.dtRoteiro = dtR * (T_FIM / this.durChegada);
      this.revelacao = faixa(this.tau, T_POUSO, T_FIM);
      this.perfilViagem(faixa(this.tau, T_PARTIDA, T_POUSO));
      if (this.perseguicaoSolta) {
        // pulo/giro: a câmera sai da perseguição em tempo real, por uma pose que freia sozinha
        this.pesoPerseguicao *= saidaPerseg;
        this.avancarPerseguicaoSolta(dt);
      } else {
        // câmera: enquadramento → perseguição (decolagem) → enquadramento (chegada); a queda
        // nunca é mais rápida que exp(-dt·K) em tempo real
        const roteiro = suave(this.tau, 0.75, 1.9) * (1 - suave(this.tau, 5.35, 6.75));
        this.pesoPerseguicao = roteiro < this.pesoPerseguicao ? Math.max(roteiro, this.pesoPerseguicao * saidaPerseg) : roteiro;
        this.sPerseg = this.sViagem;
      }
      // depois do salto, a estrela reacende no pouso
      this.mestreChegada = this.saltouRoteiro ? Math.min(1, this.mestreChegada + dt / 0.08) : 1;
      if (u >= 1) this.mostrarDireto();
      return;
    }
    this.pesoPerseguicao *= saidaPerseg;
    if (this.pesoPerseguicao > 0.0005) this.avancarPerseguicaoSolta(dt);
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

  /** Posição (0..1, por comprimento de arco) e velocidade normalizada: trapézio acelera/cruza/freia. */
  private perfilViagem(k: number) {
    if (k < ACEL) {
      this.sViagem = (VMAX * k * k) / (2 * ACEL);
      this.velViagem = k / ACEL;
    } else if (k < 1 - FREIO) {
      this.sViagem = VMAX * (ACEL / 2 + k - ACEL);
      this.velViagem = 1;
    } else {
      const r = 1 - k;
      this.sViagem = 1 - (VMAX * r * r) / (2 * FREIO);
      this.velViagem = r / FREIO;
    }
    this.sViagem = saturar(this.sViagem);
  }

  /**
   * Monta a rota desta chegada (uma vez, com a câmera já posicionada): nasce no centro da tela,
   * passa pelos pontos fixos e termina na estrela do cubo com a inclinação final. Escolhe as
   * constelações que a rota mais se aproxima para acenderem.
   */
  private prepararViagem() {
    const cam = this.camera;
    cam.updateMatrixWorld();
    const dir = this.vB.set(0, 0, 0.5).unproject(cam).sub(cam.position).normalize();
    const p = this.pontosCurva;
    p[0].copy(cam.position).addScaledVector(dir, this.distBase * 0.45);
    p[1].copy(p[0]).addScaledVector(dir, 3.6);
    p[1].x -= 0.7;
    p[1].y += 0.3;
    ROTA.forEach(([x, y, z], i) => p[i + 2].set(x, y, z));
    p[p.length - 1].set(0, -SIN_INC * Z_CENTRO, COS_INC * Z_CENTRO); // centro do medalhão
    this.curva.updateArcLengths();
    this.compCurva = this.curva.getLength();
    this.velCruzeiro = (VMAX * this.compCurva) / (T_POUSO - T_PARTIDA);

    for (const g of this.gruposConst) g.dMin = Infinity;
    const amostras = 120;
    for (let i = 0; i < amostras; i++) {
      this.curva.getPointAt(i / (amostras - 1), this.vA);
      for (const g of this.gruposConst) g.dMin = Math.min(g.dMin, this.vA.distanceTo(g.centro));
    }
    const ordem = this.gruposConst.map((g) => g.dMin).sort((a, b) => a - b);
    const limite = ordem[Math.min(GRUPOS_ACESOS, ordem.length) - 1];
    for (const g of this.gruposConst) g.ativo = g.dMin <= limite;
  }

  /** Tangente da curva em u, por diferença central (sem alocar, ao contrário de getTangentAt). */
  private tangenteEm(u: number, alvo: Vector3): Vector3 {
    const u1 = Math.max(0, u - 0.002);
    const u2 = Math.min(1, u + 0.002);
    this.curva.getPointAt(u1, this.vT1);
    this.curva.getPointAt(u2, alvo);
    return alvo.sub(this.vT1).normalize();
  }

  /**
   * Pose da câmera de perseguição (posPerseg, alvoPerseg, rolagemPerseg): atrás da estrela na
   * própria curva, de lado, com rolagem. Em retrato (aspect < 1) o meio campo horizontal é
   * estreito: o avanço do alvo e o deslocamento lateral encolhem com o aspect para a estrela
   * não sair do quadro nas curvas fechadas.
   */
  private calcularPerseguicao() {
    const L = this.compCurva;
    const s = this.sPerseg;
    const kAsp = Math.min(1, this.camera.aspect / 1.2);
    const dCam = s * L - D_ATRAS;
    const uCam = Math.max(0, dCam) / L;
    this.curva.getPointAt(uCam, this.vBase);
    this.tangenteEm(uCam, this.vTanCam);
    if (dCam < 0) this.vBase.addScaledVector(this.vTanCam, dCam);
    this.curva.getPointAt(s, this.alvoPerseg);
    this.tangenteEm(s, this.vB);
    const lado = this.vLado.crossVectors(this.vTanCam, EIXO_Y);
    if (lado.lengthSq() < 1e-6) lado.set(1, 0, 0);
    else lado.normalize();
    const cima = this.vCima.crossVectors(lado, this.vTanCam);
    this.posPerseg.copy(this.vBase).addScaledVector(lado, 0.42 * kAsp).addScaledVector(cima, 0.3);
    // quanto a direção da estrela já virou para o lado: inclina para dentro da curva
    const curvaLado = this.vA.copy(this.vB).sub(this.vTanCam).dot(lado);
    this.alvoPerseg.addScaledVector(this.vB, 0.8 * kAsp);
    this.rolagemPerseg = Math.max(-0.35, Math.min(0.35, curvaLado * 0.6));
  }

  /** Aplica o estado do quadro às peças (depois da câmera: rastro e estrela usam a pose dela). */
  private aplicarRevelacao(dt: number) {
    if (this.modoRevelacao === "chegando") {
      if (this.viagemPendente) {
        this.prepararViagem();
        if (this.entradaAtual === "cadentes") this.prepararCadentes();
        this.viagemPendente = false;
      }
      this.aplicarChegada();
    } else if (this.modoRevelacao === "saindo") {
      this.aplicarSaida(Math.min(1, this.tRevelacao / DUR_SAIDA), dt);
    }
  }

  private escalar(obj: Mesh | Group, s: number, z0: number) {
    obj.visible = s > 0.001;
    obj.scale.setScalar(Math.max(s, 1e-4));
    obj.position.z = z0 * s;
  }

  /**
   * Pinos: na chegada surgem um a um, no sentido horário, quando o arco de luz passa por eles
   * (cada um solta um brilho de estrela); fora dela, todos no lugar.
   */
  private posicionarPinos() {
    const n = this.pinos.count;
    const m = this.matrizPino;
    const arco = this.arcoPinos;
    const emitir = this.modoRevelacao === "chegando";
    for (let i = 0; i < n; i++) {
      const phi = this.fatias[i].inicio;
      let s = 1;
      if (arco < TAU + 1) {
        // ângulo do pino visto pela câmera (horário desde as 12h), com a rotação atual
        const k = faixa(arco - modPositivo(phi + this.thetaAtual, TAU), 0, 0.55);
        s = k <= 0 ? 0 : outBack(k);
        if (emitir && k > 0 && !this.pinoEmitido[i]) {
          this.pinoEmitido[i] = 1;
          this.vA.set(Math.sin(phi) * R * 0.975, Math.cos(phi) * R * 0.975, 0.05);
          this.disco.localToWorld(this.vA);
          this.emitirFaiscas(this.vA, this.leve ? 2 : 3, 0.5, false);
        }
      }
      m.makeScale(s, s, s);
      m.setPosition(Math.sin(phi) * R * 0.975, Math.cos(phi) * R * 0.975, 0.03);
      this.pinos.setMatrixAt(i, m);
    }
    this.pinos.instanceMatrix.needsUpdate = true;
  }

  /** Solta faíscas do pool: em anel no plano do disco (supernova) ou em todas as direções. */
  private emitirFaiscas(origem: Vector3, total: number, vel: number, noDisco: boolean) {
    let k = 0;
    for (const f of this.poolFaiscas) {
      if (f.vida > 0) continue;
      f.vida = 1;
      f.pos.copy(origem);
      const v = vel * (0.5 + Math.random() * 0.8); // cosmético
      if (noDisco) {
        const a = (k / total) * TAU + Math.random() * 0.15;
        f.vel.set(Math.sin(a) * v, Math.cos(a) * v, (Math.random() - 0.5) * 0.4).applyQuaternion(this.inclinacao.quaternion);
      } else {
        const a = Math.random() * TAU;
        const z = Math.random() * 2 - 1;
        const sz = Math.sqrt(1 - z * z);
        f.vel.set(Math.cos(a) * sz * v, Math.sin(a) * sz * v, z * v);
      }
      if (++k >= total) break;
    }
  }

  /**
   * Um quadro da chegada: estrela viajante (ou a revoada de cadentes em volta do líder), rastro,
   * riscos, constelações e formação da roleta. vEstrela = ponto da curva (estrela ou líder).
   */
  private aplicarChegada() {
    const tau = this.tau;
    const s = this.sViagem;
    this.curva.getPointAt(s, this.vEstrela);
    this.tangenteEm(s, this.vTanEstrela);
    this.uMestre.value = this.mestreChegada;
    const vel = this.velViagem * this.velCruzeiro; // mundo por segundo do roteiro
    if (this.entradaAtual === "cadentes") {
      this.rastro.visible = false;
      if (this.modoCadentes === 1) {
        this.aplicarCadentes(tau, 1);
        // depois do pouso e com tudo apagado, as cadentes param de ser calculadas
        if (tau > T_POUSO + 0.4) {
          this.modoCadentes = 0;
          this.cadCabecas.visible = false;
          this.cadRastros.visible = false;
        }
      }
      this.aplicarNucleoCadentes(tau);
    } else {
      this.aplicarEstrela(tau);
      this.aplicarRastro(s * this.compCurva, vel);
    }
    this.aplicarWarp(tau, vel);
    this.aplicarLigacoes(tau);
    this.aplicarFormacao(tau);
  }

  private aplicarEstrela(tau: number) {
    const e = this.estrelaViajante;
    const cam = this.camera;
    const kNasc = faixa(tau, 0, 0.7);
    const nasc = kNasc <= 0 ? 0 : outBack(kNasc);
    const chegada = suave(tau, 5.6, 6.5);
    const pulso = 1 + (0.06 + 0.14 * chegada) * Math.sin(tau * TAU * 2.2);
    const dp = tau - T_POUSO;
    const flash = dp < 0 ? Math.exp(-((dp / 0.06) ** 2)) : Math.exp(-dp / 0.16);
    // tamanho em fração da altura da tela (constante durante a viagem), depois em mundo: a
    // estrela encolhe até o tamanho da estrela do cubo, no mesmo ponto. O flash cresce pouco o
    // quad (no máximo ~0,6 da altura da tela, não a tela inteira): o pico vem do brilho
    const dist = Math.max(0.3, this.vA.copy(this.vEstrela).sub(cam.position).length());
    let tamanho = ((0.24 + 0.12 * chegada) * nasc * pulso + 0.22 * flash) * 2 * TAN_MEIO_FOV * dist;
    tamanho += (0.42 - tamanho) * suave(tau, 6.75, 7.55);
    const brilho = Math.min(1, kNasc * 4) * (1 + 2.8 * flash) * (0.92 + 0.5 * (pulso - 1)) * (1 - suave(tau, 7.3, 7.85));
    e.visible = brilho * this.mestreChegada > 0.002;
    e.position.copy(this.vEstrela);
    e.quaternion.copy(cam.quaternion);
    e.scale.setScalar(Math.max(1e-4, tamanho));
    const u = this.uEstrela;
    u.uGiro.value = 0.25 * tau + 0.6 * flash;
    u.uBrilho.value = brilho;
    u.uRaiosForca.value = 0.85 + 0.8 * flash;
  }

  /** Rastro sobre a curva, atrás da estrela; comprimento proporcional à velocidade. */
  private aplicarRastro(dEstrela: number, vel: number) {
    const r = this.rastro;
    const comp = Math.min(this.leve ? 2.6 : 4.6, vel * (this.leve ? 0.24 : 0.4));
    // depois do salto do pulo o rastro não reaparece (a estrela reacende já no pouso)
    if (comp < 0.03 || this.saltouRoteiro || this.mestreChegada < 0.002) {
      r.visible = false;
      return;
    }
    r.visible = true;
    this.uRastro.uAlfa.value = Math.min(1, comp * 1.5);
    const n = this.nRastro;
    const L = this.compCurva;
    const pts = this.pontosRastro;
    const v = this.vA;
    for (let j = 0; j < n; j++) {
      const d = Math.max(0, dEstrela - (comp * j) / (n - 1));
      this.curva.getPointAt(d / L, v);
      pts[j * 3] = v.x;
      pts[j * 3 + 1] = v.y;
      pts[j * 3 + 2] = v.z;
    }
    const attr = r.geometry.getAttribute("position") as BufferAttribute;
    const arr = attr.array as Float32Array;
    const cam = this.camera.position;
    const tan = this.vB;
    const olhar = this.vCima;
    const lado = this.vLadoRastro;
    const largura = this.leve ? 0.06 : 0.07;
    for (let j = 0; j < n; j++) {
      const a = Math.max(0, j - 1) * 3;
      const b = Math.min(n - 1, j + 1) * 3;
      const o = j * 3;
      tan.set(pts[a] - pts[b], pts[a + 1] - pts[b + 1], pts[a + 2] - pts[b + 2]);
      olhar.set(pts[o] - cam.x, pts[o + 1] - cam.y, pts[o + 2] - cam.z);
      this.vLado.crossVectors(tan, olhar);
      const len = this.vLado.length();
      if (len > 1e-7) lado.copy(this.vLado).divideScalar(len);
      const w = largura * Math.pow(1 - j / (n - 1), 0.8);
      const k = j * 6;
      arr[k] = pts[o] - lado.x * w;
      arr[k + 1] = pts[o + 1] - lado.y * w;
      arr[k + 2] = pts[o + 2] - lado.z * w;
      arr[k + 3] = pts[o] + lado.x * w;
      arr[k + 4] = pts[o + 1] + lado.y * w;
      arr[k + 5] = pts[o + 2] + lado.z * w;
    }
    attr.needsUpdate = true;
  }

  /** Riscos de hiperespaço em torno da câmera, esticados pela velocidade real (relógio acelerado incluso). */
  private aplicarWarp(tau: number, vel: number) {
    const forca = this.velViagem ** 1.5 * (1 - suave(tau, 5.6, 6.3)) * (this.leve ? 0.8 : 1);
    if (forca * this.mestreChegada < 0.01) {
      this.warp.visible = false;
      return;
    }
    this.warp.visible = true;
    const velReal = vel * (T_FIM / this.durChegada) * this.fatorChegada;
    const u = this.uWarp;
    u.uCam.value.copy(this.camera.position);
    u.uVel.value.copy(this.vTanEstrela).multiplyScalar(velReal);
    u.uEstica.value = Math.min(0.075, 1.8 / Math.max(velReal, 0.001));
    u.uForca.value = forca;
  }

  /**
   * As 3 constelações mais próximas da rota acendem quando a estrela (ou a revoada) passa por
   * elas. Na estrela as linhas vão até ela; nas cadentes, cada constelação acesa escolhe a
   * cadente visível mais próxima quando acende e fica ligada a ela até apagar.
   */
  private aplicarLigacoes(tau: number) {
    const janela = suave(tau, 0.9, 1.3) * (1 - suave(tau, 5.6, 6.3));
    const cadentes = this.entradaAtual === "cadentes" && this.cadCabecas.visible;
    const posC = this.cadCabecas.geometry.getAttribute("position").array as Float32Array;
    const bri = this.cadCabecas.geometry.getAttribute("aBrilho").array as Float32Array;
    let algum = false;
    for (let i = 0; i < this.gruposConst.length; i++) {
      const g = this.gruposConst[i];
      if (!g.ativo || janela <= 0) {
        g.memoria = 0;
        this.aceso[i] = 0;
        this.cadDoGrupo[i] = -1;
        continue;
      }
      const k = 1 - faixa(this.vEstrela.distanceTo(g.centro), g.dMin + 0.2, g.dMin + 3.2);
      g.memoria = Math.max(k * k * (3 - 2 * k), g.memoria - this.dtRoteiro * 1.2);
      this.aceso[i] = g.memoria * janela;
      const alvo = this.alvosLig[i];
      if (this.aceso[i] > 0.002) {
        algum = true;
        if (cadentes) {
          let c = this.cadDoGrupo[i];
          if (c < 0 || bri[c] <= 0) {
            let melhor = Infinity;
            c = -1;
            for (let j = 0; j < this.nCad; j++) {
              if (bri[j] <= 0) continue;
              const dx = posC[j * 3] - g.centro.x;
              const dy = posC[j * 3 + 1] - g.centro.y;
              const dz = posC[j * 3 + 2] - g.centro.z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < melhor) {
                melhor = d2;
                c = j;
              }
            }
            this.cadDoGrupo[i] = c;
          }
          if (c >= 0) alvo.set(posC[c * 3], posC[c * 3 + 1], posC[c * 3 + 2]);
          else alvo.copy(this.vEstrela);
        } else alvo.copy(this.vEstrela);
      } else {
        this.cadDoGrupo[i] = -1;
        alvo.copy(this.vEstrela);
      }
    }
    algum = algum && this.mestreChegada > 0.002;
    this.ligacoes.visible = algum;
    this.nosAcesos.visible = algum;
  }

  /** Supernova e roleta que se forma a partir da luz (do pouso, 6,6 s, até 8 s). */
  private aplicarFormacao(tau: number) {
    this.inclinacao.visible = true;
    this.inclinacao.scale.setScalar(1);
    const dp = tau - T_POUSO;
    const depois = dp >= 0;

    // face: revelação radial de dentro para fora, com borda luminosa
    const kFace = faixa(tau, 6.66, 7.36);
    this.uFace.uRaio.value = 1.1 * outCubic(kFace);
    this.uFace.uBorda.value = suave(tau, 6.62, 6.78) * (1 - suave(tau, 7.2, 7.6)) * 1.3;
    this.uFace.uOpacidade.value = 1;
    this.face.visible = kFace > 0;

    // estrutura: corpo com a face, aro quando a onda de choque passa por ele
    const sLado = outBack(faixa(tau, 6.7, 7.2));
    this.escalar(this.lateral, sLado, -0.07);
    this.escalar(this.fundo, sLado, -0.14);
    this.escalar(this.aro, outBack(faixa(tau, 6.72, 7.1)), 0);
    // cubo e medalhão (com a logo) nascem onde a estrela viajante parou / as cadentes se juntaram
    const sCubo = outBack(faixa(tau, 7.0, 7.45));
    this.escalar(this.cubo, sCubo, 0.04);
    this.escalar(this.anelCubo, sCubo, Z_MEDALHAO);
    this.escalar(this.medalhao, outBack(faixa(tau, 7.1, 7.55)), Z_MEDALHAO);
    this.matBrilho.opacity = suave(tau, 7.45, 8);
    this.brilho.visible = this.matBrilho.opacity > 0.001;

    // arco de luz pelo aro; os pinos surgem quando ele passa
    this.arcoPinos = (TAU + 0.7) * inOutCubic(faixa(tau, 6.85, 7.7));
    this.pinos.visible = this.arcoPinos > 0;
    this.posicionarPinos();

    // ponteiro cai de cima e quica
    const kp = faixa(tau, 7.3, 7.95);
    this.ponteiro.visible = kp > 0;
    this.ponteiro.position.y = R * 1.1 + (1 - outBounce(kp)) * 1.3;

    // halo azul atrás da roleta acende com o flash da supernova (só na cor: escalar o quad
    // grande junto com o flash empilhava mais uma camada aditiva do tamanho da tela)
    const flashHalo = depois ? Math.exp(-dp / 0.3) : 0;
    this.halo.visible = depois;
    this.matHalo.opacity = suave(tau, T_POUSO, 7.4);
    this.matHalo.color.setScalar(1 + 2.4 * flashHalo);
    this.halo.scale.setScalar(1);

    // onda de choque + arco do aro
    const kOnda = faixa(tau, T_POUSO, 7.35);
    const onda = 2.4 * outCubic(kOnda);
    const alfaOnda = depois ? (1 - kOnda) ** 1.4 : 0;
    const alfaArco = suave(tau, 6.82, 6.92) * (1 - suave(tau, 7.55, 7.9));
    const ua = this.uAnel;
    ua.uOnda.value = onda;
    ua.uAlfaOnda.value = alfaOnda;
    ua.uArco.value = this.arcoPinos;
    ua.uAlfaArco.value = alfaArco;
    // cadentes: o arco pinta o aro com as cores da logo (uma cor por trecho, horário)
    ua.uCoresMix.value = this.entradaAtual === "cadentes" ? 1 : 0;
    // disco do anel: cobre o aro com a faixa da cabeça/cruz (ALCANCE_ARO) e cresce com a onda
    const rMin = this.leve ? 1.32 : 1.47;
    const raioQuad = alfaOnda > 0.002 ? Math.min(2.8, Math.max(rMin, onda + 0.45)) : rMin;
    ua.uRaioQuad.value = raioQuad;
    this.anel.scale.setScalar(raioQuad);
    this.anel.visible = alfaOnda > 0.002 || alfaArco > 0.002;

    if (depois && !this.supernovaEmitida) {
      this.supernovaEmitida = true;
      this.inclinacao.updateMatrixWorld();
      this.vA.set(0, 0, Z_CENTRO);
      this.inclinacao.localToWorld(this.vA);
      this.emitirFaiscas(this.vA, this.leve ? 28 : 56, 2.2, true);
      this.emitirFormou();
    }
  }

  // ---------- estrelas cadentes ----------
  /**
   * Monta a revoada desta chegada (uma vez, depois de prepararViagem). Cada cadente tem um lugar
   * na formação em volta do líder (lado/cima numa elipse, frente de −0,9 a +3,3 u à frente dele;
   * a câmera fica D_ATRAS atrás), com ondulação própria nos três eixos; nasce em leque do ponto
   * de partida e, perto do pouso, troca a formação por uma espiral horária no plano do disco
   * (raio ~0,75–1,1, sobre o lugar da roleta) em volta do líder, que se fecha no centro em T_POUSO. Em retrato o lado
   * encolhe com o aspect (a revoada não sai do quadro).
   */
  private prepararCadentes() {
    const p = this.cadParam;
    const n = this.nCad;
    const rnd = gerador(1 + (Math.floor(performance.now()) % 100000)); // varia a cada chegada
    const kAsp = Math.max(0.5, Math.min(1, this.camera.aspect / 1.2));
    for (let i = 0; i < n; i++) {
      const o = i * NP;
      const ga = i * 2.39996 + rnd() * 0.4; // ângulo áureo: lugares bem espalhados
      const frente = -0.9 + rnd() * 4.2;
      // as que vão mais perto da câmera ficam longe do eixo do olhar (passam ao lado dela)
      let anel = 0.4 + 0.6 * Math.sqrt((i + 0.5) / n);
      if (frente < 1) anel = Math.max(anel, 0.9);
      p[o + P_OF] = Math.cos(ga) * anel * 1.25 * kAsp;
      p[o + P_OF + 1] = Math.sin(ga) * anel * 0.7;
      p[o + P_OF + 2] = frente;
      p[o + P_OA] = (0.12 + rnd() * 0.18) * kAsp;
      p[o + P_OA + 1] = 0.08 + rnd() * 0.14;
      // ultrapassam umas às outras, sem nunca chegar à câmera
      p[o + P_OA + 2] = Math.min(0.3 + rnd() * 0.6, 0.4 + 0.5 * (frente + 0.9));
      p[o + P_OFASE] = rnd() * TAU;
      p[o + P_OFASE + 1] = rnd() * TAU;
      p[o + P_OFASE + 2] = rnd() * TAU;
      p[o + P_OW] = 1.1 + rnd() * 1.3;
      p[o + P_T_INI] = 0.05 + (i / n) * 0.55 + rnd() * 0.1;
      p[o + P_T_ESP] = 5.25 + rnd() * 0.4;
      p[o + P_R_E] = 0.75 + rnd() * 0.35;
      p[o + P_FI_E] = ga;
      p[o + P_H0] = 0.12 + rnd() * 0.3;
    }
  }

  /**
   * Espiral da entrada (k = 0..1) no plano do disco com a inclinação final, em mundo. Para k < 0
   * (antes da entrada) segue para fora em linha reta no raio, no ângulo e na altura (mesma
   * derivada em k = 0): a revoada se mistura com ela sem tranco.
   */
  private espiralCadente(o: number, k: number, out: Vector3): Vector3 {
    const p = this.cadParam;
    let r: number;
    let fi: number;
    let zl: number;
    if (k < 0) {
      const kk = Math.max(-0.9, k);
      r = p[o + P_R_E] * (1 - 1.25 * kk);
      fi = p[o + P_FI_E] + ESP_A * kk;
      zl = p[o + P_H0] - 2 * (p[o + P_H0] - Z_CENTRO) * kk;
    } else {
      const kk = saturar(k);
      const resto = 1 - kk;
      r = p[o + P_R_E] * resto ** 1.25;
      fi = p[o + P_FI_E] + ESP_A * kk + ESP_B * kk * kk;
      zl = Z_CENTRO + (p[o + P_H0] - Z_CENTRO) * resto * resto;
    }
    const xl = Math.sin(fi) * r;
    const yl = Math.cos(fi) * r;
    return out.set(xl, yl * COS_INC - zl * SIN_INC, yl * SIN_INC + zl * COS_INC);
  }

  /** Referencial do líder na posição s da curva (amostra j de cadLider): posição, lado, cima, frente. */
  private quadroLider(j: number, s: number) {
    const q = this.cadLider;
    const b = j * NQ;
    const pos = this.curva.getPointAt(s, this.vA);
    const frente = this.tangenteEm(s, this.vB);
    const lado = this.vLado.crossVectors(frente, EIXO_Y);
    if (lado.lengthSq() < 1e-6) lado.set(1, 0, 0);
    else lado.normalize();
    const cima = this.vCima.crossVectors(lado, frente);
    q[b] = pos.x;
    q[b + 1] = pos.y;
    q[b + 2] = pos.z;
    q[b + 3] = lado.x;
    q[b + 4] = lado.y;
    q[b + 5] = lado.z;
    q[b + 6] = cima.x;
    q[b + 7] = cima.y;
    q[b + 8] = cima.z;
    q[b + 9] = frente.x;
    q[b + 10] = frente.y;
    q[b + 11] = frente.z;
  }

  /**
   * Posição da cadente no instante t (roteiro) com o referencial do líder da amostra j: lugar
   * na revoada (abrindo em leque ao nascer) misturado, perto do pouso, com a espiral em volta do
   * líder. No pouso o líder está no centro do disco e a espiral fecha nele.
   */
  private posCadenteViagem(o: number, t: number, j: number, out: Vector3): Vector3 {
    const p = this.cadParam;
    const q = this.cadLider;
    const b = j * NQ;
    const tE = p[o + P_T_ESP];
    const w = suave(t, tE - MISTURA_ESP, tE + 0.1);
    let ox = 0;
    let oy = 0;
    let oz = 0;
    if (w < 1) {
      const t0 = p[o + P_T_INI];
      const abre = outCubic(faixa(t, t0 - 0.05, t0 + 0.75));
      const fw = p[o + P_OW];
      const l = (p[o + P_OF] + p[o + P_OA] * Math.sin(fw * t + p[o + P_OFASE])) * abre;
      const c = (p[o + P_OF + 1] + p[o + P_OA + 1] * Math.sin(fw * 1.3 * t + p[o + P_OFASE + 1])) * abre;
      const f = (p[o + P_OF + 2] + p[o + P_OA + 2] * Math.sin(fw * 0.7 * t + p[o + P_OFASE + 2])) * abre;
      ox = q[b + 3] * l + q[b + 6] * c + q[b + 9] * f;
      oy = q[b + 4] * l + q[b + 7] * c + q[b + 10] * f;
      oz = q[b + 5] * l + q[b + 8] * c + q[b + 11] * f;
    }
    if (w > 0) {
      // espiral relativa ao centro do disco (onde o líder pousa)
      const e = this.espiralCadente(o, (t - tE) / (T_POUSO - tE), this.vEsp);
      ox += (e.x - ox) * w;
      oy += (e.y + SIN_INC * Z_CENTRO - oy) * w;
      oz += (e.z - COS_INC * Z_CENTRO - oz) * w;
    }
    return out.set(q[b] + ox, q[b + 1] + oy, q[b + 2] + oz);
  }

  /** Posição na explosão do resultado (t em s reais): arrasto, curva lateral e gravidade leve. */
  private posCadenteExplosao(o: number, t: number, out: Vector3): Vector3 {
    const p = this.cadParam;
    const tt = Math.max(0, t - p[o + P_T_INI]);
    const f = (1 - Math.exp(-1.25 * tt)) / 1.25;
    const q = 0.5 * tt * tt;
    return out.set(
      p[o + P_P0] + p[o + P_T0] * f + p[o + P_E] * q,
      p[o + P_P0 + 1] + p[o + P_T0 + 1] * f + (p[o + P_E + 1] - 0.7) * q,
      p[o + P_P0 + 2] + p[o + P_T0 + 2] * f + p[o + P_E + 2] * q,
    );
  }

  /**
   * Explosão do resultado: cadentes que saem (metade do ponteiro, metade da fatia) para cima,
   * para os lados e para a câmera, com curva lateral; nascem em ~0,2 s e vivem ~1,6–2,5 s.
   */
  private prepararExplosao() {
    const p = this.cadParam;
    const n = this.nCad;
    const rnd = gerador(1 + (Math.floor(performance.now()) % 100000));
    const v = this.vA;
    for (let i = 0; i < n; i++) {
      const o = i * NP;
      (i % 2 ? this.origemFatia : this.origemPonteiro).toArray(p, o + P_P0);
      const a = (i / n) * TAU + rnd() * 0.5;
      v.set(Math.sin(a), Math.cos(a) * 0.8 + 0.35, 0.3 + rnd() * 0.6).normalize().multiplyScalar(3.2 + rnd() * 3);
      v.toArray(p, o + P_T0);
      const curva = (rnd() < 0.5 ? -1 : 1) * (0.6 + rnd() * 0.8);
      p[o + P_E] = -v.y * curva * 0.35;
      p[o + P_E + 1] = v.x * curva * 0.35;
      p[o + P_E + 2] = 0;
      p[o + P_T_INI] = rnd() * 0.18;
      p[o + P_T_ESP] = 1.6 + rnd() * 0.9;
    }
    this.modoCadentes = 2;
  }

  /**
   * Um quadro das cadentes (entrada: t do roteiro; explosão: s reais da celebração): cabeças e
   * faixas dos rastros viradas para a câmera, amostrando a própria trajetória para trás.
   * Escreve direto nos arrays das geometrias (nada alocado). `mestre` multiplica o brilho.
   */
  private aplicarCadentes(t: number, mestre: number) {
    const explosao = this.modoCadentes === 2;
    const n = this.nCad;
    const m = this.nRastroCad;
    const p = this.cadParam;
    const attrC = this.cadCabecas.geometry.getAttribute("position") as BufferAttribute;
    const attrB = this.cadCabecas.geometry.getAttribute("aBrilho") as BufferAttribute;
    const attrR = this.cadRastros.geometry.getAttribute("position") as BufferAttribute;
    const attrA = this.cadRastros.geometry.getAttribute("aAlfa") as BufferAttribute;
    const posC = attrC.array as Float32Array;
    const bri = attrB.array as Float32Array;
    const posR = attrR.array as Float32Array;
    const alfa = attrA.array as Float32Array;
    const pts = this.cadAmostras;
    const cam = this.camera.position;
    const v = this.vA;
    const tan = this.vB;
    const olhar = this.vCima;
    const lado = this.vLadoRastro;
    const lag = explosao ? LAG_RASTRO_EXP : LAG_RASTRO_CAD;
    const largura = (explosao ? 0.028 : 0.036) * (this.leve ? 0.9 : 1);
    if (!explosao) {
      // referencial do líder em cada instante amostrado (o mesmo para todas as cadentes). No
      // pulo a câmera/líder seguem pela curva com o roteiro parado: a história anda junto (dS)
      const dS = this.sViagem - sDoRoteiro(t);
      for (let j = 0; j < m; j++) this.quadroLider(j, saturar(sDoRoteiro(t - (lag * j) / (m - 1)) + dS));
    }
    let alguma = false;
    for (let i = 0; i < n; i++) {
      const o = i * NP;
      const t0 = p[o + P_T_INI];
      let b: number;
      let aR: number;
      if (explosao) {
        const vida = p[o + P_T_ESP];
        b = suave(t, t0, t0 + 0.08) * (1 - suave(t, t0 + vida * 0.5, t0 + vida)) * 1.2;
        aR = b * 0.9;
      } else {
        const nasce = suave(t, t0 - 0.05, t0 + 0.2);
        b = nasce * (1 + 0.6 * suave(t, p[o + P_T_ESP], T_POUSO)) * (1 - suave(t, T_POUSO - 0.12, T_POUSO + 0.05));
        aR = nasce * (1 - suave(t, T_POUSO - 0.05, T_POUSO + 0.35));
      }
      b *= mestre;
      aR *= mestre;
      if (explosao) this.posCadenteExplosao(o, t, v);
      else this.posCadenteViagem(o, t, 0, v);
      posC[i * 3] = v.x;
      posC[i * 3 + 1] = v.y;
      posC[i * 3 + 2] = v.z;
      bri[i] = b > 0.002 ? b : 0;
      const base = i * m * 2;
      if (aR < 0.002) {
        for (let k = 0; k < m * 2; k++) alfa[base + k] = 0;
        alguma = alguma || b > 0.002;
        continue;
      }
      alguma = true;
      for (let j = 0; j < m; j++) {
        const tj = t - (lag * j) / (m - 1);
        if (explosao) this.posCadenteExplosao(o, tj, v);
        else this.posCadenteViagem(o, tj, j, v);
        pts[j * 3] = v.x;
        pts[j * 3 + 1] = v.y;
        pts[j * 3 + 2] = v.z;
      }
      for (let j = 0; j < m; j++) {
        const a = Math.max(0, j - 1) * 3;
        const c = Math.min(m - 1, j + 1) * 3;
        const q = j * 3;
        tan.set(pts[a] - pts[c], pts[a + 1] - pts[c + 1], pts[a + 2] - pts[c + 2]);
        olhar.set(pts[q] - cam.x, pts[q + 1] - cam.y, pts[q + 2] - cam.z);
        const dCam = olhar.length();
        this.vLado.crossVectors(tan, olhar);
        const len = this.vLado.length();
        if (len > 1e-7) lado.copy(this.vLado).divideScalar(len);
        // perto da câmera a faixa afina (não vira uma parede de luz)
        const w = largura * Math.pow(1 - j / (m - 1), 0.8) * Math.min(1, dCam / 2.5);
        const k = (base + j * 2) * 3;
        posR[k] = pts[q] - lado.x * w;
        posR[k + 1] = pts[q + 1] - lado.y * w;
        posR[k + 2] = pts[q + 2] - lado.z * w;
        posR[k + 3] = pts[q] + lado.x * w;
        posR[k + 4] = pts[q + 1] + lado.y * w;
        posR[k + 5] = pts[q + 2] + lado.z * w;
        alfa[base + j * 2] = aR;
        alfa[base + j * 2 + 1] = aR;
      }
    }
    this.cadCabecas.visible = alguma;
    this.cadRastros.visible = alguma;
    if (!alguma) return;
    attrC.needsUpdate = true;
    attrB.needsUpdate = true;
    attrR.needsUpdate = true;
    attrA.needsUpdate = true;
  }

  /**
   * Ponto de luz da entrada cadentes (a estrelaViajante): no nascimento acende no ponto de
   * partida do líder (o leque de cadentes sai dele) e se apaga quando a revoada parte; perto do
   * pouso, no centro: cresce enquanto elas se juntam, explode no flash e encolhe no medalhão.
   */
  private aplicarNucleoCadentes(tau: number) {
    const e = this.estrelaViajante;
    const cam = this.camera;
    const u = this.uEstrela;
    if (tau < 2) {
      const kN = faixa(tau, 0, 0.45);
      const nasc = (kN <= 0 ? 0 : outBack(kN)) * (1 - suave(tau, 0.55, 1.2));
      const dist = Math.max(0.3, this.vA.copy(this.vEstrela).sub(cam.position).length());
      const brilho = Math.min(1, kN * 4) * nasc * 1.3;
      e.visible = brilho * this.mestreChegada > 0.002;
      e.position.copy(this.vEstrela);
      e.quaternion.copy(cam.quaternion);
      e.scale.setScalar(Math.max(1e-4, 0.2 * nasc * 2 * TAN_MEIO_FOV * dist));
      u.uGiro.value = 0.4 * tau;
      u.uBrilho.value = brilho;
      u.uRaiosForca.value = 1.1;
      return;
    }
    const junta = suave(tau, 5.0, T_POUSO);
    const dp = tau - T_POUSO;
    const flash = dp < 0 ? Math.exp(-((dp / 0.08) ** 2)) : Math.exp(-dp / 0.18);
    const pulso = 1 + 0.1 * junta * Math.sin(tau * TAU * 2.5);
    const centro = this.vBase.set(0, -SIN_INC * Z_CENTRO, COS_INC * Z_CENTRO);
    const dist = Math.max(0.3, this.vA.copy(centro).sub(cam.position).length());
    let tamanho = ((0.05 + 0.2 * junta) * junta * pulso + 0.26 * flash) * 2 * TAN_MEIO_FOV * dist;
    tamanho += (2 * R_MEDALHAO - tamanho) * suave(tau, 6.75, 7.55);
    const brilho = (junta * 0.9 + 2.8 * flash) * (1 - suave(tau, 7.3, 7.85));
    e.visible = brilho * this.mestreChegada > 0.002;
    e.position.copy(centro);
    e.quaternion.copy(cam.quaternion);
    e.scale.setScalar(Math.max(1e-4, tamanho));
    u.uGiro.value = 0.4 * tau + 0.6 * flash;
    u.uBrilho.value = brilho;
    u.uRaiosForca.value = 0.7 + 0.9 * flash;
  }

  // ---------- celebração ao parar ----------
  /** Giro terminou: acende a fatia sob o ponteiro e solta a explosão (s reais, ~3 s). */
  private iniciarCelebracao() {
    const agora = performance.now();
    const theta = anguloAtual(this.store.rotacao, agora);
    const idx = fatiaSobPonteiro(this.fatias, theta);
    const f = this.fatias.find((x) => x.indice === idx);
    this.uSetor.uIni.value = f ? f.inicio : 0;
    this.uSetor.uLarg.value = f ? f.largura : 0;
    // a pose do quadro atual pode ser de um instante antes do fim do giro
    this.disco.rotation.z = -theta;
    this.inclinacao.updateMatrixWorld(true);
    this.origemPonteiro.set(0, R * 1.1 - 0.1, 0.12);
    this.inclinacao.localToWorld(this.origemPonteiro);
    const meio = f ? f.inicio + f.largura / 2 : 0;
    this.origemFatia.set(Math.sin(meio) * R * 0.62, Math.cos(meio) * R * 0.62, 0.06);
    this.disco.localToWorld(this.origemFatia);
    this.tCelebra = 0;
    this.mestreCelebra = 1;
    this.prepararExplosao();
    this.enxame.visible = true;
    this.matEnxame.uniforms.uT.value = 0;
  }

  /** Para a celebração na hora (nova chegada, roleta mostrada direto ou apagada). */
  private encerrarCelebracao() {
    if (this.tCelebra < 0) return;
    this.tCelebra = -1;
    this.mestreCelebra = 0;
    this.setor.visible = false;
    this.enxame.visible = false;
    this.matEnxame.uniforms.uAlfa.value = 0;
    this.ponteiro.scale.set(0.75, 1.5, 0.55);
    if (this.modoRevelacao !== "chegando") this.medalhao.scale.setScalar(1);
    this.uAnel.uCoresMix.value = 0;
    if (this.modoCadentes === 2) {
      this.modoCadentes = 0;
      this.cadCabecas.visible = false;
      this.cadRastros.visible = false;
    }
    if (this.modoRevelacao !== "chegando") {
      this.estrelaViajante.visible = false;
      this.anel.visible = false;
    }
  }

  private aplicarCelebracao(dt: number) {
    this.tCelebra += dt;
    const tc = this.tCelebra;
    // saiu do resultado: tudo se apaga em ~0,3 s (a saída da roleta segue por cima)
    if (this.fase !== "resultado") this.mestreCelebra = Math.max(0, this.mestreCelebra - dt * 3);
    const mc = this.mestreCelebra;
    if (mc <= 0 || (this.modoRevelacao !== "visivel" && this.modoRevelacao !== "saindo")) {
      this.encerrarCelebracao();
      return;
    }
    const ativa = tc < DUR_CELEBRA;

    // fatia vencedora: acende, pulsa, duas varreduras de luz e fica levemente acesa
    const us = this.uSetor;
    const pulsoAmp = Math.exp(-tc / 1.2);
    us.uAlfa.value = mc * suave(tc, 0, 0.18) * (BRILHO_FATIA_FINAL + (1 - BRILHO_FATIA_FINAL) * (1 - suave(tc, 1.6, DUR_CELEBRA)));
    us.uPulso.value = (0.5 + 0.5 * Math.sin(tc * TAU * 2.2)) * (0.3 + 0.7 * pulsoAmp);
    us.uVarre.value = tc < 1.8 ? -0.2 + 1.4 * ((tc / 0.9) % 1) : 3;
    this.setor.visible = us.uLarg.value > 0 && us.uAlfa.value > 0.002;

    // medalhão pulsa de leve durante todo o resultado (mais forte no começo); some com mc
    const pm = 0.5 + 0.5 * Math.sin(tc * TAU * 0.9);
    this.medalhao.scale.setScalar(1 + mc * pm * (0.018 + 0.03 * Math.exp(-tc / 1.4)));

    if (!ativa) {
      // fim da parte animada: sobra só a fatia acesa
      if (this.ponteiro.scale.x !== 0.75) this.ponteiro.scale.set(0.75, 1.5, 0.55);
      this.estrelaViajante.visible = false;
      this.anel.visible = false;
      this.enxame.visible = false;
      if (this.modoCadentes === 2) {
        this.modoCadentes = 0;
        this.cadCabecas.visible = false;
        this.cadRastros.visible = false;
      }
      return;
    }

    // ponteiro pulsa, com uma estrela acesa na ponta
    const kp = Math.exp(-tc / 1.4);
    const pp = 0.5 + 0.5 * Math.sin(tc * TAU * 1.6 - Math.PI / 2);
    const s = 1 + 0.22 * kp * pp * mc;
    this.ponteiro.scale.set(0.75 * s, 1.5 * s, 0.55 * s);
    const e = this.estrelaViajante;
    const cam = this.camera;
    const flash0 = Math.exp(-tc / 0.25);
    const brilho = mc * (2 * flash0 + 0.55 * kp * (0.6 + 0.4 * pp)) * (1 - suave(tc, 2.2, DUR_CELEBRA));
    const dist = Math.max(0.3, this.vA.copy(this.origemPonteiro).sub(cam.position).length());
    e.visible = brilho > 0.002;
    e.position.copy(this.origemPonteiro);
    e.quaternion.copy(cam.quaternion);
    e.scale.setScalar(Math.max(1e-4, (0.09 + 0.05 * pp * kp + 0.12 * flash0) * 2 * TAN_MEIO_FOV * dist));
    const u = this.uEstrela;
    u.uGiro.value = 0.6 * tc;
    u.uBrilho.value = brilho;
    u.uRaiosForca.value = 0.8 + 0.8 * flash0;

    // anel de luz: onda que se expande do centro + arco colorido pelo aro
    const ua = this.uAnel;
    const kOnda = faixa(tc, 0, 1);
    const onda = 2.6 * outCubic(kOnda);
    const alfaOnda = tc < 1 ? (1 - kOnda) ** 1.4 * 0.9 * mc : 0;
    const alfaArco = suave(tc, 0.05, 0.15) * (1 - suave(tc, 1.2, 1.7)) * mc;
    ua.uOnda.value = onda;
    ua.uAlfaOnda.value = alfaOnda;
    ua.uArco.value = (TAU + 0.7) * inOutCubic(faixa(tc, 0.05, 1.1));
    ua.uAlfaArco.value = alfaArco;
    ua.uCoresMix.value = 1;
    const rMin = this.leve ? 1.32 : 1.47;
    const raioQuad = alfaOnda > 0.002 ? Math.min(2.8, Math.max(rMin, onda + 0.45)) : rMin;
    ua.uRaioQuad.value = raioQuad;
    this.anel.scale.setScalar(raioQuad);
    this.anel.visible = alfaOnda > 0.002 || alfaArco > 0.002;

    // explosão: cadentes (CPU, ~1 ms) + faíscas (GPU)
    if (this.modoCadentes === 2) this.aplicarCadentes(tc, mc);
    this.enxame.visible = true;
    this.matEnxame.uniforms.uT.value = tc;
    this.matEnxame.uniforms.uAlfa.value = mc * (1 - suave(tc, 2.4, DUR_CELEBRA));
  }

  /** Esconde tudo o que só existe durante a viagem/transformação. */
  private esconderViagem() {
    this.estrelaViajante.visible = false;
    this.rastro.visible = false;
    this.warp.visible = false;
    this.ligacoes.visible = false;
    this.nosAcesos.visible = false;
    this.anel.visible = false;
    this.cadCabecas.visible = false;
    this.cadRastros.visible = false;
    this.modoCadentes = 0;
  }

  /** Saída: a roleta toma impulso, encolhe e se desfaz em faíscas; a viagem (se houver) se apaga. */
  private aplicarSaida(u: number, dt: number) {
    const s = Math.max(1e-4, this.rSaida * (1 - inBack(u)));
    this.inclinacao.scale.setScalar(s);
    this.uFace.uOpacidade.value = Math.min(this.uFace.uOpacidade.value, 1 - suave(u, 0.4, 0.9));
    this.uFace.uBorda.value = Math.max(0, this.uFace.uBorda.value - dt * 4);
    this.matBrilho.opacity = Math.min(this.matBrilho.opacity, 1 - suave(u, 0.15, 0.5));
    const flash = Math.exp(-(((u - 0.55) / 0.12) ** 2));
    this.matHalo.opacity = Math.min(1, this.rSaida * 1.5) * (1 - suave(u, 0.6, 1));
    this.matHalo.color.setScalar(1 + flash * 2.5);
    this.halo.scale.setScalar(Math.max(1e-4, s * (1 + flash * 0.4)));
    this.uMestre.value = Math.max(0, this.uMestre.value - dt * 4);
    if (this.uMestre.value <= 0) this.esconderViagem();
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
    // pesoPerseguicao não é zerado: se a chegada acabou com a câmera ainda saindo da
    // perseguição (pulo/giro), ela termina de voltar em avancarRevelacao, sem salto
    this.esconderViagem();
    this.uMestre.value = 1;
    this.inclinacao.visible = true;
    this.inclinacao.scale.setScalar(1);
    this.halo.visible = true;
    this.halo.scale.setScalar(1);
    this.matHalo.opacity = 1;
    this.matHalo.color.setScalar(1);
    this.uFace.uRaio.value = 2;
    this.uFace.uBorda.value = 0;
    this.uFace.uOpacidade.value = 1;
    this.face.visible = true;
    this.escalar(this.aro, 1, 0);
    this.escalar(this.lateral, 1, -0.07);
    this.escalar(this.fundo, 1, -0.14);
    this.escalar(this.cubo, 1, 0.04);
    this.escalar(this.anelCubo, 1, Z_MEDALHAO);
    this.escalar(this.medalhao, 1, Z_MEDALHAO);
    this.matBrilho.opacity = 1;
    this.brilho.visible = true;
    this.ponteiro.visible = true;
    this.ponteiro.position.y = R * 1.1;
    this.arcoPinos = Infinity;
    this.pinos.visible = true;
    this.posicionarPinos();
  }

  /** Só a tela de CPF: nada da roleta é desenhado. */
  private aplicarOculta() {
    this.inclinacao.visible = false;
    this.inclinacao.scale.setScalar(1);
    this.halo.visible = false;
    this.esconderViagem();
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
    const alvoInclinacao = ativo ? INCLINACAO_ATIVA : -0.06;
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
    // amplitude e elevação extra amortecidas: sem salto ao entrar em "pronto" nem ao girar
    const alvoAmp = this.leve ? 0 : giroFinal ? 0.25 : 1;
    this.ampAtual += (alvoAmp - this.ampAtual) * (1 - Math.exp(-dt * 2));
    this.elAtivo += ((ativo ? 0.05 : 0) - this.elAtivo) * k;
    const amplitude = this.ampAtual;
    const az = (Math.sin(t * 0.21) * 0.05 + p.x * 0.07) * amplitude;
    const el = (0.06 + Math.sin(t * 0.17) * 0.025 + p.y * 0.04) * amplitude + this.elAtivo;

    this.distBase = ((R * 1.12 * H) / (2 * raio * TAN_MEIO_FOV)) * (1 - 0.08 * this.aproximacao);
    const dist = this.distBase;
    const cam = this.camera;
    cam.position.set(Math.sin(az) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist);
    cam.lookAt(0, 0, 0);

    // chegada: mistura com a câmera de perseguição. Posição linear; a orientação é um lookAt
    // da posição misturada para um alvo entre a origem (enquadramento) e o da perseguição
    // (logo à frente da estrela), mais a rolagem proporcional: a estrela fica no quadro
    // durante a mistura (um slerp entre as duas orientações podia deixá-la de fora)
    let w = this.pesoPerseguicao;
    if (w > 0.0005 && this.compCurva > 0 && !this.viagemPendente) {
      this.posEnq.copy(cam.position);
      this.calcularPerseguicao();
      cam.position.lerpVectors(this.posEnq, this.posPerseg, w);
      cam.lookAt(this.vA.copy(this.alvoPerseg).multiplyScalar(w));
      cam.rotateZ(-this.rolagemPerseg * w);
    } else w = 0;

    // desloca a projeção para a roleta cair exatamente na célula do layout (centrada na viagem)
    const fora = 1 - w;
    cam.setViewOffset(W, H, (W / 2 - cx) * fora, (H / 2 - cy) * fora, W, H);
    cam.updateProjectionMatrix();
  }

  private atualizarFaiscas(dt: number) {
    const attr = this.faiscas.geometry.getAttribute("position") as BufferAttribute;
    let mudou = false;
    const pool = this.poolFaiscas;
    for (let i = 0; i < pool.length; i++) {
      const f = pool[i];
      if (f.vida <= 0) continue;
      f.vida -= dt * 0.9;
      f.vel.multiplyScalar(1 - dt * 1.8);
      f.pos.addScaledVector(f.vel, dt);
      if (f.vida <= 0) f.pos.set(9999, 9999, 9999);
      attr.setXYZ(i, f.pos.x, f.pos.y, f.pos.z);
      mudou = true;
    }
    if (mudou) attr.needsUpdate = true;
  }

  /** Liga a conversão de cor de saída (COR_CORRETA) em todos os ShaderMaterial da cena. */
  private ligarCorCorreta() {
    const hdr = !!this.composer;
    const ligar = (m: unknown) => {
      const s = m as ShaderMaterial;
      if (!s || !s.isShaderMaterial) return;
      const defs: Record<string, unknown> = { ...s.defines, COR_CORRETA: "" };
      if (hdr) defs.NO_ALVO_HDR = "";
      else delete defs.NO_ALVO_HDR;
      s.defines = defs;
      s.needsUpdate = true;
    };
    this.cena.traverse((o) => {
      const m = (o as Mesh).material;
      if (Array.isArray(m)) m.forEach(ligar);
      else ligar(m);
    });
    this.descartaveis.forEach(ligar);
  }

  /**
   * Nível alto: pós-processamento com bloom real. A cena é desenhada num alvo HDR (meia-precisão,
   * MSAA 4x), o UnrealBloomPass faz o brilho só do que passa do limiar e o OutputPass aplica
   * tone mapping (Neutral: preserva as cores da paleta) e a conversão para sRGB.
   */
  private ligarBloom() {
    try {
      const alvo = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
      const composer = new EffectComposer(this.renderer, alvo);
      composer.setPixelRatio(this.dprAtual);
      composer.addPass(new RenderPass(this.cena, this.camera));
      const bloom = new UnrealBloomPass(new Vector2(256, 256), BLOOM_FORCA, BLOOM_RAIO, BLOOM_LIMIAR);
      composer.addPass(bloom);
      composer.addPass(new OutputPass());
      this.renderer.toneMapping = NeutralToneMapping;
      // ao limpar o alvo HDR o three converte a cor de fundo para sRGB, e o OutputPass converte de novo
      // no fim: pré-compensa para o fundo sair exatamente no azul da paleta
      this.renderer.setClearColor(new Color(COR_FUNDO).convertSRGBToLinear());
      this.renderer.toneMappingExposure = 1;
      this.composer = composer;
      this.bloom = bloom;
    } catch (e) {
      console.warn("Bloom indisponível; seguindo sem pós-processamento.", e);
      this.composer = null;
      this.bloom = null;
    }
  }

  /** Volta ao desenho direto (sem bloom). Usado pelo avaliador de desempenho e no descarte. */
  private desligarBloom(avisar = true) {
    if (!this.composer) return;
    this.bloom?.dispose();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer.dispose();
    this.composer = null;
    this.bloom = null;
    this.renderer.toneMapping = NoToneMapping;
    this.renderer.setClearColor(new Color(COR_FUNDO));
    this.ajustarBrilhoMedalhao();
    // shaders voltam a escrever direto na tela (recompila uma vez)
    if (avisar && !this.destruido) this.ligarCorCorreta();
    if (avisar) this.avisarNivel();
  }

  /** Informa a interface do nível efetivo (o avaliador pode ter baixado a resolução). */
  private avisarNivel() {
    const detalhe = `${this.nivel}${this.composer ? " + bloom" : ""} · DPR ${this.dprAtual.toFixed(2)}`;
    queueMicrotask(() => window.dispatchEvent(new CustomEvent("roleta:nivel", { detail: detalhe })));
  }

  private falhar(motivo: string) {
    if (this.falhou) return;
    this.falhou = true;
    this.opcoes.aoFalhar(motivo);
  }

  /**
   * Avaliação inicial (por tempo, normalizada pelo vsync da tela) + monitor contínuo.
   * Só rebaixa e nunca decide no meio do giro nem da chegada/saída da roleta (o estado vive
   * no TotemStore, nada se perde). Sem alocação: amostras num Float32Array ordenado.
   */
  private avaliarDesempenho(dtMs: number, agora: number) {
    if (agora - this.inicio < 1500) return;
    // chegada/saída: animação de passagem, com picos próprios; não conta para o monitor
    const revelando = this.modoRevelacao === "chegando" || this.modoRevelacao === "saindo";
    if (revelando) {
      this.lentoDesde = 0;
    } else {
      this.ema = this.ema ? this.ema * 0.95 + dtMs * 0.05 : dtMs;
      if (this.ema > 45) {
        if (!this.lentoDesde) this.lentoDesde = agora;
        else if (agora - this.lentoDesde > 3000 && this.fase !== "girando") {
          // primeiro desliga o bloom, depois baixa a resolução; só cai para o 2D no mínimo
          if (this.composer) {
            this.desligarBloom();
            this.ema = 0;
            this.lentoDesde = 0;
            return;
          }
          if (this.dprAtual > 0.75) {
            this.dprAtual = this.dprAtual > 1 ? 1 : 0.75;
            this.avisarNivel();
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
    }

    if (this.avaliado) return;
    // giro e chegada/saída: a janela recomeça do zero depois, com a cena parada (nenhuma
    // decisão, nem falhar nem trocar o DPR, acontece no meio deles)
    if (revelando || this.fase === "girando") {
      this.nAmostras = 0;
      this.janelaInicio = 0;
      return;
    }
    if (!this.janelaInicio) this.janelaInicio = agora;
    // inserção ordenada (n ≤ 90): mediana e percentil direto do buffer
    const ord = this.amostrasQuadro;
    if (this.nAmostras < MAX_AMOSTRAS) {
      let j = this.nAmostras++;
      while (j > 0 && ord[j - 1] > dtMs) {
        ord[j] = ord[j - 1];
        j--;
      }
      ord[j] = dtMs;
    }
    const n = this.nAmostras;
    const mediana = ord[Math.floor(n / 2)];
    if (n >= 15 && mediana > 60) {
      this.falhar(`desempenho insuficiente (${mediana.toFixed(0)} ms por quadro)`);
      return;
    }
    if (agora - this.janelaInicio < 2000 && n < MAX_AMOSTRAS) return;
    const periodo = Math.max(6, ord[Math.floor(n * 0.1)]); // ~16,7 ms em 60 Hz; ~33 ms em 30 Hz
    const limiteFalha = Math.max(34, periodo * 2.2);
    const limiteReduz = Math.max(21, periodo * 1.4);
    this.nAmostras = 0;
    this.janelaInicio = 0;
    if (this.composer && mediana > limiteReduz) {
      this.desligarBloom();
    } else if (mediana > limiteFalha) {
      this.falhar(`desempenho insuficiente (${mediana.toFixed(0)} ms por quadro)`);
    } else if (mediana > limiteReduz && this.dprAtual > 0.75) {
      this.dprAtual = this.dprAtual > 1 ? 1 : 0.75;
      this.avisarNivel();
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
    this.thetaAtual = theta;
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

    const rotFitas = Math.sin(t * 0.05) * 0.01;
    for (let k = 0; k < this.fitas.length; k++) this.fitas[k].rotation.z = rotFitas;
    this.avancarRevelacao(dt);
    this.atualizarCamera(dt, t);
    this.aplicarRevelacao(dt);
    if (this.tCelebra >= 0) this.aplicarCelebracao(dt);
    this.atualizarFaiscas(dt);
    if (this.composer) this.composer.render();
    else this.renderer.render(this.cena, this.camera);
    this.avaliarDesempenho(dtMs, agora);
  }
}
