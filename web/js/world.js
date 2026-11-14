// Mundo físico em escala 1:1 (metros, gravidade 9,81 m/s²).
// A geometria real vem do depth do ARCore -> VoxelMap -> um colisor cúbico fixo por voxel ocupado.
// Os mesmos voxels viram malha invisível de oclusão (o avatar some atrás de objetos reais)
// e recebem sombra (ShadowMaterial), então o avatar projeta sombra na mesa de verdade.
import * as THREE from 'three';
import { VoxelMap, unpackKey } from '/shared/voxelmap.js';
import { unprojectDepth } from '/shared/depth.js';

export const G = 9.81;

export class World {
  constructor(RAPIER, scene, { res = 0.03, capacity = 60000, carve = true } = {}) {
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
    // 2) recebe sombra do avatar e dos objetos
    this.shadowMat = new THREE.ShadowMaterial({ opacity: 0.38, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
    this.shadowMesh = new THREE.InstancedMesh(box, this.shadowMat, capacity);
    this.shadowMesh.receiveShadow = true;
    this.shadowMesh.renderOrder = 5;
    // 3) depuração: voxels coloridos pela altura
    this.debugMat = new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.55 });
    this.debugMesh = new THREE.InstancedMesh(box, this.debugMat, capacity);
    this.debugMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.debugMesh.visible = false;
    for (const m of [this.occluder, this.shadowMesh, this.debugMesh]) {
      m.count = 0; m.frustumCulled = false; m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      scene.add(m);
    }
    this._m = new THREE.Matrix4(); this._c = new THREE.Color(); this._t = [0, 0, 0];
    this.props = [];
  }

  set debug(v) { this.debugMesh.visible = v; }
  get debug() { return this.debugMesh.visible; }
  set occlusion(v) { this.occluder.visible = v; }
  get occlusion() { return this.occluder.visible; }

  /** quadro de depth (formato de shared/protocol.js) -> evidência no mapa */
  ingestDepth(f, step = 3) {
    let i = 0;
    const map = this.map, carve = this.carveOn;
    this.points += unpro(f, (x, y, z, ox, oy, oz) => {
      map.addPoint(x, y, z);
      if (carve && (i++ % 4) === 0) map.carve(ox, oy, oz, x, y, z, 160);
    }, step);
  }

  /** ponto de superfície vindo do hit-test (planos do ARCore) — funciona sem Depth API */
  addSurfacePoint(x, y, z, w = 1) { this.map.addPoint(x, y, z, w); }

  /** aplica as mudanças do mapa nos colisores e malhas (com orçamento por quadro) */
  sync(budget = 1500) {
    const d = this.map.drain();
    for (const k of d.removed) this.pendingRemove.push(k);
    for (const k of d.added) this.pendingAdd.push(k);
    let n = 0;
    while (this.pendingRemove.length && n < budget) { this._remove(this.pendingRemove.pop()); n++; }
    while (this.pendingAdd.length && n < budget) { this._add(this.pendingAdd.pop()); n++; }
    if (n) {
      for (const m of [this.occluder, this.shadowMesh, this.debugMesh]) {
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
    this.shadowMesh.setMatrixAt(idx, this._m);
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
      for (const m of [this.occluder, this.shadowMesh, this.debugMesh]) {
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

function unpro(f, emit, step) { return unprojectDepth(f, emit, { step, maxDepth: 4 }); }
