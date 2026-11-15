// Worker do mapa: todo o trabalho pesado do depth (desprojeção, encaixe nos planos, voxels e
// "carving") roda aqui, fora da thread que desenha a tela — o AR não engasga.
//
// Entrada:  {t:'init', res} · {t:'frame', f, step, planes, flipY, ingest, calib:{x,y,z}|null}
//           {t:'surface', pts: Float32Array [x,y,z,...]} · {t:'clear'}
// Saída:    {t:'delta', added: Float64Array [key, top, ...], removed: Float64Array [key, ...], scores?}
import { VoxelMap, unpackKey } from '/shared/voxelmap.js';
import { unprojectDepth, scoreOrientation } from '/shared/depth.js';

let map = null;
let planes = [];
const t3 = [0, 0, 0];

function snap(y) {
  for (const p of planes) if (p.n >= 3 && y > p.y - 0.04 && y < p.y + 0.035) return p.y - 0.002;
  return y;
}

function reply(extra = {}) {
  const d = map.drain();
  const added = new Float64Array(d.added.length * 2);
  d.added.forEach((key, i) => { unpackKey(key, t3); added[i * 2] = key; added[i * 2 + 1] = map.surfaceTop(key, t3[1]); });
  const removed = Float64Array.from(d.removed);
  postMessage({ t: 'delta', added, removed, ...extra }, [added.buffer, removed.buffer]);
}

onmessage = (e) => {
  const m = e.data;
  if (m.t === 'init') { map = new VoxelMap({ res: m.res, hit: 2, miss: 1, occ: 4, max: 24, trackY: true }); return; }
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
    }
    reply(scores ? { scores } : {});
  }
};
