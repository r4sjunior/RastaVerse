// HUD do app (AR e simulador): status, escaneamento, joystick flutuante, botões de ação, menu,
// minigames (placar, contagem, resultado) e seta para o avatar fora da tela.
// Tudo alimenta o mesmo Pad do controle PS4 (botões virtuais): toque e PS4 funcionam juntos.
import { B } from './gamepad.js';

const ICON = {
  jump: '<svg viewBox="0 0 24 24"><path d="M12 4l7 8h-4v8H9v-8H5z"/></svg>',
  ball: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M5 9c4 1 10 1 14 0M5 15c4-1 10-1 14 0" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".5"/></svg>',
  hand: '<svg viewBox="0 0 24 24"><path d="M8 11V5.5a1.5 1.5 0 013 0V10m0-.5V4a1.5 1.5 0 013 0v6m0-1V5.5a1.5 1.5 0 013 0V14a7 7 0 01-12.5 4.3L3.3 14a1.6 1.6 0 012.5-2L8 14z"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M12 3l8 14H4z"/></svg>',
};

export const GAMES = [
  { id: 'coins', name: 'Caça às Moedas', desc: 'Pegue as 8 moedas — algumas estão no alto' },
  { id: 'race', name: 'Corrida dos Anéis', desc: 'Atravesse os 5 portais na ordem' },
  { id: 'hoops', name: 'Basquete Rasta', desc: 'Pegue a bola e acerte a cesta' },
  { id: 'bowling', name: 'Boliche', desc: 'Derrube os pinos com 2 bolas' },
  { id: 'tower', name: 'Torre da Estrela', desc: 'Empilhe caixas e alcance a estrela' },
];

