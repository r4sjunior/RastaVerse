// Minigames no mundo real. Tudo é posicionado nas superfícies que a câmera mapeou (topos dos voxels
// com espaço livre em cima) e dimensionado pela altura do avatar (H), com física real (Rapier).
//
//  coins    Caça às Moedas      8 moedas (algumas no alto), 60 s
//  race     Corrida dos Anéis   5 portais em sequência, cronômetro
//  hoops    Basquete Rasta      cesta com aro físico; pegue a bola e arremesse (mira assistida), 60 s
//  bowling  Boliche             6 pinos físicos, 2 bolas
//  tower    Torre da Estrela    estrela alta demais para pular: empilhe caixas e suba
import * as THREE from 'three';
import { packKey, unpackKey } from '/shared/voxelmap.js';
import { GAMES } from './hud.js';
import { sfx } from './sfx.js';

const G = 9.81;
const GOLD = 0xf2c230, ACCENT = 0xd9e27a;
const _v = new THREE.Vector3(), _c = new THREE.Vector3();

function loadBest() { try { return JSON.parse(localStorage.getItem('rastame.best') || '{}'); } catch { return {}; } }
function saveBest(b) { try { localStorage.setItem('rastame.best', JSON.stringify(b)); } catch { /* ok */ } }
const fmtT = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const fmtS = (s) => s.toFixed(1).replace('.', ',') + ' s';

export class Games {
  /** ctx: { R, scene, world, char, hud, toast, camPos, camFwd, throwFromCamera } */
  constructor(ctx) {
    this.ctx = ctx;
    this.cur = null;          // jogo em andamento
    this.objs = [];           // malhas a remover
    this.bodies = [];         // corpos físicos a remover
    this.best = loadBest();
    for (const g of GAMES) this._showBest(g.id);
  }

  get active() { return !!this.cur; }
  _showBest(id) {
    const b = this.best[id];
    if (b === undefined) return this.ctx.hud.best(id, '');
    this.ctx.hud.best(id, id === 'race' || id === 'tower' ? fmtS(b) : String(b));
  }

  // ------------------------------------------------------------------ lugares no mundo real
  /**
   * Pontos de superfície alcançáveis perto do avatar: topos de voxels com espaço livre acima,
   * em [minD, maxD] na horizontal e subida de no máximo maxRise. Distribuídos (espaçamento mínimo).
   */
  spots(n, { minD, maxD, maxRise, minRise = -2, spacing, preferHigh = 0, flat = false }) {
    const { world, char } = this.ctx;
    const H = char.height, p = char.position, r = world.res;
    const clear = Math.max(2, Math.ceil((0.7 * H) / r));
    const t = [0, 0, 0];
    const cand = [];
    for (const [key, top] of world.tops) {
      unpackKey(key, t);
      const x = (t[0] + 0.5) * r, z = (t[2] + 0.5) * r;
      const d = Math.hypot(x - p.x, z - p.z);
      if (d < minD || d > maxD) continue;
      const rise = top - p.y;
      if (rise > maxRise || rise < minRise) continue;
      let free = true;
      for (let j = 1; j <= clear && free; j++) if (world.tops.has(packKey(t[0], t[1] + j, t[2]))) free = false;
      if (!free) continue;
      if (flat) {   // vizinhos na mesma altura (para pinos e cesta)
        let ok = 0;
        for (const [di, dk] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const tt = world.tops.get(packKey(t[0] + di, t[1], t[2] + dk));
          if (tt !== undefined && Math.abs(tt - top) < 0.01) ok++;
        }
        if (ok < 3) continue;
      }
      cand.push({ x, y: top, z, rise, d });
    }
    // mistura: alguns altos (para escalar), o resto aleatório
    for (let i = cand.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; [cand[i], cand[j]] = [cand[j], cand[i]]; }
    if (preferHigh > 0) cand.sort((a, b) => (b.rise > 0.2 * H) - (a.rise > 0.2 * H));
    const out = [];
    let high = 0;
    for (const c of cand) {
      if (out.length >= n) break;
      if (c.rise > 0.2 * H) { if (high >= preferHigh && preferHigh > 0) continue; high++; }
      if (out.some((o) => Math.hypot(o.x - c.x, o.z - c.z) < spacing)) continue;
      out.push(c);
    }
    // reserva: anel em volta do avatar, no mesmo nível (mapa ainda pobre)
    for (let k = 0; out.length < n && k < n * 6; k++) {
      const a = Math.random() * Math.PI * 2, d = minD + Math.random() * (maxD - minD);
      const x = p.x + Math.cos(a) * d, z = p.z + Math.sin(a) * d;
      const gy = world.groundBelow(x, p.y + H, z, H * 1.6);
      if (gy === null || Math.abs(gy - p.y) > 0.3 * H) continue;
      if (out.some((o) => Math.hypot(o.x - x, o.z - z) < spacing)) continue;
      out.push({ x, y: gy, z, rise: gy - p.y, d });
    }
    return out;
  }

