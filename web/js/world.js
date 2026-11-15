// Mundo físico em escala 1:1 (metros, gravidade 9,81 m/s²).
// A geometria real vem do depth do ARCore -> VoxelMap (worker) -> malhas de colisão por bloco.
// Os mesmos voxels viram malha invisível de oclusão (o avatar some atrás de objetos reais)
// (a sombra do avatar cai num disco ShadowMaterial embaixo dele — ver app.js).
import * as THREE from 'three';
import { unpackKey, packKey } from '/shared/voxelmap.js';

// O mapa vira colisão em BLOCOS de 16x16x16 voxels: cada bloco é UMA malha (trimesh) com só as faces
// expostas e o topo na altura medida. Milhares de cuboides soltos custavam ~1 ms por passo de física
// (11 ms num celular); em blocos o passo cai para ~0,03 ms.
const CH = 16;
const chunkOf = (i, j, k) => packKey(Math.floor(i / CH), Math.floor(j / CH), Math.floor(k / CH));

export const G = 9.81;

export class World {
  constructor(RAPIER, scene, { res = 0.03, capacity = 60000, carve = true } = {}) {
    this.R = RAPIER;
    this.scene = scene;
    this.res = res;
    this.carveOn = carve;
    this.physics = new RAPIER.World({ x: 0, y: -G, z: 0 });
    // o mapa de voxels vive num Worker (mapper.worker.js): o depth não trava a tela
    this.worker = new Worker(new URL('./mapper.worker.js', import.meta.url), { type: 'module' });
    this.worker.postMessage({ t: 'init', res });
    this.worker.onmessage = (e) => this._onWorker(e.data);
    this.busy = false;               // um quadro por vez no worker (descarta se ainda está ocupado)
    this.onScores = null;
    this.surfaceBuf = [];
    this.chunks = new Map();         // chave do bloco -> { keys:Set, collider, dirty, built }
    this.dirty = new Set();
    this.slot = new Map();           // key -> índice da instância
    this.keys = [];                  // índice -> key
    this.pendingAdd = new Map();     // key -> topo da superfície
    this.pendingRemove = new Set();
    this.tops = new Map();           // key -> altura do topo (superfície medida)
    this.occupied = 0;
    this.capacity = capacity;
    this.minY = Infinity;            // voxel mais baixo conhecido (chão provável)
    this.points = 0;

    const box = new THREE.BoxGeometry(res, res, res);
    // 1) oclusor: só escreve profundidade, desenhado antes de tudo
    this.occluderMat = new THREE.MeshBasicMaterial({ colorWrite: false });
    this.occluder = new THREE.InstancedMesh(box, this.occluderMat, capacity);
    this.occluder.renderOrder = -10;
    // 3) depuração: voxels coloridos pela altura
    this.debugMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55 });
    this.debugMesh = new THREE.InstancedMesh(box, this.debugMat, capacity);
    this.debugMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.debugMesh.visible = false;
    for (const m of [this.occluder, this.debugMesh]) {
      m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this._m = new THREE.Matrix4(); this._c = new THREE.Color(); this._t = [0, 0, 0];
    this.props = [];
    this.planes = [];               // alturas de planos horizontais vistos pelo ARCore: { y, n }
    this.flipY = false;             // orientação do depth (autocalibrada no app)
    // o ruído do depth fica alguns cm acima/abaixo da superfície: a oclusão desce um pouco
    // para não "comer" os pés do avatar; objetos de verdade (copo, caixa) continuam ocultando
    this.occluder.position.y = -0.02;
    // desligada por padrão: no celular o depth tem "fantasmas" (pontos soltos no ar/bordas) que
    // escondiam o avatar. Liga pelo menu (Oclusão) quando o mapa estiver limpo.
    this.occluder.visible = false;
  }

  /** registra a altura de um plano horizontal do ARCore (hit-test) */
  addPlaneHeight(y) {
    let best = null;
    for (const p of this.planes) if (Math.abs(p.y - y) < 0.025 && (!best || Math.abs(p.y - y) < Math.abs(best.y - y))) best = p;
    if (best) { best.y += (y - best.y) * 0.1; best.n = Math.min(best.n + 1, 1000); }
    else { this.planes.push({ y, n: 1 }); if (this.planes.length > 12) { this.planes.sort((a, b) => b.n - a.n); this.planes.length = 10; } }
  }


  set debug(v) {
    this.debugMesh.visible = v;
    if (v && this.debugMesh._stale) { this.debugMesh._stale = false; this.debugMesh.instanceMatrix.needsUpdate = true; this.debugMesh.instanceColor.needsUpdate = true; }
  }
  get debug() { return this.debugMesh.visible; }
  set occlusion(v) {
    this.occluder.visible = v;
    if (v && this.occluder._stale) { this.occluder._stale = false; this.occluder.instanceMatrix.needsUpdate = true; }
  }
  get occlusion() { return this.occluder.visible; }

  /**
   * quadro de depth -> worker. Devolve false se o worker ainda está ocupado (o quadro é descartado:
   * melhor perder um quadro de depth do que travar a tela). calib = ponto do alvo para autocalibração.
   */
  ingestDepth(f, step = 2, { ingest = true, calib = null } = {}) {
    if (this.busy) return false;
    this.busy = true;
    const planes = this.planes.map((p) => ({ y: p.y, n: p.n }));
    this.worker.postMessage({ t: 'frame', f, step, planes, flipY: this.flipY, ingest, calib }, [f.data.buffer]);
    return true;
  }

  /** ponto de superfície vindo do hit-test (planos do ARCore) — funciona sem Depth API */
  addSurfacePoint(x, y, z) {
    this.addPlaneHeight(y);
    this.surfaceBuf.push(x, y, z);
    if (this.surfaceBuf.length >= 48) this.flushSurface();
  }

  flushSurface() {
    if (!this.surfaceBuf.length) return;
    const pts = Float32Array.from(this.surfaceBuf); this.surfaceBuf.length = 0;
    this.worker.postMessage({ t: 'surface', pts }, [pts.buffer]);
  }

  _onWorker(m) {
    if (m.t !== 'delta') return;
    this.busy = false;
    const a = m.added, r = m.removed;
    for (let i = 0; i < r.length; i++) { const k = r[i]; this.pendingAdd.delete(k); this.pendingRemove.add(k); }
    for (let i = 0; i < a.length; i += 2) { const k = a[i]; this.pendingRemove.delete(k); this.pendingAdd.set(k, a[i + 1]); }
    if (m.scores) this.onScores?.(m.scores);
    if (m.occupied !== undefined) this.occupied = m.occupied;
  }

  /** aplica as mudanças do mapa nos colisores e malhas (com orçamento por quadro: sem picos) */
  sync(budget = 600) {
    let n = 0;
    for (const k of this.pendingRemove) { if (n >= budget) break; this._remove(k); this.pendingRemove.delete(k); n++; }
    for (const [k, top] of this.pendingAdd) { if (n >= budget) break; this._add(k, top); this.pendingAdd.delete(k); n++; }
    // reconstrói no máximo 2 blocos por quadro, e cada bloco no máximo a cada 0,25 s
    const now = performance.now();
    let built = 0;
    for (const ck of this.dirty) {
      if (built >= 2) break;
      const c = this.chunks.get(ck);
      if (!c) { this.dirty.delete(ck); continue; }
      if (now - c.built < 250) continue;
      this._buildChunk(ck, c); this.dirty.delete(ck); c.built = now; built++;
    }
    if (n) {
      // envia à GPU só a parte usada do buffer (antes ia o buffer inteiro, ~2,5 MB, a cada mudança)
      const cnt = this.keys.length;
      for (const m of [this.occluder, this.debugMesh]) {
        m.count = cnt;
        if (!m.visible) { m._stale = true; continue; }
        m.instanceMatrix.clearUpdateRanges(); m.instanceMatrix.addUpdateRange(0, cnt * 16); m.instanceMatrix.needsUpdate = true;
      }
      if (this.debugMesh.visible) {
        const c = this.debugMesh.instanceColor; c.clearUpdateRanges(); c.addUpdateRange(0, cnt * 3); c.needsUpdate = true;
      }
    }
  }

  _touch(i, j, k) {
    // marca o bloco do voxel e os vizinhos (as faces laterais dependem dos voxels ao lado)
    for (const [di, dj, dk] of [[0, 0, 0], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
      this.dirty.add(chunkOf(i + di, j + dj, k + dk));
    }
  }

  _add(key, top) {
    if (this.slot.has(key)) return;
    if (this.keys.length >= this.capacity) {
      // mapa cheio: avisa uma vez (antes as áreas novas ficavam sem física em silêncio)
      if (!this.full) { this.full = true; this.onFull?.(); }
      return;
    }
    const [i, j, k] = unpackKey(key, this._t);
    const r = this.res;
    // o topo fica na altura média medida (não no topo quantizado do voxel)
    const hy = (top - j * r) / 2;
    const x = (i + 0.5) * r, y = j * r + hy, z = (k + 0.5) * r;
    this.tops.set(key, top);
    const ck = chunkOf(i, j, k);
    let c = this.chunks.get(ck);
    if (!c) { c = { keys: new Set(), collider: null, built: 0 }; this.chunks.set(ck, c); }
    c.keys.add(key);
    this._touch(i, j, k);
    const idx = this.keys.length;
    this.keys.push(key); this.slot.set(key, idx);
    this._m.makeScale(1, (2 * hy) / r, 1).setPosition(x, y, z);
    this.occluder.setMatrixAt(idx, this._m);
    this.debugMesh.setMatrixAt(idx, this._m);
    this._c.setHSL(((y * 1.6) % 1 + 1) % 1, 0.75, 0.55);
    this.debugMesh.setColorAt(idx, this._c);
    if (y < this.minY) this.minY = y;
  }

  _remove(key) {
    const idx = this.slot.get(key);
    if (idx === undefined) return;
    const [i, j, k] = unpackKey(key, this._t);
    this.chunks.get(chunkOf(i, j, k))?.keys.delete(key);
    this._touch(i, j, k);
    this.slot.delete(key); this.tops.delete(key);
    const last = this.keys.length - 1;
    if (idx !== last) {
      const lk = this.keys[last];
      this.keys[idx] = lk; this.slot.set(lk, idx);
      for (const m of [this.occluder, this.debugMesh]) {
        m.getMatrixAt(last, this._m); m.setMatrixAt(idx, this._m);
      }
      this.debugMesh.getColorAt(last, this._c); this.debugMesh.setColorAt(idx, this._c);
    }
    this.keys.pop();
  }

  /** malha de colisão de um bloco: topo na altura medida + laterais/fundo só onde estão expostos */
  _buildChunk(ck, c) {
    if (c.collider) { this.physics.removeCollider(c.collider, false); c.collider = null; }
    if (!c.keys.size) { this.chunks.delete(ck); return; }
    const r = this.res, tops = this.tops, t = this._t;
    const v = [], idx = [];
    const quad = (ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz) => {
      const o = v.length / 3;
      v.push(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz);
      idx.push(o, o + 1, o + 2, o, o + 2, o + 3);
    };
    // topos e fundos: retângulos mesclados (greedy) por altura — a mesa vira poucos retângulos grandes.
    // Com um quadradinho por voxel o controlador do avatar ficava ~20x mais lento.
    const groups = new Map();            // "t|altura" ou "b|altura" -> lista de (i,k)
    const addFace = (tag, y, i, k) => {
      const gk = tag + '|' + Math.round(y / 0.002);
      let g = groups.get(gk); if (!g) { g = []; groups.set(gk, g); }
      g.push(i, k);
    };
    for (const key of c.keys) {
      unpackKey(key, t);
      const i = t[0], j = t[1], k = t[2];
      const y1 = tops.get(key), y0 = j * r;
      const x0 = i * r, x1 = x0 + r, z0 = k * r, z1 = z0 + r;
      if (!tops.has(packKey(i, j + 1, k))) addFace('t', y1, i, k);
      if (!tops.has(packKey(i, j - 1, k))) addFace('b', y0, i, k);
      // laterais: inteiras se o vizinho não existe; só a faixa de cima se o vizinho é mais baixo
      let nt = tops.get(packKey(i + 1, j, k)); let bb = nt === undefined ? y0 : nt;
      if (bb < y1 - 1e-3) quad(x1, bb, z0, x1, y1, z0, x1, y1, z1, x1, bb, z1);                     // +x
      nt = tops.get(packKey(i - 1, j, k)); bb = nt === undefined ? y0 : nt;
      if (bb < y1 - 1e-3) quad(x0, bb, z0, x0, bb, z1, x0, y1, z1, x0, y1, z0);                     // -x
      nt = tops.get(packKey(i, j, k + 1)); bb = nt === undefined ? y0 : nt;
      if (bb < y1 - 1e-3) quad(x0, bb, z1, x1, bb, z1, x1, y1, z1, x0, y1, z1);                     // +z
      nt = tops.get(packKey(i, j, k - 1)); bb = nt === undefined ? y0 : nt;
      if (bb < y1 - 1e-3) quad(x0, bb, z0, x0, y1, z0, x1, y1, z0, x1, bb, z0);                     // -z
    }
    for (const [gk, cells] of groups) {
      const top = gk[0] === 't', y = Number(gk.slice(2)) * 0.002;
      let mi = Infinity, mk = Infinity, Mi = -Infinity, Mk = -Infinity;
      for (let n = 0; n < cells.length; n += 2) { mi = Math.min(mi, cells[n]); Mi = Math.max(Mi, cells[n]); mk = Math.min(mk, cells[n + 1]); Mk = Math.max(Mk, cells[n + 1]); }
      const W = Mi - mi + 1, D = Mk - mk + 1, grid = new Uint8Array(W * D);
      for (let n = 0; n < cells.length; n += 2) grid[(cells[n + 1] - mk) * W + (cells[n] - mi)] = 1;
      for (let kz = 0; kz < D; kz++) {
        for (let ix = 0; ix < W; ix++) {
          if (grid[kz * W + ix] !== 1) continue;
          let w = 1; while (ix + w < W && grid[kz * W + ix + w] === 1) w++;
          let d = 1;
          grow: while (kz + d < D) { for (let q = 0; q < w; q++) if (grid[(kz + d) * W + ix + q] !== 1) break grow; d++; }
          for (let dd = 0; dd < d; dd++) for (let q = 0; q < w; q++) grid[(kz + dd) * W + ix + q] = 2;
          const x0 = (mi + ix) * r, x1 = (mi + ix + w) * r, z0 = (mk + kz) * r, z1 = (mk + kz + d) * r;
          if (top) quad(x0, y, z0, x0, y, z1, x1, y, z1, x1, y, z0);
          else quad(x0, y, z0, x1, y, z0, x1, y, z1, x0, y, z1);
        }
      }
    }
    if (!idx.length) return;
    const verts = new Float32Array(v), ind = new Uint32Array(idx);
    let desc;
    try { desc = this.R.ColliderDesc.trimesh(verts, ind, this.R.TriMeshFlags.FIX_INTERNAL_EDGES); }
    catch { desc = this.R.ColliderDesc.trimesh(verts, ind); }
    c.collider = this.physics.createCollider(desc.setFriction(0.9).setRestitution(0.1));
  }

  clear() {
    this.worker.postMessage({ t: 'clear' });
    this.pendingAdd.clear();
    for (const k of this.keys) this.pendingRemove.add(k);
    this.minY = Infinity;
    this.full = false;
  }

  /** reconstrói já todos os blocos pendentes (testes / depois de apagar o mapa) */
  flushChunks() {
    for (const ck of this.dirty) { const c = this.chunks.get(ck); if (c) { this._buildChunk(ck, c); c.built = performance.now(); } }
    this.dirty.clear();
  }

  /** chão de reserva (plano grande) na altura estimada do piso — cobre o chão que a câmera ainda não viu */
  setFloor(y, source = 'planes') {
    if (this.floor) this.physics.removeCollider(this.floor, false);
    this.floor = this.physics.createCollider(this.R.ColliderDesc.cuboid(50, 0.05, 50).setTranslation(0, y - 0.05, 0).setFriction(0.9));
    this.floorY = y; this.floorSource = source;
    if (y < this.minY) this.minY = y;
  }

  removeFloor() {
    if (this.floor) this.physics.removeCollider(this.floor, false);
    this.floor = null; this.floorY = undefined; this.floorSource = null;
  }

  /**
   * chão de verdade = plano horizontal mais confirmado pelo ARCore pelo menos 30 cm abaixo de refY
   * (a mesa onde o avatar está). Corrige a estimativa do 'local-floor', que pode errar dezenas de cm
   * e fazer o avatar cair "dentro" do chão real (e sumir pela oclusão).
   */
  floorFromPlanes(refY) {
    let best = null;
    for (const p of this.planes) if (p.n >= 6 && p.y < refY - 0.3 && (!best || p.n > best.n)) best = p;
    if (!best) return false;
    if (this.floorSource !== 'planes' || Math.abs(best.y - this.floorY) > 0.015) this.setFloor(best.y, 'planes');
    return true;
  }

  /** raio para baixo: altura do chão sob (x,z), ignorando um colisor */
  groundBelow(x, y, z, maxDist = 3, exclude = null) {
    const ray = this._ray || (this._ray = new this.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: -1, z: 0 }));
    ray.origin.x = x; ray.origin.y = y; ray.origin.z = z;
    const hit = this.physics.castRay(ray, maxDist, true, undefined, undefined, exclude || undefined);
    return hit ? y - hit.timeOfImpact : null;
  }

  // ------------------------------------------------------------ objetos físicos
  spawnBox(pos, size, color = 0xd9e27a) {
    const R = this.R;
    const body = this.physics.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z).setCcdEnabled(true));
    this.physics.createCollider(R.ColliderDesc.cuboid(size / 2, size / 2, size / 2).setDensity(250).setFriction(0.7).setRestitution(0.15), body);
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    mesh.castShadow = true;
    return this._addProp('box', body, mesh, size);
  }

  spawnBall(pos, vel, radius = 0.033, color = 0xe8ff6a) {
    const R = this.R;
    const body = this.physics.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, pos.y, pos.z)
      .setLinvel(vel.x, vel.y, vel.z).setCcdEnabled(true).setLinearDamping(0.05).setAngularDamping(0.3));
    // bola de tênis: ~58 g, r = 3,3 cm
    this.physics.createCollider(R.ColliderDesc.ball(radius).setDensity(0.058 / (4 / 3 * Math.PI * radius ** 3)).setRestitution(0.72).setFriction(0.6), body);
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 20, 14), new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
    mesh.castShadow = true;
    return this._addProp('ball', body, mesh, radius);
  }

  _addProp(kind, body, mesh, size) {
    this.scene.add(mesh);
    const p = { kind, body, mesh, size, born: performance.now() };
    this.props.push(p);
    // limite de objetos: sai o mais antigo que NÃO está nas mãos do avatar
    while (this.props.length > 40) {
      const old = this.props.find((q) => !q.held && q !== p);
      if (!old) break;
      this.removeProp(old);
    }
    return p;
  }

  /**
   * Remove um objeto do mundo. Quem o segura é avisado ANTES (onPropRemoved): usar um corpo do Rapier
   * já removido trava o WASM ("unreachable") e congela o app inteiro.
   */
  removeProp(p) {
    const i = this.props.indexOf(p);
    if (i < 0) return;
    this.onPropRemoved?.(p);
    this.physics.removeRigidBody(p.body);
    this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
    this.props.splice(i, 1);
  }

  step(dt) {
    // tempo real em subpassos de no máximo 1/60 s (até 3 por quadro). Antes era UM passo limitado a
    // 1/30 s: abaixo de 30 FPS bolas e caixas andavam em câmera lenta enquanto o avatar não, e passos
    // grandes deixavam as pilhas de caixas instáveis. Sempre ≥1 passo por quadro (o avatar cinemático
    // depende disso para andar).
    const d = Math.min(Math.max(dt, 1 / 240), 0.05);
    const n = Math.min(3, Math.ceil(d * 60 - 1e-6));
    this.physics.timestep = d / n;
    for (let s = 0; s < n; s++) this.physics.step();
    const floor = (Number.isFinite(this.minY) ? this.minY : 0) - 4;
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i];
      const t = p.body.translation(), q = p.body.rotation();
      if (t.y < floor) { this.removeProp(p); continue; }
      p.mesh.position.set(t.x, t.y, t.z); p.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }
}

