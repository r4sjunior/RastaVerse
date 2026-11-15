// Portais RastaVerse: portais 3D que aparecem no mundo real, em volta do avatar. Leve o avatar até
// um deles e ele é "sugado" para o outro jogo (Rasta Memo, Rasta Runner, Rastetris) ou para a RastaWallet.
import * as THREE from 'three';

export const DESTS = {
  memo: { name: 'Rasta Memo', desc: 'Jogo da memória', url: 'https://rastamemo.vercel.app/', c1: 0x2ee6a8, c2: 0x1b6dff },
  runner: { name: 'Rasta Runner', desc: 'Corrida High Tide', url: 'https://rastarunner.vercel.app/', c1: 0xffc23d, c2: 0xff3d6e },
  tetris: { name: 'Rastetris', desc: 'Blocos rasta', url: 'https://rastetris.vercel.app/', c1: 0xb05cff, c2: 0x3dd6ff },
  // portal especial nas cores do reggae: verde, amarelo e vermelho
  wallet: { name: 'RastaWallet', desc: 'Carteira CryptoRastas', url: 'https://app.cryptorastas.com/', c1: 0x14c43c, c2: 0xffd21a, c3: 0xec1c24, reggae: true },
};
const REGGAE = [0xec1c24, 0xffd21a, 0x14c43c];

const VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
// redemoinho: espiral girando para dentro + brilho na borda
const FRAG = /* glsl */`
uniform float uTime; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform float uPower; uniform float uReggae;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float d = length(p);
  if (d > 1.0) discard;
  float a = atan(p.y, p.x);
  float s = sin(a * 3.0 + d * 11.0 - uTime * 5.0) * 0.5 + 0.5;
  float s2 = sin(a * 5.0 - d * 7.0 + uTime * 3.0) * 0.5 + 0.5;
  vec3 col = mix(uC2, uC1, s * 0.75 + s2 * 0.25);
  if (uReggae > 0.5) {
    // 3 faixas em espiral (vermelho, amarelo, verde) girando para dentro, com transição curta e viva
    float k = fract(a / 6.2831853 * 3.0 + d * 1.7 - uTime * 0.55) * 3.0;
    vec3 c = mix(uC3, uC2, smoothstep(0.8, 1.0, k));
    c = mix(c, uC1, smoothstep(1.8, 2.0, k));
    c = mix(c, uC3, smoothstep(2.8, 3.0, k));
    col = c * (1.05 + 0.25 * s2) + vec3(0.18) * pow(s, 6.0);   // brilho que corre pelas faixas
  }
  col += vec3(1.0) * pow(1.0 - d, 3.0) * (0.6 + 0.4 * uPower);   // miolo claro
  float alpha = smoothstep(1.0, 0.82, d) * (0.38 + 0.3 * s + 0.3 * uPower + 0.22 * uReggae);
  gl_FragColor = vec4(col * (0.9 + uPower * 0.6), alpha);
}`;

function label(text, color, reggae = false) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 128;
  const g = c.getContext('2d');
  g.font = '700 64px "Space Grotesk", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const w = Math.min(500, g.measureText(text).width + 56);
  g.fillStyle = 'rgba(12,14,17,.82)';
  g.beginPath(); g.roundRect?.(256 - w / 2, 18, w, 92, 46); if (!g.roundRect) g.rect(256 - w / 2, 18, w, 92); g.fill();
  if (reggae) {
    const gr = g.createLinearGradient(256 - w / 2, 0, 256 + w / 2, 0);
    gr.addColorStop(0, '#ec1c24'); gr.addColorStop(0.5, '#ffd21a'); gr.addColorStop(1, '#14c43c');
    g.lineWidth = 8; g.strokeStyle = gr;
  } else { g.lineWidth = 5; g.strokeStyle = '#' + color.toString(16).padStart(6, '0'); }
  g.stroke();
  g.fillStyle = '#ffffff'; g.fillText(text, 256, 66);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
}

