/** Decide se o PC aguenta o 3D. O 2D é sempre o piso seguro. */
export interface AvaliacaoWebGL {
  ok: boolean;
  motivo?: string;
  renderizador?: string;
}

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render|microsoft basic|\bwarp\b/i;

export function avaliarWebGL(): AvaliacaoWebGL {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2", { failIfMajorPerformanceCaveat: true }) as WebGL2RenderingContext | null;
    if (!gl) return { ok: false, motivo: "WebGL 2 indisponível ou sem aceleração de GPU" };
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    const renderizador = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    if (SOFTWARE.test(renderizador)) return { ok: false, motivo: `renderização por software (${renderizador})`, renderizador };
    return { ok: true, renderizador };
  } catch (e) {
    return { ok: false, motivo: e instanceof Error ? e.message : "falha ao testar WebGL" };
  }
}
