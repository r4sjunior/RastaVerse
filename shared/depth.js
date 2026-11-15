// Desprojeção do depth do ARCore (WebXR Depth Sensing, cpu-optimized) para pontos no mundo.
// Usado igual no celular (física local) e no servidor (nuvem de pontos / reconstrução).
//
// Convenções do WebXR:
//  - coordenadas de view normalizadas: (0,0) no canto superior esquerdo, y para baixo;
//  - normDepthBufferFromNormView leva view normalizada -> buffer de depth normalizado;
//  - depth = distância ao longo do eixo óptico (z de câmera), em rawValue * rawValueToMeters.
import { invert, transform4 } from './mat4.js';

/**
 * @param {object} f  quadro: { width, height, data (Uint16Array|Float32Array), rawValueToMeters,
 *                    worldFromView[16], projection[16], normDepthFromNormView[16] }
 * @param {(x:number,y:number,z:number, ox:number,oy:number,oz:number)=>void} emit  ponto no mundo + origem da câmera
 * @param {{step?:number, minDepth?:number, maxDepth?:number}} opt
 * @returns {number} pontos emitidos
 */
export function unprojectDepth(f, emit, opt = {}) {
  const step = opt.step || 2, minD = opt.minDepth ?? 0.15, maxD = opt.maxDepth ?? 4.0;
  const flipY = opt.flipY ?? !!f.flipY;
  // "pixels voadores": na borda entre um objeto e o fundo o sensor mistura as duas distâncias e cria
  // pontos no ar (fantasmas). Descarta o pixel se ele difere mais que `edge` (fração) de um vizinho.
  const edge = opt.edge ?? 0.08;
  const viewFromDepth = invert(f.normDepthFromNormView) || f.normDepthFromNormView;
  const invProj = invert(f.projection);
  const W = f.worldFromView;
  const ox = W[12], oy = W[13], oz = W[14];
  const { width: w, height: h, data } = f;
  const s = f.rawValueToMeters;
  const t = [0, 0, 0, 0];
  let n = 0;
  for (let py = step >> 1; py < h; py += step) {
    for (let px = step >> 1; px < w; px += step) {
      const idx = py * w + px;
      const raw = data[idx];
      if (!raw) continue;
      if (edge > 0) {
        const lim = raw * edge;
        const l = px > 0 ? data[idx - 1] : raw, r = px + 1 < w ? data[idx + 1] : raw;
        const u = py > 0 ? data[idx - w] : raw, b = py + 1 < h ? data[idx + w] : raw;
        if (!l || !r || !u || !b || Math.abs(l - raw) > lim || Math.abs(r - raw) > lim || Math.abs(u - raw) > lim || Math.abs(b - raw) > lim) continue;
      }
      const d = raw * s;
      if (d < minD || d > maxD) continue;
      // buffer de depth normalizado -> view normalizada
      transform4(viewFromDepth, (px + 0.5) / w, (py + 0.5) / h, 0, 1, t);
      const u = t[0] / (t[3] || 1);
      let v = t[1] / (t[3] || 1);
      if (flipY) v = 1 - v;
      // NDC -> raio em espaço de câmera
      transform4(invProj, u * 2 - 1, 1 - v * 2, 1, 1, t);
      const rx = t[0] / t[3], ry = t[1] / t[3], rz = t[2] / t[3];
      if (rz >= 0) continue;
      const k = d / -rz;
      const vx = rx * k, vy = ry * k, vz = rz * k;
      emit(
        W[0] * vx + W[4] * vy + W[8] * vz + W[12],
        W[1] * vx + W[5] * vy + W[9] * vz + W[13],
        W[2] * vx + W[6] * vy + W[10] * vz + W[14],
        ox, oy, oz,
      );
      n++;
    }
  }
  return n;
}

/**
 * Autocalibração da orientação vertical do depth no aparelho real.
 * Usa o plano do hit-test (verdade do ARCore): desprojeta a região central do depth nas duas
 * hipóteses (normal e com v invertido) e mede a distância mediana dos pontos até o plano y=planeY
 * perto do alvo (px,pz). A hipótese certa dá erro de ~1 cm; a errada, dezenas de cm.
 * @returns {[number, number]} [erro normal, erro invertido] em metros (Infinity se sem pontos)
 */
export function scoreOrientation(f, planeY, px, pz, radius = 0.35) {
  const out = [];
  for (const flipY of [false, true]) {
    const errs = [];
    unprojectDepth(f, (x, y, z) => {
      if (Math.hypot(x - px, z - pz) < radius) errs.push(Math.abs(y - planeY));
    }, { step: 3, flipY, maxDepth: 3 });
    errs.sort((a, b) => a - b);
    out.push(errs.length >= 15 ? errs[errs.length >> 1] : Infinity);
  }
  return out;
}
