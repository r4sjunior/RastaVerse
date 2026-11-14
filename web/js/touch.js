// Controles de toque na tela do celular: analógico virtual + botões.
// Alimentam o mesmo Pad do controle PS4 (dá para usar os dois juntos).
// Arrastar o dedo além da borda do analógico = sprint.
import { B } from './gamepad.js';

export class TouchControls {
  constructor(root, pad) {
    this.pad = pad;
    this.el = document.createElement('div');
    this.el.id = 'touch';
    this.el.innerHTML = `
      <div class="stick" data-stick><div class="knob"></div></div>
      <div class="pre">
        <button data-b="${B.CROSS}" class="big">Colocar aqui</button>
      </div>
      <div class="actions">
        <button data-b="${B.CROSS}" class="a-jump">Pular</button>
        <button data-b="${B.CIRCLE}" class="a-ball">Bola</button>
        <button data-b="${B.TRIANGLE}" class="a-box">Caixa</button>
        <button data-b="${B.SQUARE}" class="a-hi">Oi</button>
      </div>
      <div class="side">
        <button data-b="${B.R3}" title="Trazer o avatar para onde a câmera mira">Trazer aqui</button>
        <button data-b="${B.RIGHT}">Dançar</button>
        <button data-b="${B.L1}" aria-label="Diminuir">−</button>
        <button data-b="${B.R1}" aria-label="Aumentar">+</button>
        <button data-b="${B.OPTIONS}">Malha</button>
      </div>`;
    root.appendChild(this.el);
    // toques nos controles não devem virar "select" do WebXR
    this.el.addEventListener('beforexrselect', (e) => e.preventDefault());

    this.held = new Set();
    this.tapped = new Set();
    for (const btn of this.el.querySelectorAll('button[data-b]')) {
      const b = Number(btn.dataset.b);
      const down = (e) => { e.preventDefault(); btn.setPointerCapture?.(e.pointerId); this.held.add(b); this.tapped.add(b); btn.classList.add('on'); };
      const up = () => { this.held.delete(b); btn.classList.remove('on'); };
      btn.addEventListener('pointerdown', down);
      btn.addEventListener('pointerup', up);
      btn.addEventListener('pointercancel', up);
      btn.addEventListener('lostpointercapture', up);
    }

    // analógico
    const stick = this.el.querySelector('[data-stick]');
    const knob = stick.querySelector('.knob');
    this.x = 0; this.y = 0; this.sprint = 0;
    let id = null, cx = 0, cy = 0;
    const move = (e) => {
      const R = stick.clientWidth / 2;
      let dx = (e.clientX - cx) / R, dy = (e.clientY - cy) / R;
      const m = Math.hypot(dx, dy);
      this.sprint = m > 1.25 ? 1 : 0;
      if (m > 1) { dx /= m; dy /= m; }
      this.x = dx; this.y = dy;
      knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
      stick.classList.toggle('sprint', !!this.sprint);
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      id = e.pointerId; stick.setPointerCapture(id);
      const r = stick.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(e);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === id) move(e); });
    const release = (e) => {
      if (e.pointerId !== id) return;
      id = null; this.x = 0; this.y = 0; this.sprint = 0;
      knob.style.transform = ''; stick.classList.remove('sprint');
    };
    stick.addEventListener('pointerup', release);
    stick.addEventListener('pointercancel', release);
    stick.addEventListener('lostpointercapture', release);

    pad.extra = this; // o Pad lê daqui em poll()
  }

  /** antes de colocar: só o botão "Colocar aqui"; depois: analógico + ações */
  setPlaced(placed) { this.el.classList.toggle('placed', placed); }
  set visible(v) { this.el.hidden = !v; }
  get visible() { return !this.el.hidden; }

  /** chamado pelo Pad.poll() */
  apply(now) {
    for (const b of this.held) now[b] = 1;
    for (const b of this.tapped) now[b] = 1;
    this.tapped.clear();
  }
}
