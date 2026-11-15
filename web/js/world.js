// Mundo físico em escala 1:1 (metros, gravidade 9,81 m/s²).
// A geometria real vem do depth do ARCore -> VoxelMap -> um colisor cúbico fixo por voxel ocupado.
// Os mesmos voxels viram malha invisível de oclusão (o avatar some atrás de objetos reais)
// (a sombra do avatar cai num disco ShadowMaterial embaixo dele — ver app.js).
import * as THREE from 'three';
import { unpackKey } from '/shared/voxelmap.js';

export const G = 9.81;

export class World {
  constructor(RAPIER, scene, { res = 0.03, capacity = 40000, carve = true } = {}) {
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
    this.colliders = new Map();      // key -> collider
    this.slot = new Map();           // key -> índice da instância
    this.keys = [];                  // índice -> key
    this.pendingAdd = new Map();     // key -> topo da superfície
    this.pendingRemove = new Set();
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


  set debug(v) { this.debugMesh.visible = v; }
  get debug() { return this.debugMesh.visible; }
  set occlusion(v) { this.occluder.visible = v; }
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
  }

  /** aplica as mudanças do mapa nos colisores e malhas (com orçamento por quadro: sem picos) */
  sync(budget = 120) {
    let n = 0;
    for (const k of this.pendingRemove) { if (n >= budget) break; this._remove(k); this.pendingRemove.delete(k); n++; }
    for (const [k, top] of this.pendingAdd) { if (n >= budget) break; this._add(k, top); this.pendingAdd.delete(k); n++; }
    if (n) {
      for (const m of [this.occluder, this.debugMesh]) {
        m.count = this.keys.length; m.instanceMatrix.needsUpdate = true;
      }
      this.debugMesh.instanceColor.needsUpdate = true;
    }
  }

  _add(key, top) {
    if (this.slot.has(key)) return;
    if (this.keys.length >= this.capacity) return;
    const [i, j, k] = unpackKey(key, this._t);
    const r = this.res;
    // o topo do colisor fica na altura média medida (não no topo quantizado do voxel)
    const hy = (top - j * r) / 2;
    const x = (i + 0.5) * r, y = j * r + hy, z = (k + 0.5) * r;
    const col = this.physics.createCollider(
      // 1,5x mais largo que o voxel: colisores vizinhos se sobrepõem e fecham buracos de 1 voxel
      // (depth esparso/ruidoso), então o personagem não afunda nem enrosca nas emendas
      this.R.ColliderDesc.cuboid(r * 0.75, hy, r * 0.75).setTranslation(x, y, z).setFriction(0.9).setRestitution(0.1),
    );
    this.colliders.set(key, col);
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
    const col = this.colliders.get(key);
    if (col) this.physics.removeCollider(col, false);
    this.colliders.delete(key); this.slot.delete(key);
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

  clear() {
    this.worker.postMessage({ t: 'clear' });
    this.pendingAdd.clear();
    for (const k of this.keys) this.pendingRemove.add(k);
    this.minY = Infinity;
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
    while (this.props.length > 40) this.removeProp(this.props[0]);
    return p;
  }

  removeProp(p) {
    this.physics.removeRigidBody(p.body);
    this.scene.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.dispose();
    this.props.splice(this.props.indexOf(p), 1);
  }

  step(dt) {
    this.physics.timestep = Math.min(Math.max(dt, 1 / 240), 1 / 30);
    this.physics.step();
    const floor = (Number.isFinite(this.minY) ? this.minY : 0) - 4;
    for (let i = this.props.length - 1; i >= 0; i--) {
      const p = this.props[i];
      const t = p.body.translation(), q = p.body.rotation();
      if (t.y < floor) { this.removeProp(p); continue; }
      p.mesh.position.set(t.x, t.y, t.z); p.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }
}

