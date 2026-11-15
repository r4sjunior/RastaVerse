// Worker do mapa: todo o trabalho pesado do depth (desprojeção, encaixe nos planos, voxels e
// "carving") roda aqui, fora da thread que desenha a tela — o AR não engasga.
//
// Entrada:  {t:'init', res} · {t:'frame', f, step, planes, flipY, ingest, calib:{x,y,z}|null}
//           {t:'surface', pts: Float32Array [x,y,z,...]} · {t:'clear'}
// Saída:    {t:'delta', added: Float64Array [key, top, ...], removed: Float64Array [key, ...], scores?}
import { VoxelMap, unpackKey, packKey } from '/shared/voxelmap.js';
import { unprojectDepth, scoreOrientation } from '/shared/depth.js';

let map = null;
let planes = [];
const t3 = [0, 0, 0];

function snap(y) {
  for (const p of planes) if (p.n >= 3 && y > p.y - 0.04 && y < p.y + 0.035) return p.y - 0.002;
  return y;
}

/**
 * Fecha buracos dentro de superfícies planas (mesa, chão): a "sombra" atrás de objetos que a câmera
 * não vê e falhas do depth. Em cada plano do ARCore, um vão de até MAXGAP voxels entre duas células
 * confirmadas da mesma camada (em x ou em z) é preenchido na altura do plano. Bordas reais ficam
 * abertas (do outro lado não há superfície), então o avatar ainda cai da mesa.
 */
const MAXGAP = 7;
/** coluna "sólida" na altura do plano: a própria superfície ou um objeto apoiado nela (livro, caixa) */
function solidCol(i, j, k) {
  for (let dj = 0; dj <= 5; dj++) if (map.isOccupied(packKey(i, j + dj, k))) return true;
  return false;
}
function fillPlanes() {
  const r = map.res;
  for (const p of planes) {
    if (p.n < 10) continue;
    const y = p.y - 0.002, j = Math.floor(y / r);
    const cells = [];
    for (const [key, v] of map.cells) {
      if (v < map.occ) continue;
      unpackKey(key, t3);
      if (t3[1] === j) cells.push(t3[0], t3[2]);
    }
    for (let c = 0; c < cells.length; c += 2) {
      const i = cells[c], k = cells[c + 1];
      for (const [di, dk] of [[1, 0], [0, 1]]) {
        for (let s = 2; s <= MAXGAP; s++) {
          if (!solidCol(i + di * s, j, k + dk * s)) continue;
          for (let m = 1; m < s; m++) {
            const ii = i + di * m, kk = k + dk * m;
            if (!solidCol(ii, j, kk)) map.addPoint((ii + 0.5) * r, y, (kk + 0.5) * r, 3);
          }
          break;
        }
      }
    }
  }
}
let frames = 0;

function reply(extra = {}) {
  const d = map.drain();
  const added = new Float64Array(d.added.length * 2);
  d.added.forEach((key, i) => { unpackKey(key, t3); added[i * 2] = key; added[i * 2 + 1] = map.surfaceTop(key, t3[1]); });
  const removed = Float64Array.from(d.removed);
  postMessage({ t: 'delta', added, removed, occupied: map.occupied, ...extra }, [added.buffer, removed.buffer]);
}

onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') {
    // occ 6 = 3 leituras confirmando o voxel (menos fantasmas); hit-test de plano conta igual
    map = new VoxelMap({ res: m.res, hit: 2, miss: 1, occ: 6, max: 24, trackY: true });
    return;
  }
  if (!map) return;
  if (m.t === 'clear') { map.clear(); reply(); return; }
  if (m.t === 'surface') {
    const p = m.pts;
    for (let i = 0; i < p.length; i += 3) map.addPoint(p[i], p[i + 1] - 0.002, p[i + 2], 1);
    return; // o delta sai junto com o próximo quadro
  }
  if (m.t === 'frame') {
    planes = m.planes || [];
    const f = m.f;
    let scores;
    if (m.calib) scores = scoreOrientation(f, m.calib.y, m.calib.x, m.calib.z);
    if (m.ingest) {
      let i = 0;
      const hasPlanes = planes.length > 0;
      unprojectDepth(f, (x, y, z, ox, oy, oz) => {
        if (hasPlanes) y = snap(y);
        map.addPoint(x, y, z);
        if ((i++ % 6) === 0) map.carve(ox, oy, oz, x, y, z, 100);
      }, { step: m.step || 2, maxDepth: 2.8, flipY: m.flipY });
      if (++frames % 4 === 0) fillPlanes();
    }
    reply(scores ? { scores } : {});
  }
};
