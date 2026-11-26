/**
 * Proteção do CPF: guardamos apenas uma chave derivada por PBKDF2-SHA-256 com sal do evento.
 * Isto é PSEUDONIMIZAÇÃO, não anonimização: existem só ~10^9 CPFs válidos e o sal fica junto
 * dos dados, então a chave pode ser revertida por força bruta com esforço. Por isso os dados
 * devem ser apagados ao encerrar o evento (botão no administrador).
 */

export const ITERACOES_PADRAO = 120_000;

function sutil(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new Error("WebCrypto indisponível: abra a roleta em http://localhost.");
  return s;
}

function paraHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function bytesParaBase64(bytes: Uint8Array): string {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

export function base64ParaBytes(b64: string): Uint8Array<ArrayBuffer> {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

export function novoSal(): string {
  const a = new Uint8Array(16);
  globalThis.crypto.getRandomValues(a);
  return bytesParaBase64(a);
}

export async function chaveCpf(cpf11: string, salB64: string, iteracoes: number): Promise<string> {
  const s = sutil();
  const chave = await s.importKey("raw", new TextEncoder().encode(cpf11), "PBKDF2", false, ["deriveBits"]);
  const bits = await s.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: base64ParaBytes(salB64), iterations: iteracoes },
    chave,
    256,
  );
  return paraHex(bits);
}

export async function hashPin(pin: string, salB64: string): Promise<string> {
  const dados = new TextEncoder().encode(`${salB64}:pin:${pin}`);
  return paraHex(await sutil().digest("SHA-256", dados));
}
