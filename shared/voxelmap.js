// Mapa de ocupação esparso (voxel hashing) com evidência positiva (pontos de depth)
// e negativa (raio livre entre a câmera e o ponto = "carving"), para que objetos que
// se movem (mão, pessoa) sumam do mapa. Roda no browser e no Node.

const OFF = 65536;          // índices em [-65536, 65535] -> ±1966 m com voxel de 3 cm
const SPAN = 131072;

export function packKey(i, j, k) {
  return ((i + OFF) * SPAN + (j + OFF)) * SPAN + (k + OFF);
}
export function unpackKey(key, out = [0, 0, 0]) {
  const k = key % SPAN;
  const r = (key - k) / SPAN;
  const j = r % SPAN;
  const i = (r - j) / SPAN;
  out[0] = i - OFF; out[1] = j - OFF; out[2] = k - OFF;
  return out;
}

export class VoxelMap {
  /**
   * @param {object} o
   * @param {number} o.res     tamanho do voxel em metros
   * @param {number} o.hit     evidência somada por ponto
   * @param {number} o.miss    evidência removida por raio livre
   * @param {number} o.occ     limiar para considerar ocupado
   * @param {number} o.max     teto da evidência (quanto maior, mais "teimoso")
   */
  constructor({ res = 0.03, hit = 2, miss = 1, occ = 4, max = 24, trackY = false } = {}) {
    this.res = res; this.hit = hit; this.miss = miss; this.occ = occ; this.max = max;
    this.cells = new Map();     // key -> evidência
    // altura média dos pontos dentro de cada voxel: dá o topo real da superfície (sub-voxel)
    this.meanY = trackY ? new Map() : null;
    this.added = new Set();
    this.removed = new Set();
    this.occupied = 0;
  }

  index(v) { return Math.floor(v / this.res); }
  key(x, y, z) { return packKey(this.index(x), this.index(y), this.index(z)); }
  isOccupied(key) { return (this.cells.get(key) || 0) >= this.occ; }
  isOccupiedAt(x, y, z) { return this.isOccupied(this.key(x, y, z)); }

  _bump(key, delta) {
    const before = this.cells.get(key) || 0;
    let after = Math.max(0, Math.min(this.max, before + delta));
    if (after === before) return;
    if (after === 0) { this.cells.delete(key); this.meanY?.delete(key); } else this.cells.set(key, after);
    const wasOcc = before >= this.occ, isOcc = after >= this.occ;
    if (!wasOcc && isOcc) {
      this.occupied++;
      if (this.removed.has(key)) this.removed.delete(key); else this.added.add(key);
    } else if (wasOcc && !isOcc) {
      this.occupied--;
      if (this.added.has(key)) this.added.delete(key); else this.removed.add(key);
    }
  }

  addPoint(x, y, z, weight = 1) {
    const key = this.key(x, y, z);
    if (this.meanY) {
      const m = this.meanY.get(key);
      this.meanY.set(key, m === undefined ? y : m + (y - m) * 0.15 * weight);
    }
    this._bump(key, this.hit * weight);
  }

  /** topo da superfície dentro do voxel (média dos pontos), ou o topo do voxel */
  surfaceTop(key, j) {
    const r = this.res, m = this.meanY?.get(key);
    if (m === undefined) return (j + 1) * r;
    return Math.min((j + 1) * r, Math.max(j * r + r * 0.1, m));
  }

  /** marca como livre os voxels atravessados pelo raio origem->ponto (exceto os 2 últimos) */
  carve(ox, oy, oz, px, py, pz, maxSteps = 256) {
    const r = this.res;
    let i = Math.floor(ox / r), j = Math.floor(oy / r), k = Math.floor(oz / r);
    const ei = Math.floor(px / r), ej = Math.floor(py / r), ek = Math.floor(pz / r);
    const dx = px - ox, dy = py - oy, dz = pz - oz;
    const len = Math.hypot(dx, dy, dz);
    if (len < r * 3) return;
    const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
    const tdx = sx ? Math.abs(r / dx) : Infinity, tdy = sy ? Math.abs(r / dy) : Infinity, tdz = sz ? Math.abs(r / dz) : Infinity;
    let tmx = sx ? ((sx > 0 ? (i + 1) * r - ox : ox - i * r) / Math.abs(dx)) : Infinity;
    let tmy = sy ? ((sy > 0 ? (j + 1) * r - oy : oy - j * r) / Math.abs(dy)) : Infinity;
    let tmz = sz ? ((sz > 0 ? (k + 1) * r - oz : oz - k * r) / Math.abs(dz)) : Infinity;
    const stopT = 1 - (2.5 * r) / len; // não apaga o próprio ponto nem o vizinho
    for (let s = 0; s < maxSteps; s++) {
      let t;
      if (tmx < tmy && tmx < tmz) { i += sx; t = tmx; tmx += tdx; }
      else if (tmy < tmz) { j += sy; t = tmy; tmy += tdy; }
      else { k += sz; t = tmz; tmz += tdz; }
      if (t >= stopT || (i === ei && j === ej && k === ek)) break;
      const key = packKey(i, j, k);
      if (this.cells.has(key)) this._bump(key, -this.miss);
    }
  }

  /** devolve e limpa as mudanças desde a última chamada */
  drain() {
    const out = { added: [...this.added], removed: [...this.removed] };
    this.added.clear(); this.removed.clear();
    return out;
  }

  /** todos os voxels ocupados: [i,j,k,evidência,...] */
  occupiedList() {
    const out = [];
    const t = [0, 0, 0];
    for (const [key, v] of this.cells) {
      if (v < this.occ) continue;
      unpackKey(key, t);
      out.push(t[0], t[1], t[2], v);
    }
    return out;
  }

  clear() {
    for (const [key, v] of this.cells) if (v >= this.occ) this.removed.add(key);
    this.added.clear();
    this.cells.clear(); this.meanY?.clear(); this.occupied = 0;
  }
}
