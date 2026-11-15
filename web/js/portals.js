// Portais RastaVerse: portais 3D que aparecem no mundo real, em volta do avatar. Leve o avatar até
// um deles e ele é "sugado" para o outro jogo (Rasta Memo, Rasta Runner, Rastetris).
import * as THREE from 'three';

export const DESTS = {
  memo: { name: 'Rasta Memo', desc: 'Jogo da memória', url: 'https://rastamemo.vercel.app/', c1: 0x2ee6a8, c2: 0x1b6dff },
  runner: { name: 'Rasta Runner', desc: 'Corrida High Tide', url: 'https://rastarunner.vercel.app/', c1: 0xffc23d, c2: 0xff3d6e },
  tetris: { name: 'Rastetris', desc: 'Blocos rasta', url: 'https://rastetris.vercel.app/', c1: 0xb05cff, c2: 0x3dd6ff },
};

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// redemoinho: espiral girando para dentro + brilho na borda
const FRAG = /* glsl */`
uniform float uTime; uniform vec3 uC1; uniform vec3 uC2; uniform float uPower;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float a = atan(p.y, p.x);
  float s = sin(a * 3.0 + d * 11.0 - uTime * 5.0) * 0.5 + 0.5;
  float s2 = sin(a * 5.0 - d * 7.0 + uTime * 3.0) * 0.5 + 0.5;
  vec3 col = mix(uC2, uC1, s * 0.75 + s2 * 0.25);
  col += vec3(1.0) * pow(1.0 - d, 3.0) * (0.6 + 0.4 * uPower);   // miolo claro
  float alpha = smoothstep(1.0, 0.82, d) * (0.38 + 0.3 * s + 0.3 * uPower);
  gl_FragColor = vec4(col * (0.9 + uPower * 0.6), alpha);
}`;

function label(text, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = '700 64px "Space Grotesk", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(500, g.measureText(text).width + 56);
  g.fillStyle = 'rgba(12,14,17,.82)';
  g.beginPath(); g.roundRect?.(256 - w / 2, 18, w, 92, 46); if (!g.roundRect) g.rect(256 - w / 2, 18, w, 92); g.fill();
  g.lineWidth = 5; g.strokeStyle = '#' + color.toString(16).padStart(6, '0'); g.stroke();
  g.fillStyle = '#ffffff'; g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
}

