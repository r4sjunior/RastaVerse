// HUD do app (AR e simulador): status, escaneamento, joystick flutuante, botões de ação, menu,
// minigames (placar, contagem, resultado) e seta para o avatar fora da tela.
// Tudo alimenta o mesmo Pad do controle PS4 (botões virtuais): toque e PS4 funcionam juntos.
import { B } from './gamepad.js';
import { DESTS } from './portals.js';

/** ícone de portal (anel com redemoinho) na cor do jogo de destino */
const portalIcon = (c1, c2) => `<svg viewBox="0 0 24 24"><defs><radialGradient id="pg${c1}"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#${c2.toString(16).padStart(6, '0')}"/><stop offset="1" stop-color="#${c1.toString(16).padStart(6, '0')}"/></radialGradient></defs><ellipse cx="12" cy="11" rx="7.2" ry="8.6" fill="url(#pg${c1})"/><ellipse cx="12" cy="11" rx="7.2" ry="8.6" fill="none" stroke="#${c1.toString(16).padStart(6, '0')}" stroke-width="2"/><path d="M12 6.5c2.6 0 3.4 3.4 1.2 4.6-1.6.9-3.2-.8-2-2" fill="none" stroke="#fff" stroke-width="1.3" stroke-linecap="round" opacity=".85"/><ellipse cx="12" cy="21.3" rx="6" ry="1.2" fill="#${c1.toString(16).padStart(6, '0')}" opacity=".55"/></svg>`;

const ICON = {
  jump: '<svg viewBox="0 0 24 24"><path d="M12 4l7 8h-4v8H9v-8H5z"/></svg>',
  ball: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M5 9c4 1 10 1 14 0M5 15c4-1 10-1 14 0" fill="none" stroke="currentColor" stroke-width="1.6" opacity=".55"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".5"/></svg>',
  hand: '<svg viewBox="0 0 24 24"><path d="M8 11V5.5a1.5 1.5 0 013 0V10m0-.5V4a1.5 1.5 0 013 0v6m0-1V5.5a1.5 1.5 0 013 0V14a7 7 0 01-12.5 4.3L3.3 14a1.6 1.6 0 012.5-2L8 14z"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.2" fill="currentColor"/><path d="M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M12 3l8 14H4z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 9h10a4 4 0 014 4v1.5a3.5 3.5 0 01-6.3 2.1L13.5 15h-3l-1.2 1.6A3.5 3.5 0 013 14.5V13a4 4 0 014-4z"/><path d="M7.5 11v3M6 12.5h3" stroke="#15170f" stroke-width="1.6" stroke-linecap="round"/><circle cx="16" cy="12" r="1" fill="#15170f"/><circle cx="18" cy="14" r="1" fill="#15170f"/></svg>',
  smile: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><circle cx="9" cy="10" r="1.3" fill="#15170f"/><circle cx="15" cy="10" r="1.3" fill="#15170f"/><path d="M8 14c1 2 2.4 3 4 3s3-1 4-3" fill="none" stroke="#15170f" stroke-width="1.6" stroke-linecap="round"/></svg>',
  dance: '<svg viewBox="0 0 24 24"><circle cx="12" cy="4.5" r="2.2"/><path d="M12 7l-1 6 3 3-1 5M11 13l-3 3M12 8l4-2M12 8l-4 1" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  cheer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="6" r="2.2"/><path d="M12 9v6l-2 6M12 15l2 6M12 10L7 4M12 10l5-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M5 7h14l-1.2 13H6.2zM9 4h6l1 2H8z"/></svg>',
};