  _mesh(m) { this.ctx.scene.add(m); this.objs.push(m); return m; }

  /** bola do jogo parada, apoiada na superfície (antes nascia no ar, quicava e rolava sozinha) */
  _restingBall(x, z, radius, color) {
    const { world, char } = this.ctx;
    const gy = world.groundBelow(x, char.position.y + char.height, z, char.height * 2.5) ?? char.position.y;
    const pr = world.spawnBall(new THREE.Vector3(x, gy + radius + 0.002, z), new THREE.Vector3(), radius, color);
    this.bodies.push({ prop: pr });
    return pr;
  }
  _fixed(desc) { const c = this.ctx.world.physics.createCollider(desc); this.bodies.push({ c }); return c; }

  // ------------------------------------------------------------------ ciclo
  start(id) {
    this.stop(true);
    const { char, hud } = this.ctx;
    if (!char.body) return;
    const H = char.height;
    const scale = THREE.MathUtils.clamp(H / 0.25, 0.4, 7);
    const def = GAMES.find((g) => g.id === id);
    this.cur = { id, name: def.name, t: 0, state: 'count', countT: 3.2, score: 0, H, scale, lastCount: 4 };
    this['setup_' + id](this.cur);
    hud.game({ title: def.name, score: this._scoreText(), time: '' });
    hud.hint(def.desc);
    setTimeout(() => { if (this.cur?.id === id) hud.hint(''); }, 3500);
  }

  stop(silent = false) {
    const { world, scene, hud } = this.ctx;
    if (this.cur?.cleanup) this.cur.cleanup();
    for (const m of this.objs) {
      scene.remove(m);
      m.traverse?.((o) => {
        o.geometry?.dispose?.();
        for (const mt of [].concat(o.material || [])) mt.dispose?.();   // materiais também (vazava a cada partida)
      });
    }
    for (const b of this.bodies) {
      if (b.c) world.physics.removeCollider(b.c, false);
      if (b.prop && world.props.includes(b.prop)) world.removeProp(b.prop);
    }
    this.objs = []; this.bodies = [];
    this.cur = null;
    hud.game(null); hud.count(null);
    if (!silent) hud.result(null);
  }

  again() { const id = this.lastId; if (id) this.start(id); }

  _finish(big, sub, value, better) {
    const g = this.cur;
    this.lastId = g.id;
    const prev = this.best[g.id];
    const record = value !== undefined && (prev === undefined || better(value, prev));
    if (record) { this.best[g.id] = value; saveBest(this.best); this._showBest(g.id); }
    const name = g.name;
    this.stop(true);
    sfx.win();
    this.ctx.hud.result({ kicker: record ? 'Novo recorde!' : 'Fim de jogo', title: name, big, sub });
  }

  _scoreText() {
    const g = this.cur;
    if (!g) return '';
    return g.scoreText ? g.scoreText() : String(g.score);
  }