export class Hud {
  constructor(root, pad, { onExit, onGame, onAction } = {}) {
    this.pad = pad;
    this.root = root;
    root.innerHTML = `
      <div class="h-top">
        <button class="h-status" data-diag><i></i><span>Iniciando…</span></button>
        <div class="h-top-r">
          <button class="h-round" data-b="${B.R3}" data-placed aria-label="Trazer o avatar para o alvo">${ICON.target}</button>
          <button class="h-round" data-menu aria-label="Menu">${ICON.menu}</button>
          <button class="h-round" data-exit aria-label="Sair">${ICON.close}</button>
        </div>
      </div>
      <div class="h-diag" hidden></div>
      <div class="h-game" hidden><b data-g-title></b><span data-g-score></span><span data-g-time></span><button data-g-stop aria-label="Encerrar minigame">✕</button></div>
      <div class="h-hint"></div>
      <div class="h-toast"></div>
      <div class="h-count" hidden></div>

      <div class="h-scan" hidden>
        <p class="h-scan-t">Escaneando o ambiente</p>
        <p class="h-scan-s" data-scan-text>Mova o celular devagar mostrando a mesa e o chão</p>
        <div class="h-bar"><i data-scan-bar></i></div>
        <div class="h-scan-row"><button class="h-scan-skip" data-scan-skip>Pular</button><button class="h-scan-done" data-scan-done disabled>Pronto</button></div>
      </div>

      <div class="h-place"><button class="h-place-btn" data-b="${B.CROSS}">Colocar aqui</button></div>

      <div class="h-joyzone" data-placed><div class="h-joy"><div class="h-knob"></div></div></div>

      <div class="h-actions" data-placed>
        <button class="h-act a-jump" data-b="${B.CROSS}" aria-label="Pular">${ICON.jump}<b>Pular</b></button>
        <button class="h-act a-ball" data-b="${B.CIRCLE}" aria-label="Bola">${ICON.ball}<b data-lbl-ball>Bola</b></button>
        <button class="h-act a-box" data-b="${B.TRIANGLE}" aria-label="Caixa">${ICON.box}<b>Caixa</b></button>
        <button class="h-act a-grab" data-b="${B.SQUARE}" aria-label="Pegar">${ICON.hand}<b data-lbl-grab>Pegar</b></button>
      </div>

      <div class="h-arrow" hidden>${ICON.arrow}</div>

      <div class="h-result" hidden>
        <div class="h-result-in">
          <p class="h-r-k" data-r-kicker>Fim de jogo</p>
          <h3 data-r-title></h3>
          <p class="h-r-big" data-r-big></p>
          <p class="h-r-sub" data-r-sub></p>
          <div class="h-r-row"><button data-r-exit>Sair</button><button class="pri" data-r-again>Jogar de novo</button></div>
        </div>
      </div>

      <div class="h-sheet" hidden>
        <div class="h-sheet-in">
          <div class="h-grab"></div>
          <p class="h-sec">Minigames</p>
          <div class="h-games">${GAMES.map((g, i) => `<button data-game="${g.id}"><b>${i + 1}. ${g.name}</b><small>${g.desc}</small><em data-best="${g.id}"></em></button>`).join('')}</div>
          <p class="h-sec">Emotes</p>
          <div class="h-row">
            <button data-act="hi" data-close>Acenar</button>
            <button data-b="${B.RIGHT}" data-close>Dançar</button>
            <button data-b="${B.UP}" data-close>Comemorar</button>
            <button data-b="${B.DOWN}" data-close>Sentar</button>
          </div>
          <p class="h-sec">Tamanho do avatar</p>
          <div class="h-size"><button data-b="${B.L1}" aria-label="Diminuir">−</button><span data-size>25 cm</span><button data-b="${B.R1}" aria-label="Aumentar">+</button></div>
          <p class="h-sec">Mundo</p>
          <div class="h-row">
            <button data-act="scan" data-close>Escanear</button>
            <button data-b="${B.OPTIONS}" data-tg="malha">Ver malha</button>
            <button data-b="${B.L3}" data-tg="oclusao">Oclusão</button>
            <button data-act="mute" data-tg="som">Som</button>
            <button data-b="${B.TOUCHPAD}" data-close>Apagar mapa</button>
            <button data-b="${B.SHARE}" data-tg="rec">Gravar</button>
          </div>
        </div>
      </div>`;
    const q = (s) => root.querySelector(s);
    // toques no HUD não viram "select" do WebXR
    root.addEventListener('beforexrselect', (e) => { if (e.target !== root) e.preventDefault(); });

    this.held = new Set(); this.tapped = new Set();
    for (const btn of root.querySelectorAll('button[data-b]')) {
      const b = Number(btn.dataset.b);
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); btn.setPointerCapture?.(e.pointerId);
        this.held.add(b); this.tapped.add(b); btn.classList.add('on'); buzz(8);
      });
      const up = () => {
        this.held.delete(b); btn.classList.remove('on');
        if (btn.hasAttribute('data-close')) this.menu(false);
      };
      btn.addEventListener('pointerup', up); btn.addEventListener('pointercancel', up); btn.addEventListener('lostpointercapture', up);
    }
    for (const btn of root.querySelectorAll('button[data-act]')) {
      btn.addEventListener('click', () => { buzz(8); onAction?.(btn.dataset.act); if (btn.hasAttribute('data-close')) this.menu(false); });
    }
    for (const btn of root.querySelectorAll('button[data-game]')) {
      btn.addEventListener('click', () => { buzz(10); this.menu(false); onGame?.(btn.dataset.game); });
    }
    q('[data-menu]').addEventListener('click', () => this.menu(q('.h-sheet').hidden));
    q('.h-sheet').addEventListener('pointerdown', (e) => { if (e.target.classList.contains('h-sheet')) this.menu(false); });
    q('[data-exit]').addEventListener('click', () => onExit?.());
    q('[data-diag]').addEventListener('click', () => { const d = q('.h-diag'); d.hidden = !d.hidden; });
    q('[data-g-stop]').addEventListener('click', () => onAction?.('stopGame'));
    q('[data-scan-done]').addEventListener('click', () => onAction?.('scanDone'));
    q('[data-scan-skip]').addEventListener('click', () => onAction?.('scanDone'));
    q('[data-r-again]').addEventListener('click', () => { this.result(null); onAction?.('again'); });
    q('[data-r-exit]').addEventListener('click', () => { this.result(null); onAction?.('stopGame'); });

    // ---------------- joystick flutuante: nasce onde o polegar encosta (metade esquerda)
    const zone = q('.h-joyzone'), joy = q('.h-joy'), knob = q('.h-knob');
    this.x = 0; this.y = 0; this.sprint = 0;
    let id = null, cx = 0, cy = 0, wasSprint = false;
    const R = () => joy.clientWidth / 2;
    const home = () => { joy.style.left = ''; joy.style.top = ''; joy.classList.remove('active', 'sprint'); knob.style.transform = ''; };
    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault(); id = e.pointerId; zone.setPointerCapture(id);
      const zr = zone.getBoundingClientRect();
      cx = e.clientX; cy = e.clientY;
      joy.style.left = `${cx - zr.left}px`; joy.style.top = `${cy - zr.top}px`;
      joy.classList.add('active'); buzz(6);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      const r = R();
      let dx = (e.clientX - cx) / r, dy = (e.clientY - cy) / r;
      const m = Math.hypot(dx, dy);
      this.sprint = m > 1.3 ? 1 : 0;
      if (this.sprint !== wasSprint) { buzz(this.sprint ? 14 : 4); wasSprint = this.sprint; }
      if (m > 1) { dx /= m; dy /= m; }
      this.x = dx; this.y = dy;
      knob.style.transform = `translate(${dx * r * 0.62}px, ${dy * r * 0.62}px)`;
      joy.classList.toggle('sprint', !!this.sprint);
    });
    const release = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.x = 0; this.y = 0; this.sprint = 0; wasSprint = false; home();
    };
    zone.addEventListener('pointerup', release); zone.addEventListener('pointercancel', release); zone.addEventListener('lostpointercapture', release);

    this.el = {
      status: q('.h-status'), statusText: q('.h-status span'), diag: q('.h-diag'), hint: q('.h-hint'),
      toast: q('.h-toast'), sheet: q('.h-sheet'), size: q('[data-size]'), arrow: q('.h-arrow'), count: q('.h-count'),
      game: q('.h-game'), gTitle: q('[data-g-title]'), gScore: q('[data-g-score]'), gTime: q('[data-g-time]'),
      scan: q('.h-scan'), scanText: q('[data-scan-text]'), scanBar: q('[data-scan-bar]'), scanDone: q('[data-scan-done]'),
      res: q('.h-result'), rKicker: q('[data-r-kicker]'), rTitle: q('[data-r-title]'), rBig: q('[data-r-big]'), rSub: q('[data-r-sub]'),
      grab: q('.a-grab'), lblGrab: q('[data-lbl-grab]'), lblBall: q('[data-lbl-ball]'),
      toggles: { malha: q('[data-tg="malha"]'), oclusao: q('[data-tg="oclusao"]'), rec: q('[data-tg="rec"]'), som: q('[data-tg="som"]') },
    };
    this.toastT = 0; this.countT = 0;
    pad.extra = this;
    root.classList.add('pre');
  }

  /** chamado pelo Pad.poll() */
  apply(now) {
    for (const b of this.held) now[b] = 1;
    for (const b of this.tapped) now[b] = 1;
    this.tapped.clear();
  }

  setPlaced(v) { this.root.classList.toggle('pre', !v); this.root.classList.toggle('placed', v); }
  set touchVisible(v) { this.root.classList.toggle('no-touch', !v); }
  menu(open) { this.el.sheet.hidden = !open; this.root.classList.toggle('menu-open', open); }

  /** state: 'search' | 'ready' | 'ok' | 'warn' */
  status(state, text) {
    if (this._st === state + text) return;
    this._st = state + text;
    this.el.status.dataset.state = state; this.el.statusText.textContent = text;
  }
  diag(html) { if (!this.el.diag.hidden) this.el.diag.innerHTML = html; }
  hint(msg) { this.el.hint.textContent = msg; this.el.hint.classList.toggle('show', !!msg); }
  toast(msg) { const t = this.el.toast; t.textContent = msg; t.classList.add('show'); this.toastT = 1.8; }
  size(text) { this.el.size.textContent = text; }
  toggles(o) { for (const k in o) this.el.toggles[k]?.classList.toggle('active', !!o[k]); }
  best(id, text) { const e = this.root.querySelector(`[data-best="${id}"]`); if (e) e.textContent = text ? 'Recorde: ' + text : ''; }

  /** botões contextuais: pegar/soltar e bola/jogar */
  context({ canGrab, holding }) {
    const k = `${canGrab}|${holding}`;
    if (this._ctx === k) return;
    this._ctx = k;
    this.el.lblGrab.textContent = holding ? 'Soltar' : 'Pegar';
    this.el.lblBall.textContent = holding ? 'Jogar' : 'Bola';
    this.el.grab.classList.toggle('glow', !!canGrab && !holding);
  }

  // ---------------- escaneamento
  scan(on, progress = 0, text = '') {
    this.el.scan.hidden = !on;
    this.root.classList.toggle('scanning', on);
    if (!on) return;
    this.el.scanBar.style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
    if (text) this.el.scanText.textContent = text;
    this.el.scanDone.disabled = progress < 0.35;
    this.el.scanDone.classList.toggle('ready', progress >= 1);
  }

  // ---------------- minigames
  game(info) {
    if (!info) { this.el.game.hidden = true; return; }
    this.el.game.hidden = false;
    this.el.gTitle.textContent = info.title;
    this.el.gScore.textContent = info.score ?? '';
    this.el.gTime.textContent = info.time ?? '';
    this.el.gTime.classList.toggle('low', !!info.low);
  }
  count(text) {
    const c = this.el.count;
    if (!text) { c.hidden = true; return; }
    c.hidden = false; c.textContent = text;
    c.classList.remove('pop'); void c.offsetWidth; c.classList.add('pop');
  }
  result(r) {
    if (!r) { this.el.res.hidden = true; return; }
    this.el.res.hidden = false;
    this.el.rKicker.textContent = r.kicker || 'Fim de jogo';
    this.el.rTitle.textContent = r.title;
    this.el.rBig.textContent = r.big;
    this.el.rSub.textContent = r.sub || '';
  }

  /** seta na borda da tela apontando para o avatar fora de vista (ndc = projeção; null esconde) */
  arrow(ndc) {
    const a = this.el.arrow;
    if (!ndc) { a.hidden = true; return; }
    let { x, y } = ndc;
    if (ndc.z > 1) { x = -x; y = -y; }       // atrás da câmera
    const ang = Math.atan2(-y, x);
    const k = 1 / Math.max(Math.abs(x), Math.abs(y), 1e-3);
    const ex = clamp(x * k, -0.86, 0.86), ey = clamp(y * k, -0.8, 0.8);
    a.hidden = false;
    a.style.left = `${(ex + 1) * 50}%`; a.style.top = `${(1 - ey) * 50}%`;
    a.style.transform = `translate(-50%, -50%) rotate(${ang + Math.PI / 2}rad)`;
  }

  tick(dt) {
    if (this.toastT > 0 && (this.toastT -= dt) <= 0) this.el.toast.classList.remove('show');
  }
}

function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function buzz(ms) { try { navigator.vibrate?.(ms); } catch { /* sem vibração */ } }