/** ícones dos minigames (cartões do painel Jogos) */
const GAME_ICON = {
  coins: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="#ffd23f"/><circle cx="12" cy="12" r="5.5" fill="none" stroke="#c98a00" stroke-width="1.6"/><path d="M12 8.5v7" stroke="#c98a00" stroke-width="1.8" stroke-linecap="round"/></svg>',
  race: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="12" rx="6" ry="8.5" fill="none" stroke="#d9e27a" stroke-width="2.6"/><path d="M3 20l5-4" stroke="#fff" stroke-width="2" stroke-linecap="round"/></svg>',
  hoops: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="#ff8a3d"/><path d="M3.5 12h17M12 3.5v17M6 5.8c3 3.6 3 8.8 0 12.4M18 5.8c-3 3.6-3 8.8 0 12.4" fill="none" stroke="#7a3a12" stroke-width="1.3"/></svg>',
  bowling: '<svg viewBox="0 0 24 24"><path d="M9.5 3h5c.8 2.5-.2 4.3-.8 5.5 1.8 2 3 4.6 2.5 8.3L15.5 21h-7l-.7-4.2C7.3 13.1 8.5 10.5 10.3 8.5 9.7 7.3 8.7 5.5 9.5 3z" fill="#fafafa"/><path d="M9.6 6.6h4.8" stroke="#c8372d" stroke-width="1.6"/></svg>',
  tower: '<svg viewBox="0 0 24 24"><path d="M12 2l2.4 5 5.4.6-4 3.7 1.1 5.4L12 14l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" fill="#ffd23f"/><rect x="7" y="17" width="10" height="5" rx="1" fill="#c8372d"/></svg>',
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
      <button class="h-play" data-placed data-open-games aria-label="Abrir minigames">${ICON.play}<span>Jogos</span></button>
      <div class="h-game" hidden><b data-g-title></b><span data-g-score></span><span data-g-time></span><button data-g-stop aria-label="Encerrar minigame">✕</button></div>
      <div class="h-hint"></div>
      <div class="h-toast"></div>
      <div class="h-count" hidden></div>

      <div class="h-scan" hidden>
        <div class="h-scan-top">
          <svg class="h-radar" viewBox="0 0 100 100" aria-hidden="true"><g class="secs"><path data-sec="0" d="M50 50 L50.00 6.00 A44 44 0 0 1 72.00 11.89 Z"/><path data-sec="1" d="M50 50 L72.00 11.89 A44 44 0 0 1 88.11 28.00 Z"/><path data-sec="2" d="M50 50 L88.11 28.00 A44 44 0 0 1 94.00 50.00 Z"/><path data-sec="3" d="M50 50 L94.00 50.00 A44 44 0 0 1 88.11 72.00 Z"/><path data-sec="4" d="M50 50 L88.11 72.00 A44 44 0 0 1 72.00 88.11 Z"/><path data-sec="5" d="M50 50 L72.00 88.11 A44 44 0 0 1 50.00 94.00 Z"/><path data-sec="6" d="M50 50 L50.00 94.00 A44 44 0 0 1 28.00 88.11 Z"/><path data-sec="7" d="M50 50 L28.00 88.11 A44 44 0 0 1 11.89 72.00 Z"/><path data-sec="8" d="M50 50 L11.89 72.00 A44 44 0 0 1 6.00 50.00 Z"/><path data-sec="9" d="M50 50 L6.00 50.00 A44 44 0 0 1 11.89 28.00 Z"/><path data-sec="10" d="M50 50 L11.89 28.00 A44 44 0 0 1 28.00 11.89 Z"/><path data-sec="11" d="M50 50 L28.00 11.89 A44 44 0 0 1 50.00 6.00 Z"/></g><circle cx="50" cy="50" r="18" class="hub"/><path class="needle" data-needle d="M50 50 L50 10"/></svg>
          <div><p class="h-scan-t">Escaneie 360°</p>
          <p class="h-scan-s" data-scan-text>Gire devagar em volta de você mostrando a mesa e o chão</p></div>
        </div>
        <div class="h-bar"><i data-scan-bar></i></div>
        <div class="h-scan-row"><button class="h-scan-skip" data-scan-skip>Pular</button><button class="h-scan-done" data-scan-done disabled>Pronto</button></div>
      </div>

      <div class="h-place"><button class="h-place-btn" data-b="${B.CROSS}">Colocar aqui</button></div>

      <div class="h-joyzone" data-placed><div class="h-joy"><div class="h-knob"></div></div></div>

      <div class="h-actions" data-placed>
        <button class="h-act a-jump" data-b="${B.CROSS}" aria-label="Pular">${ICON.jump}<b>Pular</b></button>
        <button class="h-act a-ball has-radial" data-radial="obj" aria-label="Objeto (segure para mais opções)">${ICON.ball}<b data-lbl-ball>Bola</b><u></u></button>
        <button class="h-act a-box has-radial" data-radial="emote" aria-label="Emote (segure para mais opções)">${ICON.smile}<b>Emote</b><u></u></button>
        <button class="h-act a-grab" data-b="${B.SQUARE}" aria-label="Pegar">${ICON.hand}<b data-lbl-grab>Pegar</b></button>
      </div>

      <div class="h-radial" hidden></div>
      <div class="h-flash" hidden></div>
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

      <div class="h-gsheet" hidden>
        <div class="h-sheet-in">
          <div class="h-grab"></div>
          <div class="h-ghead"><b>Portais RastaVerse</b><small>Leve o avatar até um portal para entrar em outro jogo</small></div>
          <div class="h-pcards">
            <button class="h-pall" data-portal="all"><i>${portalIcon(0xd9e27a, 0x2ee6a8)}</i><span><b>Abrir os 3 portais</b><small>Entre andando no portal do jogo que quiser</small></span></button>
            <div class="h-prow">${Object.entries(DESTS).map(([id, d]) => `<button data-portal="${id}"><i>${portalIcon(d.c1, d.c2)}</i><b>${d.name}</b></button>`).join('')}</div>
          </div>
          <div class="h-ghead h-mhead"><b>Minigames</b><small>Tudo acontece na sua mesa e no seu chão de verdade</small></div>
          <div class="h-gcards">${GAMES.map((g, i) => `<button data-game="${g.id}"><i>${GAME_ICON[g.id] || ''}</i><span><b>${g.name}</b><small>${g.desc}</small><em data-best="${g.id}"></em></span></button>`).join('')}</div>
        </div>
      </div>

      <div class="h-sheet" hidden>
        <div class="h-sheet-in">
          <div class="h-grab"></div>
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
            <button data-act="music" data-tg="musica">Música</button>
            <button data-act="nextTrack">Próxima</button>
            <button data-act="mute" data-tg="som">Efeitos</button>
            <button data-b="${B.TOUCHPAD}" data-close>Apagar mapa</button>
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
      btn.addEventListener('click', () => { buzz(10); this.menu(false); this.games(false); onGame?.(btn.dataset.game); });
    }
    for (const btn of root.querySelectorAll('button[data-portal]')) {
      btn.addEventListener('click', () => { buzz(12); this.games(false); onAction?.('portal:' + btn.dataset.portal); });
    }
    q('[data-menu]').addEventListener('click', () => this.menu(q('.h-sheet').hidden));
    q('[data-open-games]').addEventListener('click', () => { buzz(10); this.games(true); });
    q('.h-gsheet').addEventListener('pointerdown', (e) => { if (e.target.classList.contains('h-gsheet')) this.games(false); });
    this._radialSetup(onAction);
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
      secs: [...root.querySelectorAll('[data-sec]')], needle: q('[data-needle]'),
      res: q('.h-result'), rKicker: q('[data-r-kicker]'), rTitle: q('[data-r-title]'), rBig: q('[data-r-big]'), rSub: q('[data-r-sub]'),
      grab: q('.a-grab'), lblGrab: q('[data-lbl-grab]'), lblBall: q('[data-lbl-ball]'),
      toggles: { malha: q('[data-tg="malha"]'), oclusao: q('[data-tg="oclusao"]'), rec: q('[data-tg="rec"]'), som: q('[data-tg="som"]'), musica: q('[data-tg="musica"]') },
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

  setPlaced(v) {
    this.root.classList.toggle('pre', !v); this.root.classList.toggle('placed', v);
    if (v && !this._playHinted) { this._playHinted = true; const b = this.root.querySelector('.h-play'); b.classList.add('pulse'); setTimeout(() => b.classList.remove('pulse'), 4200); }
  }
  games(open) { this.root.querySelector('.h-gsheet').hidden = !open; this.root.classList.toggle('menu-open', open); }

  // ---------------- leque: tocar = ação padrão; SEGURAR = 3 opções (arraste até uma e solte)
  _radialSetup(onAction) {
    const R = this.root.querySelector('.h-radial');
    const OPTS = {
      obj: [
        { label: 'Bola', icon: ICON.ball, run: () => this.tapped.add(B.CIRCLE) },
        { label: 'Caixa', icon: ICON.box, run: () => this.tapped.add(B.TRIANGLE) },
        { label: 'Limpar', icon: ICON.trash, run: () => onAction?.('clearProps') },
      ],
      emote: [
        { label: 'Acenar', icon: ICON.hand, run: () => onAction?.('hi') },
        { label: 'Dançar', icon: ICON.dance, run: () => this.tapped.add(B.RIGHT) },
        { label: 'Comemorar', icon: ICON.cheer, run: () => this.tapped.add(B.UP) },
      ],
    };
    const DEFAULT = { obj: () => this.tapped.add(B.CIRCLE), emote: () => onAction?.('hi') };
    for (const btn of this.root.querySelectorAll('[data-radial]')) {
      const kind = btn.dataset.radial;
      let timer = 0, open = false, sel = -1, id = null;
      const close = () => { R.hidden = true; R.innerHTML = ''; open = false; btn.classList.remove('on'); };
      const show = () => {
        if (kind === 'obj' && this._holding) return;       // segurando objeto: o botão só "Joga"
        open = true; buzz(18);
        const b = btn.getBoundingClientRect(), rr = this.root.getBoundingClientRect();
        const cx = b.left + b.width / 2 - rr.left, cy = b.top + b.height / 2 - rr.top;
        // coluna à esquerda do botão, subindo a partir da altura do dedo: não cobre os outros botões nem sai da tela
        const gap = 74, colX = cx - Math.max(96, b.width * 1.3);
        const minY = 120, maxY = rr.height - 48;
        let y0 = Math.min(maxY, cy);
        if (y0 - 2 * gap < minY) y0 = minY + 2 * gap;
        R.innerHTML = OPTS[kind].map((o, i) => {
          const x = colX - (i === 1 ? 10 : 0);              // leve curva
          return `<button data-i="${i}" style="left:${x}px;top:${y0 - i * gap}px">${o.icon}<b>${o.label}</b></button>`;
        }).join('');
        R.hidden = false; R.dataset.kind = kind;
      };
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault(); id = e.pointerId; btn.setPointerCapture?.(id); btn.classList.add('on'); sel = -1;
        if (R.hidden || R.dataset.kind !== kind) open = false;   // (fechado por toque fora)
        timer = setTimeout(show, 320);
      });
      btn.addEventListener('pointermove', (e) => {
        if (!open || e.pointerId !== id) return;
        const el = document.elementFromPoint(e.clientX, e.clientY)?.closest('.h-radial button');
        const i = el ? Number(el.dataset.i) : -1;
        if (i !== sel) { sel = i; buzz(6); R.querySelectorAll('button').forEach((x, n) => x.classList.toggle('sel', n === i)); }
      });
      const end = (e) => {
        if (e.pointerId !== id) return;
        clearTimeout(timer); id = null;
        if (!open) { btn.classList.remove('on'); DEFAULT[kind](); buzz(8); return; }
        btn.classList.remove('on');
        if (sel >= 0) { OPTS[kind][sel].run(); close(); }   // soltou em cima de uma opção
        // soltou sem escolher: o leque fica aberto para tocar na opção
      };
      btn.addEventListener('pointerup', end);
      btn.addEventListener('pointercancel', (e) => { clearTimeout(timer); id = null; close(); });
      // tocar direto numa opção do leque (sem arrastar)
      R.addEventListener('pointerdown', (e) => {
        const el = e.target.closest('button');
        if (!el || R.dataset.kind !== kind) return;
        e.preventDefault(); e.stopPropagation(); buzz(10);
        OPTS[kind][Number(el.dataset.i)].run(); close();
      });
      this._closeRadial = close;
    }
    // tocar fora fecha o leque
    this.root.addEventListener('pointerdown', (e) => { if (!R.hidden && !e.target.closest('.h-radial') && !e.target.closest('[data-radial]')) { R.hidden = true; R.innerHTML = ''; } }, true);
  }
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
    this._holding = !!holding;
    this.el.grab.classList.toggle('glow', !!canGrab && !holding);
  }

  // ---------------- escaneamento
  /** sectors: array de 12 booleanos (cobertos); heading: radianos da câmera; canFinish: libera "Pronto" */
  scan(on, progress = 0, text = '', sectors = null, heading = null, canFinish = false) {
    this.el.scan.hidden = !on;
    this.root.classList.toggle('scanning', on);
    if (!on) return;
    this.el.scanBar.style.width = `${Math.round(Math.min(1, progress) * 100)}%`;
    if (text) this.el.scanText.textContent = text;
    if (sectors) this.el.secs.forEach((p, i) => p.classList.toggle('on', !!sectors[i]));
    if (heading !== null) this.el.needle.setAttribute('transform', `rotate(${(heading * 180 / Math.PI).toFixed(1)} 50 50)`);
    this.el.scanDone.disabled = !canFinish;
    this.el.scanDone.classList.toggle('ready', progress >= 1);
  }

  /** clarão de tela cheia (entrada no portal) */
  flash(color = '#ffffff') {
    const f = this.root.querySelector('.h-flash');
    f.style.setProperty('--flash', color);
    f.hidden = false; f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
  }

  // ---------------- minigames
  game(info) {
    this.root.classList.toggle('in-game', !!info);
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