const _a = new THREE.Vector3(), _b = new THREE.Vector3();

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
    // a RastaWallet escolhe lugar primeiro (o melhor ponto é dela)
    const want = ids === 'all' ? Object.keys(DESTS).sort((a, b) => (DESTS[b].reggae ? 1 : 0) - (DESTS[a].reggae ? 1 : 0)) : [ids];
    const H = char.height, p = char.position;
    this.openPos = p.clone(); this.moved = false;
    const R = 0.5 * H;                                     // raio do anel (um pouco mais alto que o avatar)
    // de frente para a câmera, do lado de lá do avatar (fica visível na tela)
    const base = Math.atan2(p.x - camPos.x, p.z - camPos.z);
    // direções em ordem de preferência (atrás do avatar, depois para os lados, por último para a câmera)
    const angs = [0, -30, 30, -60, 60, -90, 90, -120, 120, -150, 150, 180];
    // superfície na mesma altura do avatar (dá para chegar andando)
    const level = (x, z) => {
      const gy = world.groundBelow(x, p.y + H * 0.6, z, H * 1.4, char.collider);
      return gy !== null && Math.abs(gy - p.y) <= H * 0.15 ? gy : null;
    };
    // o lugar precisa de chão no centro, em volta (o círculo de luz inteiro) e no caminho até o avatar —
    // antes um portal podia nascer além da borda da mesa, no ar, onde o avatar nunca chegava
    const fits = (x, z) => {
      const gy = level(x, z);
      if (gy === null) return null;
      for (let k = 0; k < 4; k++) {
        const a = k * Math.PI / 2;
        if (level(x + Math.cos(a) * R * 0.8, z + Math.sin(a) * R * 0.8) === null) return null;
      }
      for (const f of [0.35, 0.65]) if (level(p.x + (x - p.x) * f, p.z + (z - p.z) * f) === null) return null;
      return gy;
    };
    const used = [];
    const find = (dists, sep, test = fits) => {
      for (const d of dists) {
        for (const a of angs) {
          const ang = base + a * Math.PI / 180;
          const x = p.x + Math.sin(ang) * d, z = p.z + Math.cos(ang) * d;
          if (used.some((u) => Math.hypot(u.x - x, u.z - z) < sep)) continue;
          const gy = test(x, z);
          if (gy !== null) return new THREE.Vector3(x, gy, z);
        }
      }
      return null;
    };
    // avatar grande (tamanho real, no chão): portais a no máximo ~1,5 m dele, não a 3 m
    const cap = (ds) => ds.map((d) => Math.min(d, R * 1.8 + 0.6));
    for (const id of want) {
      const spot = find(cap([1.7 * H, 1.3 * H, 2.2 * H]), R * 2.3)
        || find(cap([1.0 * H, 0.8 * H, 2.8 * H]), R * 1.7)       // mesa pequena: mais perto e mais juntos
        // ainda sem lugar: basta chão no centro e no caminho (o círculo pode passar um pouco da borda)
        || find(cap([1.2 * H, 0.9 * H, 1.6 * H, 2.4 * H, 3.2 * H]), R * 1.35, (x, z) => {
          const gy = level(x, z);
          return gy !== null && level(p.x + (x - p.x) * 0.5, p.z + (z - p.z) * 0.5) !== null ? gy : null;
        })
        || new THREE.Vector3(p.x, p.y, p.z);                     // sem lugar nenhum: no próprio avatar (ver "armed")
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
    let torus;
    if (D.reggae) {
      // anel em 3 arcos (vermelho, amarelo, verde) + anel fino dourado por fora
      torus = new THREE.Group();
      REGGAE.forEach((col, i) => {
        const arc = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.11, 14, 32, Math.PI * 2 / 3),
          new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 1.1, roughness: 0.3, metalness: 0.2 }));
        arc.rotation.z = i * Math.PI * 2 / 3; arc.castShadow = true;
        torus.add(arc);
      });
      torus.add(new THREE.Mesh(new THREE.TorusGeometry(R * 1.17, R * 0.025, 8, 64),
        new THREE.MeshBasicMaterial({ color: 0xffd21a, transparent: true, opacity: 0.85 })));
    } else {
      torus = new THREE.Mesh(new THREE.TorusGeometry(R, R * 0.085, 14, 64),
        new THREE.MeshStandardMaterial({ color: D.c1, emissive: D.c1, emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.3 }));
      torus.castShadow = true;
    }
    ring.add(torus);
    // redemoinho
    const swirlMat = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: {
        uTime: { value: 0 }, uC1: { value: new THREE.Color(D.c1) }, uC2: { value: new THREE.Color(D.c2) },
        uC3: { value: new THREE.Color(D.c3 ?? D.c2) }, uPower: { value: 0 }, uReggae: { value: D.reggae ? 1 : 0 },
      },
    });
    const swirl = new THREE.Mesh(new THREE.CircleGeometry(R * 0.96, 48), swirlMat);
    ring.add(swirl);
    // faíscas em órbita
    const N = D.reggae ? 60 : 36, pos = new Float32Array(N * 3);
    const sg = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (D.reggae) {
      const cols = new Float32Array(N * 3), c = new THREE.Color();
      for (let i = 0; i < N; i++) { c.setHex(REGGAE[i % 3]); cols.set([c.r, c.g, c.b], i * 3); }
      sg.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    }
    const sparks = new THREE.Points(sg, new THREE.PointsMaterial({
      color: D.reggae ? 0xffffff : D.c1, vertexColors: !!D.reggae, size: Math.max(0.006, R * (D.reggae ? 0.09 : 0.07)),
      transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
    sparks.frustumCulled = false;
    ring.add(sparks);
    // brilho no chão
    const glow = new THREE.Mesh(new THREE.RingGeometry(R * 0.35, R * 1.15, 48).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: D.c1, transparent: true, opacity: 0.4, depthWrite: false, blending: THREE.AdditiveBlending }));
    glow.position.y = 0.003; g.add(glow);
    if (D.reggae) {
      // vermelho por fora, amarelo no meio (o verde é o glow principal)
      const bands = new THREE.Group(); bands.position.y = 0.004;
      [[1.15, 1.32, REGGAE[0]], [0.98, 1.15, REGGAE[1]]].forEach(([r0, r1, col]) => {
        bands.add(new THREE.Mesh(new THREE.RingGeometry(R * r0, R * r1, 48).rotateX(-Math.PI / 2),
          new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending })));
      });
      g.add(bands);
      glow.userData.bands = bands;
    }
    // nome
    const tag = label(D.name, D.c1, !!D.reggae);
    tag.scale.set(R * 1.9, R * 0.475, 1); tag.position.y = R * 2.45; g.add(tag);
    g.scale.setScalar(0.001);
    this.ctx.scene.add(g);
    return { id, dest: D, g, ring, swirlMat, sparks, glow, R, born: this.t, seed: Math.random() * 10, armed: false, near: 0 };
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
      p.glow.material.opacity = 0.3 + Math.sin(this.t * 3 + p.seed) * 0.12 + (p.near || 0) * 0.35 + power * 0.4;
      if (p.dest.reggae) {
        // pulsa no ritmo (~75 bpm, "one drop") e os anéis do chão piscam alternados
        const beat = Math.pow(Math.max(0, Math.sin(this.t * Math.PI * 1.25)), 8);
        p.ring.children[0].scale.setScalar(1 + beat * 0.07);
        const b = p.glow.userData.bands;
        b.children.forEach((m, i) => { m.material.opacity = 0.35 + 0.35 * Math.max(0, Math.sin(this.t * 4 + i * 2.1)) + power * 0.3; });
      }
      const a = p.sparks.geometry.attributes.position;
      for (let i = 0; i < a.count; i++) {
        const ang = i / a.count * Math.PI * 2 + this.t * (1.2 + (i % 3) * 0.5);
        const rr = p.R * (1.08 + 0.12 * Math.sin(this.t * 3 + i));
        a.setXYZ(i, Math.cos(ang) * rr, Math.sin(ang) * rr, Math.sin(this.t * 4 + i * 1.7) * p.R * 0.12);
      }
      a.needsUpdate = true;
    }
    if (this.warp) return this._updateWarp(dt);
    // só depois que o avatar andou: nunca puxa sozinho um avatar parado logo que os portais abrem
    if (!this.moved && this.openPos && Math.hypot(cp.x - this.openPos.x, cp.z - this.openPos.z) > H * 0.12) this.moved = true;
    // entrou no portal? = pisou no círculo de luz do chão. Antes era preciso passar a ~10 cm do centro
    // (com o portal de frente para a câmera, isso é andar "para dentro da tela", a direção mais difícil de
    // acertar em AR): o avatar passava do lado/atrás e nada acontecia.
    for (const p of this.list) {
      const gp = p.g.position;
      const d = Math.hypot(cp.x - gp.x, cp.z - gp.z), dy = Math.abs(cp.y - gp.y);
      if (d > p.R * 1.5) p.armed = true;                    // portal que nasceu em cima do avatar: só depois de sair
      p.near = Math.max(0, 1 - Math.max(0, d - p.R * 1.15) / (p.R * 2));   // brilho aumenta ao chegar perto
      if (this.t - p.born < 0.6 || !p.armed || !this.moved) continue;
      if (dy < H * 0.6 && (d < p.R * 1.15 || (d < p.R * 2.2 && this._overlapOnScreen(p, cp, H)))) {
        this._startWarp(p);
        return true;
      }
    }
    return false;
  }

  /**
   * Na tela, o avatar está "dentro" do redemoinho? Em AR é difícil julgar profundidade: quem vê o avatar
   * sobre o portal espera que ele entre, mesmo uns centímetros à frente ou atrás. Mede pelo ângulo visto da
   * câmera (centro do avatar dentro de 80% do disco) — junto com a distância curta checada antes.
   */
  _overlapOnScreen(p, cp, H) {
    const cam = this.ctx.camPos;
    _a.set(cp.x - cam.x, cp.y + H * 0.5 - cam.y, cp.z - cam.z);
    p.ring.getWorldPosition(_b); _b.sub(cam);
    const dist = _b.length();
    if (dist < 1e-3) return false;
    const ang = _a.angleTo(_b);
    return ang < Math.atan((p.R * 0.8) / dist);
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
