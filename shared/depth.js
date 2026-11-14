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
      const raw = data[py * w + px];
      if (!raw) continue;
      const d = raw * s;
      if (d < minD || d > maxD) continue;
      // buffer de depth normalizado -> view normalizada
      transform4(viewFromDepth, (px + 0.5) / w, (py + 0.5) / h, 0, 1, t);
      const u = t[0] / (t[3] || 1), v = t[1] / (t[3] || 1);
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
