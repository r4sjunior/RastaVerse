// DualShock 4 (PS4) via Gamepad API — mapeamento "standard" do Chrome (Android e desktop).
// Teclado como alternativa para testar no PC (simulador).

export const B = {
  CROSS: 0, CIRCLE: 1, SQUARE: 2, TRIANGLE: 3, L1: 4, R1: 5, L2: 6, R2: 7,
  SHARE: 8, OPTIONS: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, PS: 16, TOUCHPAD: 17,
};

const KEYMAP = {
  Space: B.CROSS, KeyG: B.CIRCLE, KeyE: B.SQUARE, KeyF: B.TRIANGLE, KeyQ: B.L1, KeyR: B.R1,
  KeyZ: B.L2, ShiftLeft: B.R2, ShiftRight: B.R2, KeyM: B.SHARE, KeyV: B.OPTIONS, KeyC: B.L3, KeyP: B.R3,
  ArrowUp: B.UP, ArrowDown: B.DOWN, ArrowLeft: B.LEFT, ArrowRight: B.RIGHT,
};

function deadzone(x, y, dz = 0.14) {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k, Math.min(1, m)];
}

export class Pad {
  constructor() {
    this.n = 18;
    this.now = new Array(this.n).fill(0);
    this.prev = new Array(this.n).fill(0);
    this.lx = 0; this.ly = 0; this.lm = 0; this.rx = 0; this.ry = 0; this.l2 = 0; this.r2 = 0;
    this.connected = false; this.id = ''; this.source = 'nenhum';
    this.keys = new Set();
    this.gp = null;
    this.tapped = new Set();   // toques rápidos (desce e sobe entre dois quadros) não se perdem
    addEventListener('keydown', (e) => { if (e.target.tagName !== 'INPUT') { this.keys.add(e.code); this.tapped.add(e.code); } });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', (e) => { this.id = e.gamepad.id; });
  }

  poll() {
    [this.prev, this.now] = [this.now, this.prev];
    this.now.fill(0);
    const list = navigator.getGamepads ? [...navigator.getGamepads()] : [];
    const gp = list.find((g) => g && g.connected && g.mapping === 'standard') || list.find((g) => g && g.connected);
    this.gp = gp || null;
    this.connected = !!gp;
    let lx = 0, ly = 0, rx = 0, ry = 0, l2 = 0, r2 = 0;
    if (gp) {
      this.id = gp.id; this.source = 'controle';
      lx = gp.axes[0] || 0; ly = gp.axes[1] || 0; rx = gp.axes[2] || 0; ry = gp.axes[3] || 0;
      gp.buttons.forEach((b, i) => { if (i < this.n) this.now[i] = b.value > 0.5 || b.pressed ? 1 : 0; });
      l2 = gp.buttons[B.L2]?.value || 0; r2 = gp.buttons[B.R2]?.value || 0;
    }
    // teclado
    const k = new Set([...this.keys, ...this.tapped]);
    this.tapped.clear();
    if (k.size) {
      if (!gp) this.source = 'teclado';
      const kx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      const ky = (k.has('KeyS') ? 1 : 0) - (k.has('KeyW') ? 1 : 0);
      if (kx || ky) { const m = Math.hypot(kx, ky); lx = kx / m * (k.has('AltLeft') ? 0.4 : 1); ly = ky / m * (k.has('AltLeft') ? 0.4 : 1); }
      const jx = (k.has('KeyL') ? 1 : 0) - (k.has('KeyJ') ? 1 : 0), jy = (k.has('KeyK') ? 1 : 0) - (k.has('KeyI') ? 1 : 0);
      if (jx || jy) { rx = jx; ry = jy; }
      for (const code of k) { const b = KEYMAP[code]; if (b !== undefined) this.now[b] = 1; }
      if (this.now[B.R2]) r2 = 1;
      if (this.now[B.L2]) l2 = 1;
    }
    // controles de toque na tela (touch.js): o maior analógico vence
    const t = this.extra;
    if (t) {
      t.apply(this.now);
      if (Math.hypot(t.x, t.y) > Math.hypot(lx, ly)) { lx = t.x; ly = t.y; if (!gp) this.source = 'toque'; }
      if (t.sprint) r2 = Math.max(r2, 1);
    }
    [this.lx, this.ly, this.lm] = deadzone(lx, ly);
    [this.rx, this.ry] = deadzone(rx, ry);
    this.l2 = l2; this.r2 = r2;
  }

  held(b) { return !!this.now[b]; }
  pressed(b) { return !!this.now[b] && !this.prev[b]; }
  released(b) { return !this.now[b] && !!this.prev[b]; }

  rumble(strong = 0.5, weak = 0.5, ms = 80) {
    const a = this.gp?.vibrationActuator;
    try { a?.playEffect?.('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: weak }); } catch { /* sem vibração */ }
  }
}