  update(dt) {
    const g = this.cur;
    if (!g) return;
    const { hud } = this.ctx;
    if (g.state === 'abort') return;
    g.anim?.(dt);
    if (g.state === 'count') {
      g.settle?.();
      g.countT -= dt;
      const n = Math.ceil(g.countT - 0.2);
      if (n !== g.lastCount) {
        g.lastCount = n;
        if (n > 0) { hud.count(String(n)); sfx.tick(); } else { hud.count('Vai!'); sfx.go(); }
      }
      if (g.countT <= 0) { g.state = 'run'; setTimeout(() => this.ctx.hud.count(null), 450); }
      return;
    }
    g.t += dt;
    const left = g.limit ? Math.max(0, g.limit - g.t) : null;
    hud.game({ title: g.name, score: this._scoreText(), time: left !== null ? fmtT(Math.ceil(left)) : fmtS(g.t), low: left !== null && left < 10 });
    g.tick?.(dt);
    if (this.cur && left !== null && left <= 0) g.timeUp?.();
  }

  /**
   * Mira assistida: velocidade balística exata de `from` até o alvo do jogo, passando por um ápice
   * `aimApex` acima do ponto mais alto. Só ajuda se o avatar estiver mais ou menos de frente para o alvo.
   */
  aimVelocity(from, yaw) {
    const g = this.cur;
    if (!g?.aim || g.state !== 'run') return null;
    const T = g.aim();
    const dx = T.x - from.x, dz = T.z - from.z;
    const face = Math.atan2(dx, dz) - yaw;
    if (Math.abs(Math.atan2(Math.sin(face), Math.cos(face))) > 0.75) return null;
    const apexY = Math.max(from.y, T.y) + (g.aimApex ?? 0.5 * g.H);
    const vy = Math.sqrt(2 * G * (apexY - from.y));
    const t = vy / G + Math.sqrt(Math.max(0, 2 * (apexY - T.y) / G));
    return { x: dx / t, y: vy, z: dz / t };
  }

  // pontos de referência do avatar
  _center(out = _c) { const { char } = this.ctx; return out.copy(char.position).setY(char.position.y + char.height * 0.5); }