export class Portals {
  /** ctx: { scene, world, char, camPos, onEnter(url, dest), sfx } */
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.warp = null;
    this.t = 0;
  }

  get active() { return this.list.length > 0; }

  /** abre um portal (id) ou os três (ids = 'all') em volta do avatar */
  open(ids) {
    this.close();
    const { char, world, camPos } = this.ctx;
    if (!char.body) return false;
    const want = ids === 'all' ? Object.keys(DESTS) : [ids];
    const H = char.height, p = char.position;
    const R = 0.5 * H;                                     // raio do anel (um pouco mais alto que o avatar)
    // de frente para a câmera, do lado de lá do avatar (fica visível na tela)
    const base = Math.atan2(p.x - camPos.x, p.z - camPos.z);
    const angs = want.length === 1 ? [0, 40, -40, 80, -80, 130, -130, 180] : [0, -48, 48, -96, 96, 150, -150, 180, -24, 24];
    const dists = [1.9 * H, 1.45 * H, 1.1 * H, 2.4 * H];
    const used = [];
    for (const id of want) {
      let spot = null;
      search: for (const d of dists) {
        for (const a of angs) {
          const ang = base + a * Math.PI / 180;
          const x = p.x + Math.sin(ang) * d, z = p.z + Math.cos(ang) * d;
          if (used.some((u) => Math.hypot(u.x - x, u.z - z) < R * 2.3)) continue;
          // chão na mesma altura do avatar (dá para chegar andando)
          const gy = world.groundBelow(x, p.y + H * 0.6, z, H * 1.4, char.collider);
          if (gy === null || Math.abs(gy - p.y) > H * 0.12) continue;
          spot = new THREE.Vector3(x, gy, z);
          break search;
        }
      }
      if (!spot) {                                         // sem espaço livre: perto do avatar mesmo assim
        const ang = base + (used.length ? (used.length % 2 ? -1 : 1) * 60 : 0) * Math.PI / 180;
        spot = new THREE.Vector3(p.x + Math.sin(ang) * 1.4 * H, p.y, p.z + Math.cos(ang) * 1.4 * H);
      }
      used.push(spot);
      this.list.push(this._build(id, spot, R));
    }
    return true;
  }

  _build(id, at, R) {
    const D = DESTS[id];
    const g = new THREE.Group();
    g.position.copy(at);
    const ring = new THREE.Group(); ring.position.y = R * 1.08; g.add(ring);
    // anel
    const torus = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.085, 14, 64),
      new THREE.MeshStandardMaterial({ color: D.c1, emissive: D.c1, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.3 }));
    torus.castShadow = true;
    ring.add(torus);
    // redemoinho
    const swirlMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uC1: { value: new THREE.Color(D.c1) }, uC2: { value: new THREE.Color(D.c2) }, uPower: { value: 0 } },
    });
    const swirl = new THREE.Mesh(new THREE.CircleGeometry(R * 0.96, 48), swirlMat);
    ring.add(swirl);
    // faíscas em órbita
    const N = 36, pos = new Float32Array(N * 3);
    const sparks = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3)),
      new THREE.PointsMaterial({ color: D.c1, size: Math.max(0.006, R * 0.07), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending }));
    sparks.frustumCulled = false;
    ring.add(sparks);
    // brilho no chão
    const glow = new THREE.Mesh(new THREE.RingGeometry(R * 0.35, R * 1.15, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: D.c1, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.y = 0.003; g.add(glow);
    // nome
    const tag = label(D.name, D.c1);
    tag.scale.set(R * 1.9, R * 0.475, 1); tag.position.y = R * 2.45; g.add(tag);
    g.scale.setScalar(0.001);
    this.ctx.scene.add(g);
    return { id, dest: D, g, ring, swirlMat, sparks, glow, R, born: this.t, seed: Math.random() * 10 };
  }

  close() {
    for (const p of this.list) {
      this.ctx.scene.remove(p.g);
      p.g.traverse((o) => { o.geometry?.dispose?.(); if (o.material) { o.material.map?.dispose?.(); o.material.dispose?.(); } });
    }
    this.list = [];
    this.warp = null;
  }

  /** @returns true enquanto o avatar está sendo levado (o app não deve mexer nele) */
  update(dt) {
    this.t += dt;
    if (!this.list.length) return false;
    const { char, camPos } = this.ctx;
    const H = char.height, cp = char.position;
    for (const p of this.list) {
      const age = this.t - p.born;
      const grow = Math.min(1, age / 0.45);
      const k = 1 - (1 - grow) ** 3;                                       // aparece com "pop"
      p.g.scale.setScalar(Math.max(0.001, k * (1 + Math.sin(Math.min(1, age / 0.45) * Math.PI) * 0.12)));
      p.g.rotation.y = Math.atan2(camPos.x - p.g.position.x, camPos.z - p.g.position.z);   // de frente para você
      p.ring.position.y = p.R * 1.08 + Math.sin(this.t * 2 + p.seed) * p.R * 0.04;
      p.ring.children[0].rotation.z += dt * 0.6;
      const power = this.warp?.p === p ? Math.min(1, this.warp.t / 0.5) : 0;
      p.swirlMat.uniforms.uTime.value = this.t * (1 + power * 2);
      p.swirlMat.uniforms.uPower.value = power;
      p.glow.material.opacity = 0.3 + Math.sin(this.t * 3 + p.seed) * 0.12 + power * 0.4;
      const a = p.sparks.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        const ang = i / a.count * Math.PI * 2 + this.t * (1.2 + (i % 3) * 0.5);
        const rr = p.R * (1.08 + 0.12 * Math.sin(this.t * 3 + i));
        a.setXYZ(i, Math.cos(ang) * rr, Math.sin(ang) * rr, Math.sin(this.t * 4 + i * 1.7) * p.R * 0.12);
      }
      a.needsUpdate = true;
    }
    if (this.warp) return this._updateWarp(dt);
    // entrou no portal?
    for (const p of this.list) {
      if (this.t - p.born < 0.6) continue;
      const gp = p.g.position;
      if (Math.hypot(cp.x - gp.x, cp.z - gp.z) < p.R * 0.85 && Math.abs(cp.y - gp.y) < H * 0.5) {
        this._startWarp(p);
        return true;
      }
    }
    return false;
  }

  _startWarp(p) {
    const { char } = this.ctx;
    if (char.held) char.release(false);
    const root = char.avatar.root;
    this.warp = { p, t: 0, from: root.position.clone(), s0: root.scale.clone(), done: false };
    this.ctx.sfx?.warp?.();
    navigator.vibrate?.([20, 40, 60]);
  }

  _updateWarp(dt) {
    const w = this.warp, { char } = this.ctx;
    w.t += dt;
    const root = char.avatar.root, R = w.p.R;
    const k = Math.min(1, w.t / 1.1);
    const e = k * k * (3 - 2 * k);
    const c = w.p.g.position;
    const toY = c.y + R * 1.08 - char.height * 0.45 * (1 - e);
    root.position.set(w.from.x + (c.x - w.from.x) * e, w.from.y + (toY - w.from.y) * e, w.from.z + (c.z - w.from.z) * e);
    root.scale.copy(w.s0).multiplyScalar(Math.max(0.02, 1 - e * 0.98));
    root.rotation.y += dt * (4 + e * 18);
    char.avatar.update(dt);
    if (k >= 1 && !w.done) {
      w.done = true;
      root.visible = false;
      this.ctx.onEnter?.(w.p.dest.url, w.p.dest);
    }
    return true;
  }
}
