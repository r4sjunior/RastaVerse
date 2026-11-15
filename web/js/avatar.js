// Avatar voxel do VoxEdit (convertido por tools/vox2json.py) montado em Three.js.
// Convenção: VoxEdit é mão-esquerda (Unity). Convertimos para mão-direita espelhando Z:
//   posição (x,y,z) -> (x,y,-z) ; euler (rx,ry,rz) -> (-rx,-ry,rz), ordem 'YXZ' (= ZXY do Unity).
import * as THREE from 'three';

const FACES = [
  // normal, 4 cantos (unidades de voxel)
  { n: [1, 0, 0], c: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { n: [-1, 0, 0], c: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { n: [0, 0, 1], c: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { n: [0, 0, -1], c: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
];
// leve sombreamento por face, no estilo do VoxEdit
const SHADE = [0.86, 0.86, 1.0, 0.62, 0.94, 0.78];

function buildPartGeometry(part, palette) {
  const [w, h, d] = part.size;
  const [px, py, pz] = part.pivot;
  const occ = new Map();
  const v = part.voxels;
  const key = (x, y, z) => (x * h + y) * d + z;
  for (let i = 0; i < v.length; i += 4) occ.set(key(v[i], v[i + 1], v[i + 2]), v[i + 3]);
  const has = (x, y, z) => x >= 0 && y >= 0 && z >= 0 && x < w && y < h && z < d && occ.has(key(x, y, z));
  const pos = [], nor = [], col = [], idx = [];
  const color = new THREE.Color();
  for (let i = 0; i < v.length; i += 4) {
    const x = v[i], y = v[i + 1], z = v[i + 2];
    color.set(palette[v[i + 3]] || '#ff00ff').convertSRGBToLinear();
    FACES.forEach((f, fi) => {
      if (has(x + f.n[0], y + f.n[1], z + f.n[2])) return;
      const base = pos.length / 3;
      for (const c of f.c) {
        // origem no pivô; espelha Z (mão-esquerda -> mão-direita)
        pos.push(x + c[0] - px * w, y + c[1] - py * h, -(z + c[2] - pz * d));
        nor.push(f.n[0], f.n[1], -f.n[2]);
        const s = SHADE[fi];
        col.push(color.r * s, color.g * s, color.b * s);
      }
      // espelhar Z inverte o sentido do enrolamento
      idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeBoundingBox();
  return g;
}

function sampleTrack(keys, f, loopLen) {
  if (keys.length === 1) return keys[0][1];
  if (f <= keys[0][0]) return keys[0][1];
  const last = keys[keys.length - 1];
  if (f >= last[0]) return last[1];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (f <= b[0]) {
      const a = keys[i - 1];
      const t = (f - a[0]) / Math.max(1e-6, b[0] - a[0]);
      return a[1] + (b[1] - a[1]) * t;
    }
  }
  return last[1];
}

const _e = new THREE.Euler();
const _q = new THREE.Quaternion();

export class VoxelAvatar {
  constructor(data, opts = {}) {
    this.data = data;
    this.fps = data.fps || 24;
    this.root = new THREE.Group();          // raiz do personagem (pés em y=0, frente = +Z)
    this.root.name = 'avatar';
    this.model = new THREE.Group();         // escala voxel -> metros
    this.model.rotation.y = Math.PI;        // frente do VoxEdit (+Z Unity) vira +Z aqui
    this.root.add(this.model);
    this.material = opts.material || new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    this.bones = [];
    this.meshes = [];
    // silhueta "raio-x": aparece só onde o avatar está ATRÁS de algo real (mesa, objeto),
    // para ele nunca sumir. Desenhada depois do oclusor e antes do avatar (renderOrder).
    this.silhouetteMat = opts.silhouette === false ? null : new THREE.MeshBasicMaterial({
      color: new THREE.Color(0xd9e27a).multiplyScalar(0.55), blending: THREE.AdditiveBlending,
      depthWrite: false, depthFunc: THREE.GreaterDepth,
    });
    const geoCache = {};
    data.bones.forEach((b, i) => {
      const g = new THREE.Group();
      g.name = b.name;
      g.rotation.order = 'YXZ';
      this.bones.push(g);
      (b.parent < 0 ? this.model : this.bones[b.parent]).add(g);
      if (b.part && data.parts[b.part]) {
        geoCache[b.part] ||= buildPartGeometry(data.parts[b.part], data.palette);
        const m = new THREE.Mesh(geoCache[b.part], this.material);
        m.castShadow = true;
        m.name = b.part;
        g.add(m);
        this.meshes.push(m);
        if (this.silhouetteMat) {
          const s = new THREE.Mesh(geoCache[b.part], this.silhouetteMat);
          s.renderOrder = -5; s.name = b.part + ':silhueta';
          g.add(s);
        }
      }
    });
    this.poseA = this.bones.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), s: 1 }));
    this.poseB = this.bones.map(() => ({ p: new THREE.Vector3(), q: new THREE.Quaternion(), s: 1 }));
    this.current = null; this.prev = null;
    this.time = 0; this.prevTime = 0; this.fade = 1; this.fadeDur = 0.2;
    this.speed = 1;
    this.onFinish = null;
    // altura em voxels na T-pose (para escalar em metros)
    this.play('tpose', { fade: 0 });
    this.update(0);
    this.root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    this.voxelHeight = box.max.y - box.min.y;
    this.voxelFootY = box.min.y;
    this.setHeight(opts.height ?? 0.25);
    this.play('idle', { fade: 0 });
  }

  /** altura total do personagem em metros (escala 1:1 com o mundo real) */
  setHeight(m) {
    this.height = m;
    this.scale = m / this.voxelHeight;
    this.model.scale.setScalar(this.scale);
    this.model.position.y = -this.voxelFootY * this.scale;
  }

  /** prévia translúcida (antes de colocar no mundo) */
  setGhost(on) {
    if (this.ghost === on) return;
    this.ghost = on;
    this.material.transparent = on;
    this.material.opacity = on ? 0.55 : 1;
    this.material.depthWrite = !on;
    this.material.needsUpdate = true;
    for (const m of this.meshes) m.castShadow = !on;
  }

  has(name) { return !!this.data.anims[name]; }

  duration(name) {
    const a = this.data.anims[name];
    return a ? Math.max(1, a.frames) / this.fps : 0;
  }

  play(name, { loop = true, fade = 0.18, speed = 1, restart = false, onFinish = null } = {}) {
    if (!this.data.anims[name]) return;
    if (this.current && this.current.name === name && !restart) {
      this.current.loop = loop; this.speed = speed; this.onFinish = onFinish; return;
    }
    if (this.current && fade > 0) {
      this.prev = this.current; this.prevTime = this.time; this.fade = 0; this.fadeDur = fade;
    } else { this.prev = null; this.fade = 1; }
    this.current = { name, anim: this.data.anims[name], loop };
    this.time = 0; this.speed = speed; this.onFinish = onFinish;
  }

  _samplePose(clip, t, out) {
    const a = clip.anim;
    const len = Math.max(1, a.frames);
    let f = t * this.fps;
    f = clip.loop ? f % len : Math.min(f, len);
    a.tracks.forEach((tr, i) => {
      const o = out[i];
      o.p.set(sampleTrack(tr[0], f), sampleTrack(tr[1], f), -sampleTrack(tr[2], f));
      _e.set(-sampleTrack(tr[3], f), -sampleTrack(tr[4], f), sampleTrack(tr[5], f), 'YXZ');
      o.q.setFromEuler(_e);
      o.s = sampleTrack(tr[6], f);
    });
  }

  update(dt) {
    if (!this.current) return;
    this.time += dt * this.speed;
    const len = this.duration(this.current.name);
    if (!this.current.loop && this.time >= len && this.onFinish) {
      const cb = this.onFinish; this.onFinish = null; cb();
    }
    this._samplePose(this.current, this.time, this.poseA);
    if (this.prev && this.fade < 1) {
      this.prevTime += dt;
      this.fade = Math.min(1, this.fade + dt / this.fadeDur);
      this._samplePose(this.prev, this.prevTime, this.poseB);
      const w = this.fade;
      this.poseA.forEach((a, i) => {
        const b = this.poseB[i];
        a.p.lerpVectors(b.p, a.p, w);
        _q.copy(a.q);
        a.q.copy(b.q).slerp(_q, w);
        a.s = b.s + (a.s - b.s) * w;
      });
    } else this.prev = null;
    this.poseA.forEach((a, i) => {
      const bone = this.bones[i];
      if (i === 0) bone.position.set(0, a.p.y, 0);   // controller: sem deslocamento horizontal (in-place)
      else bone.position.copy(a.p);
      bone.quaternion.copy(a.q);
      bone.scale.setScalar(a.s || 1);
    });
  }
}

export async function loadAvatar(url = './assets/avatar.json', opts) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('avatar.json não encontrado (' + res.status + '). Rode: npm run avatar');
  return new VoxelAvatar(await res.json(), opts);
}