  // ================================================================== 1) Caça às Moedas
  setup_coins(g) {
    const H = g.H;
    const pts = this.spots(8, { minD: 0.8 * H, maxD: Math.max(0.6, 5 * H), maxRise: 1.25 * H, spacing: 0.9 * H, preferHigh: 3 });
    const geo = new THREE.CylinderGeometry(0.11 * H, 0.11 * H, 0.025 * H, 24).rotateX(Math.PI / 2);
    // dourado com brilho próprio: destaca na imagem da câmera, com qualquer luz
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd23f, metalness: 0.35, roughness: 0.3, emissive: 0xc98a00, emissiveIntensity: 0.55 });
    const ring = new THREE.TorusGeometry(0.115 * H, 0.012 * H, 8, 28);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x3f8f3a });
    g.coins = pts.map((p) => {
      const m = new THREE.Group();
      m.add(new THREE.Mesh(geo, mat), new THREE.Mesh(ring, ringMat));
      m.position.set(p.x, p.y + 0.32 * H, p.z);
      m.userData.baseY = m.position.y;
      m.children.forEach((c) => { c.castShadow = true; });
      return this._mesh(m);
    });
    g.total = g.coins.length; g.limit = 60;
    g.scoreText = () => `${g.score}/${g.total}`;
    g.anim = (dt) => { for (const c of g.coins) { c.rotation.y += dt * 3; c.position.y = c.userData.baseY + Math.sin(performance.now() / 300 + c.id) * 0.03 * H; } };
    g.tick = () => {
      const ctr = this._center();
      for (let i = g.coins.length - 1; i >= 0; i--) {
        const c = g.coins[i];
        if (c.position.distanceTo(ctr) < 0.42 * H) {
          this.ctx.scene.remove(c); g.coins.splice(i, 1); g.score++; sfx.coin(); navigator.vibrate?.(15);
        }
      }
      if (!g.coins.length) this._finish(`${g.total}/${g.total}`, `Todas as moedas em ${fmtS(g.t)}`, g.t, (a, b) => a < b);
    };
    g.timeUp = () => this._finish(`${g.score}/${g.total}`, g.score ? 'Faltou pouco! Tente subir nos lugares altos.' : 'Procure as moedas brilhando pela mesa.', undefined);
  }

  // ================================================================== 2) Corrida dos Anéis
  setup_race(g) {
    const H = g.H, p = this.ctx.char.position;
    let pts = this.spots(10, { minD: 1.2 * H, maxD: Math.max(0.7, 6 * H), maxRise: 0.9 * H, spacing: 1.6 * H, preferHigh: 1 });
    // ordem: vizinho mais próximo a partir do avatar
    const order = [];
    let cur = { x: p.x, z: p.z };
    while (pts.length && order.length < 5) {
      pts.sort((a, b) => Math.hypot(a.x - cur.x, a.z - cur.z) - Math.hypot(b.x - cur.x, b.z - cur.z));
      cur = pts.shift(); order.push(cur);
    }
    const tor = new THREE.TorusGeometry(0.45 * H, 0.05 * H, 10, 36);
    g.gates = order.map((o, i) => {
      const mat = new THREE.MeshBasicMaterial({ color: i === 0 ? ACCENT : 0xffffff, transparent: true, opacity: i === 0 ? 0.95 : 0.25 });
      const m = new THREE.Mesh(tor, mat);
      m.position.set(o.x, o.y + 0.5 * H, o.z);
      const nx = order[i + 1] || { x: p.x, z: p.z };
      m.rotation.y = Math.atan2(nx.x - o.x, nx.z - o.z);
      return this._mesh(m);
    });
    g.total = g.gates.length; g.next = 0;
    g.scoreText = () => `${g.next}/${g.total}`;
    g.anim = (dt) => { const m = g.gates[g.next]; if (m) m.scale.setScalar(1 + Math.sin(performance.now() / 160) * 0.06); };
    g.tick = () => {
      const m = g.gates[g.next];
      if (!m) return;
      if (m.position.distanceTo(this._center()) < 0.5 * H) {
        m.visible = false; g.next++; sfx.gate(); navigator.vibrate?.(20);
        const n = g.gates[g.next];
        if (n) { n.material.color.set(ACCENT); n.material.opacity = 0.95; }
        else this._finish(fmtS(g.t), `${g.total} portais`, g.t, (a, b) => a < b);
      }
    };
  }

  // ================================================================== 3) Basquete Rasta
  setup_hoops(g) {
    const { R, world, char } = this.ctx;
    const H = g.H, p = char.position;
    const s = this.spots(1, { minD: 2.2 * H, maxD: Math.max(0.6, 4 * H), maxRise: 0.15 * H, minRise: -0.15 * H, spacing: 0, flat: true })[0];
    const base = s || { x: p.x + 2.6 * H, y: p.y, z: p.z };
    const rimR = Math.max(0.075, 0.3 * H), rimY = base.y + 1.15 * H;
    g.hoop = new THREE.Vector3(base.x, rimY, base.z);
    // aponta a tabela para o avatar
    const ang = Math.atan2(p.x - base.x, p.z - base.z);
    const back = new THREE.Vector3(-Math.sin(ang), 0, -Math.cos(ang));
    const grp = new THREE.Group();
    const rimMat = new THREE.MeshStandardMaterial({ color: 0xe0532f, metalness: 0.4, roughness: 0.4 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(rimR, Math.max(0.004, 0.018 * H), 8, 32).rotateX(Math.PI / 2), rimMat);
    rim.position.copy(g.hoop); grp.add(rim);
    const net = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR * 0.6, 0.35 * H, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.6 }));
    net.position.copy(g.hoop).y -= 0.175 * H; grp.add(net);
    const boardW = rimR * 3.2, boardH = rimR * 2.2, boardT = Math.max(0.004, 0.03 * H);
    const boardPos = g.hoop.clone().addScaledVector(back, rimR + boardT).add(new THREE.Vector3(0, boardH * 0.3, 0));
    const board = new THREE.Mesh(new THREE.BoxGeometry(boardW, boardH, boardT),
      new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }));
    board.position.copy(boardPos); board.rotation.y = ang; grp.add(board);
    const poleH = rimY - base.y + boardH * 0.3;
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * H, 0.02 * H, poleH, 10), new THREE.MeshStandardMaterial({ color: 0x333333 }));
    const polePos = new THREE.Vector3(base.x, base.y, base.z);
    polePos.addScaledVector(back, rimR + boardT * 2).y += poleH / 2; pole.position.copy(polePos); grp.add(pole);
    grp.traverse((o) => { o.castShadow = true; });
    this._mesh(grp);
    // física: tabela, poste e aro (anel de bolinhas fixas)
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ang);
    this._fixed(R.ColliderDesc.cuboid(boardW / 2, boardH / 2, boardT / 2).setTranslation(boardPos.x, boardPos.y, boardPos.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setRestitution(0.5));
    this._fixed(R.ColliderDesc.cylinder(poleH / 2, 0.02 * H).setTranslation(polePos.x, polePos.y, polePos.z));
    const rr = Math.max(0.003, 0.016 * H);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      this._fixed(R.ColliderDesc.ball(rr).setTranslation(g.hoop.x + Math.cos(a) * rimR, rimY, g.hoop.z + Math.sin(a) * rimR).setRestitution(0.55));
    }
    g.rimR = rimR; g.limit = 60; g.seen = new Map();
    g.scoreText = () => `${g.score} cestas`;
    // bolas do jogo: aparecem perto do avatar
    g.feed = () => {
      const balls = this.bodies.filter((b) => b.prop && world.props.includes(b.prop));
      if (balls.length >= 2 || char.held) return;
      const pp = char.position;
      const a = Math.random() * Math.PI * 2;
      this._restingBall(pp.x + Math.cos(a) * 0.45 * H, pp.z + Math.sin(a) * 0.45 * H, Math.max(0.02, 0.09 * H), 0xff8a3d);
    };
    g.feed(); g.feed();
    g.feedT = 0;
    g.aim = () => g.hoop; g.aimApex = 0.7 * H;
    g.tick = (dt) => {
      if ((g.feedT += dt) > 1.2) { g.feedT = 0; g.feed(); }
      for (const pr of world.props) {
        if (pr.kind !== 'ball' || pr === char.held) continue;
        const t = pr.body.translation();
        const prev = g.seen.get(pr);
        g.seen.set(pr, t.y);
        if (prev !== undefined && prev >= rimY && t.y < rimY && Math.hypot(t.x - g.hoop.x, t.z - g.hoop.z) < rimR * 0.95) {
          g.score++; sfx.score(); navigator.vibrate?.([20, 40, 20]);
          this.ctx.toast('Cesta!');
        }
      }
    };
    g.timeUp = () => this._finish(`${g.score}`, g.score === 1 ? 'cesta em 60 s' : 'cestas em 60 s', g.score, (a, b) => a > b);
  }

  // ================================================================== 4) Boliche
  setup_bowling(g) {
    const { R, world, char, camFwd } = this.ctx;
    const H = g.H, p = char.position;
    // pista: à frente do avatar (na direção da câmera), num trecho plano
    const dir = new THREE.Vector3(camFwd.x, 0, camFwd.z).normalize();
    const pinH = 0.38 * H, pinR = 0.055 * H, gap = 0.17 * H;
    const rows = [[0], [-0.5, 0.5], [-1, 0, 1]];
    const layout = (b) => {
      const tb = b.clone().sub(p).setY(0).normalize(), sd = new THREE.Vector3(-tb.z, 0, tb.x);
      const out = [];
      rows.forEach((row, ri) => row.forEach((c) => out.push(b.clone().addScaledVector(tb, ri * gap * 0.9).addScaledVector(sd, c * gap))));
      return { tb, sd, out };
    };
    // pista válida = os 6 pinos com chão plano embaixo (sem borda, sem objeto no meio)
    const flatAt = (x, z, y) => { const gy = world.groundBelow(x, y + 0.6 * H, z, H); return gy !== null && Math.abs(gy - y) < 0.015; };
    const valid = (b, lane = true) => {
      if (!layout(b).out.every((q) => flatAt(q.x, q.z, b.y))) return false;
      if (!lane) return true;
      // pista livre: do avatar até os pinos, chão plano e sem objeto no caminho (copo, livro...)
      for (let t = 0.2; t <= 0.9; t += 0.1) { if (!flatAt(p.x + (b.x - p.x) * t, p.z + (b.z - p.z) * t, b.y)) return false; }
      return true;
    };
    let base = null;
    for (const c of this.spots(12, { minD: 2.2 * H, maxD: Math.max(0.6, 4.5 * H), maxRise: 0.06 * H, minRise: -0.06 * H, spacing: 0.3 * H, flat: true })) {
      const b = new THREE.Vector3(c.x, c.y, c.z);
      if (valid(b)) { base = b; break; }
    }
    // reserva: 16 direções em volta do avatar, 3 distâncias, na superfície onde ele está
    for (const lane of [true, false]) {
      for (const d of [2.6, 2.0, 1.5]) {
        for (let a = 0; a < 16 && !base; a++) {
          const ang = Math.atan2(dir.x, dir.z) + (a % 2 ? 1 : -1) * Math.ceil(a / 2) * (Math.PI / 8);
          const b = new THREE.Vector3(p.x + Math.sin(ang) * d * H, p.y, p.z + Math.cos(ang) * d * H);
          if (valid(b, lane)) base = b;
        }
        if (base) break;
      }
      if (base) break;
    }
    if (!base) {
      g.state = 'abort';
      setTimeout(() => { this.stop(); this.ctx.toast('Pouco espaço plano para o boliche — escaneie mais a mesa ou use o chão'); }, 0);
      return;
    }
    const { tb: toBase } = layout(base);
    const geo = new THREE.CylinderGeometry(pinR * 0.7, pinR, pinH, 12);
    const mat = new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.35 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(pinR * 0.86, pinR * 0.86, pinH * 0.1, 12), new THREE.MeshStandardMaterial({ color: 0xc8372d }));
    g.pins = [];
    layout(base).out.forEach((pos) => {
      const gy = world.groundBelow(pos.x, pos.y + H, pos.z, H * 2) ?? base.y;
      const body = world.physics.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(pos.x, gy + pinH / 2 + 0.002, pos.z).setCcdEnabled(true));
      world.physics.createCollider(R.ColliderDesc.cylinder(pinH / 2, pinR).setDensity(180).setFriction(0.4).setRestitution(0.3), body);
      const m = new THREE.Group(); m.add(new THREE.Mesh(geo, mat)); const b2 = band.clone(); b2.position.y = pinH * 0.18; m.add(b2);
      m.traverse((o) => { o.castShadow = true; });
      this._mesh(m);
      g.pins.push({ body, m, down: false, home: { x: pos.x, y: gy + pinH / 2 + 0.002, z: pos.z } });
    });
    // na contagem 3-2-1: pino que tombou sozinho volta em pé
    g.settle = () => {
      for (const pn of g.pins) {
        const r = pn.body.rotation();
        _v.set(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
        if (_v.y < 0.95) {
          pn.body.setTranslation(pn.home, true); pn.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
          pn.body.setLinvel({ x: 0, y: 0, z: 0 }, true); pn.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
        }
      }
    };
    g.cleanup = () => { for (const pn of g.pins) world.physics.removeRigidBody(pn.body); };
    g.roll = 0; g.rollT = 0; g.ball = null;
    g.scoreText = () => `${g.score}/6 · bola ${Math.min(2, g.roll + 1)}/2`;
    g.giveBall = () => {
      const pp = char.position;
      // ao lado do avatar (não atrás, não entre ele e os pinos), parada
      const sd = new THREE.Vector3(-toBase.z, 0, toBase.x);
      g.ball = this._restingBall(pp.x + sd.x * 0.42 * H, pp.z + sd.z * 0.42 * H, Math.max(0.02, 0.1 * H), 0x2c4a9a);
      g.thrown = false; g.heldOnce = false;
    };
    g.giveBall();
    g.aim = () => base.clone().setY(base.y + 0.1 * H); g.aimApex = 0.15 * H;
    g.anim = () => { for (const pn of g.pins) { const t = pn.body.translation(), r = pn.body.rotation(); pn.m.position.set(t.x, t.y, t.z); pn.m.quaternion.set(r.x, r.y, r.z, r.w); } };
    g.tick = (dt) => {
      // contagem de pinos caídos
      let down = 0;
      for (const pn of g.pins) {
        const r = pn.body.rotation();
        _v.set(0, 1, 0).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
        if (_v.y < 0.6 || pn.body.translation().y < base.y - H) { if (!pn.down) { pn.down = true; sfx.pin(); } down++; }
      }
      g.score = down;
      const b = g.ball;
      if (char.held === b) g.heldOnce = true;
      // a jogada começa quando VOCÊ solta/arremessa a bola, ou quando algum pino se mexe (bola jogada pela câmera)
      if (!g.thrown) {
        const pinMoving = g.pins.some((pn) => { const v = pn.body.linvel(); return Math.hypot(v.x, v.y, v.z) > 0.15 * Math.sqrt(H); });
        if ((g.heldOnce && char.held !== b) || pinMoving) { g.thrown = true; g.rollT = 0; }
      }
      if (g.thrown) {
        g.rollT += dt;
        const still = (body) => { const v = body.linvel(); return Math.hypot(v.x, v.y, v.z) < 0.06; };
        if (g.rollT > 6 || (g.rollT > 1.5 && still(b.body) && g.pins.every((pn) => still(pn.body)))) {
          g.roll++; g.rollT = 0;
          if (down === 6 || g.roll >= 2) {
            this._finish(`${down}/6`, down === 6 ? (g.roll === 1 ? 'STRIKE!' : 'SPARE!') : 'pinos derrubados', down, (a, c) => a > c);
            return;
          }
          this.ctx.toast(down ? `${down} pinos! Mais uma bola` : 'Mais uma bola');
          if (world.props.includes(b)) world.removeProp(b);
          g.giveBall();
        }
      }
    };
  }

  // ================================================================== 5) Torre da Estrela
  setup_tower(g) {
    const { world, char } = this.ctx;
    const H = g.H, p = char.position;
    const s = this.spots(1, { minD: 1.4 * H, maxD: Math.max(0.5, 3 * H), maxRise: 0.1 * H, minRise: -0.1 * H, spacing: 0, flat: true })[0];
    const base = s ? new THREE.Vector3(s.x, s.y, s.z) : p.clone().add(new THREE.Vector3(1.8 * H, 0, 0));
    // alta demais para pular (pulo ~0,55 H): precisa de caixas
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.16 * H, 0),
      new THREE.MeshStandardMaterial({ color: GOLD, emissive: 0x6a4a00, metalness: 0.6, roughness: 0.3 }));
    star.position.set(base.x, base.y + 1.75 * H, base.z);
    star.castShadow = true;
    this._mesh(star);
    // feixe de luz até o chão, para achar a estrela
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.01 * H, 0.06 * H, 1.75 * H, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: GOLD, transparent: true, opacity: 0.18, depthWrite: false }));
    beam.position.set(base.x, base.y + 0.875 * H, base.z);
    this._mesh(beam);
    // 2 caixas de presente perto do avatar
    for (let i = 0; i < 2; i++) {
      const a = Math.atan2(base.x - p.x, base.z - p.z) + (i ? 0.9 : -0.9);
      const pr = world.spawnBox(new THREE.Vector3(p.x + Math.sin(a) * 0.9 * H, p.y + 0.4 * H, p.z + Math.cos(a) * 0.9 * H), 0.48 * H, i ? 0x3f8f3a : 0xc8372d);
      this.bodies.push({ prop: pr });
    }
    g.scoreText = () => 'Alcance a estrela';
    g.anim = (dt) => { star.rotation.y += dt * 2; star.rotation.x = Math.sin(performance.now() / 500) * 0.3; };
    g.tick = () => {
      if (star.position.distanceTo(this._center()) < 0.55 * H) this._finish(fmtS(g.t), 'até a estrela', g.t, (a, b) => a < b);
    };
  }
}
