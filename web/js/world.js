// Mundo físico em escala 1:1 (metros, gravidade 9,81 m/s²).
// A geometria real vem do depth do ARCore -> VoxelMap -> um colisor cúbico fixo por voxel ocupado.
// Os mesmos voxels viram malha invisível de oclusão (o avatar some atrás de objetos reais)
// (a sombra do avatar cai num disco ShadowMaterial embaixo dele — ver app.js).
import * as THREE from 'three';
import { VoxelMap, unpackKey } from '/shared/voxelmap.js';
import { unprojectDepth } from '/shared/depth.js';

export const G = 9.81;

export class World {
  constructor(RAPIER, scene, { res = 0.03, capacity = 40000, carve = true } = {}) {
    this.R = RAPIER;
    this.scene = scene;
    this.res = res;
    this.carveOn = carve;
    this.physics = new RAPIER.World({ x: 0, y: -G, z: 0 });
    this.map = new VoxelMap({ res, hit: 2, miss: 1, occ: 4, max: 24, trackY: true });
    this.colliders = new Map();      // key -> collider
    this.slot = new Map();           // key -> índice da instância
    this.keys = [];                  // índice -> key
    this.pendingAdd = []; this.pendingRemove = [];
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

  /** se y está na faixa de ruído de um plano conhecido, devolve a altura do plano */
  snapToPlane(y) {
    for (const p of this.planes) if (p.n >= 3 && y > p.y - 0.04 && y < p.y + 0.035) return p.y;
    return null;
  }

  set debug(v) { this.debugMesh.visible = v; }
  get debug() { return this.debugMesh.visible; }
  set occlusion(v) { this.occluder.visible = v; }
  get occlusion() { return this.occluder.visible; }

  /** quadro de depth (formato de shared/protocol.js) -> evidência no mapa */
  ingestDepth(f, step = 3) {
    let i = 0;
    const map = this.map, carve = this.carveOn, planes = this.planes.length > 0;
    this.points += unprojectDepth(f, (x, y, z, ox, oy, oz) => {
      // depth ruidoso: pontos rentes a um plano do ARCore são colados no plano (a mesa fica lisa)
      if (planes) { const py = this.snapToPlane(y); if (py !== null) y = py - 0.002; }
      map.addPoint(x, y, z);
      if (carve && (i++ % 4) === 0) map.carve(ox, oy, oz, x, y, z, 160);
    }, { step, maxDepth: 4, flipY: this.flipY });
  }

  /** ponto de superfície vindo do hit-test (planos do ARCore) — funciona sem Depth API */
  addSurfacePoint(x, y, z, w = 1) { this.addPlaneHeight(y); this.map.addPoint(x, y - 0.002, z, w); }

  /** aplica as mudanças do mapa nos colisores e malhas (com orçamento por quadro) */
  sync(budget = 1500) {
    const d = this.map.drain();
    for (const k of d.removed) this.pendingRemove.push(k);
    for (const k of d.added) this.pendingAdd.push(k);
    let n = 0;
    while (this.pendingRemove.length && n < budget) { this._remove(this.pendingRemove.pop()); n++; }
    while (this.pendingAdd.length && n < budget) { this._add(this.pendingAdd.pop()); n++; }
    if (n) {
      for (const m of [this.occluder, this.debugMesh]) {
        m.count = this.keys.length; m.instanceMatrix.needsUpdate = true;
      }
      this.debugMesh.instanceColor.needsUpdate = true;
    }
  }

  _add(key) {
    if (this.slot.has(key) || !this.map.isOccupied(key)) return;
    if (this.keys.length >= this.capacity) return;
    const [i, j, k] = unpackKey(key, this._t);
    const r = this.res;
    // o topo do colisor fica na altura média medida (não no topo quantizado do voxel)
    const top = this.map.surfaceTop(key, j);
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
    if (idx === undefined || this.map.isOccupied(key)) return;
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
    this.map.clear();
    this.pendingAdd.length = 0;
    this.sync(1e9);
    this.minY = Infinity;
  }

  /** chão de reserva (plano grande) na altura estimada do piso — cobre o chão que a câmera ainda não viu */
  setFloor(y) {
    if (this.floor) this.physics.removeCollider(this.floor, false);
    this.floor = this.physics.createCollider(this.R.ColliderDesc.cuboid(50, 0.05, 50).setTranslation(0, y - 0.05, 0).setFriction(0.9));
    this.floorY = y;
    if (y < this.minY) this.minY = y;
  }

  /**
   * chão de verdade = plano horizontal mais confirmado pelo ARCore pelo menos 30 cm abaixo de refY
   * (a mesa onde o avatar está). Corrige a estimativa do 'local-floor', que pode errar dezenas de cm
   * e fazer o avatar cair "dentro" do chão real (e sumir pela oclusão).
   */
  floorFromPlanes(refY) {
    let best = null;
    for (const p of this.planes) if (p.n >= 6 && p.y < refY - 0.3 && (!best || p.n > best.n)) best = p;
    if (best && (this.floorY === undefined || Math.abs(best.y - this.floorY) > 0.015)) { this.setFloor(best.y); return true; }
    return false;
  }

  /** raio para baixo: altura do chão sob (x,z), ignorando um colisor */
  groundBelow(x, y, z, maxDist = 3, exclude = null) {
    const ray = new this.R.Ray({ x, y, z }, { x: 0, y: -1, z: 0 });
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
    for (const p of [...this.props]) {
      const t = p.body.translation(), q = p.body.rotation();
      if (t.y < floor) { this.removeProp(p); continue; }
      p.mesh.position.set(t.x, t.y, t.z); p.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }
}

