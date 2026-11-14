// Link com o backend: envia quadros de depth+pose (binário) e o estado do jogo (JSON).
import { encodeDepthFrame } from '/shared/protocol.js';

export class Link {
  constructor(role = 'phone') {
    this.role = role;
    this.ws = null;
    this.ok = false;
    this.server = {};
    this.sentFrames = 0;
    this.onMessage = null;
    this.enabled = true;
    this.retry = 2000;
    this._connect();
  }

  _connect() {
    if (!this.enabled) return;
    const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=${this.role}`;
    let ws;
    try { ws = new WebSocket(url); } catch { setTimeout(() => this._connect(), 3000); return; }
    ws.binaryType = 'arraybuffer';
    ws.onopen = () => { this.ok = true; this.retry = 2000; };
    // sem backend (ex.: app hospedado na Vercel) tenta de novo cada vez mais devagar, até 30 s
    ws.onclose = () => { this.ok = false; this.ws = null; setTimeout(() => this._connect(), this.retry); this.retry = Math.min(30000, this.retry * 1.6); };
    ws.onerror = () => ws.close();
    ws.onmessage = (e) => {
      if (typeof e.data !== 'string') return;
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'stats' || m.t === 'hello') Object.assign(this.server, m);
      if (m.t === 'rec') this.server.recording = m.on ? m.name : null;
      this.onMessage?.(m);
    };
    this.ws = ws;
  }

  /** só envia se o canal não estiver engasgado (não acumula atraso) */
  sendDepth(frame) {
    const ws = this.ws;
    if (!this.ok || !ws || ws.bufferedAmount > 300_000) return false;
    ws.send(encodeDepthFrame(frame));
    this.sentFrames++;
    return true;
  }

  send(obj) {
    if (this.ok && this.ws && this.ws.bufferedAmount < 300_000) this.ws.send(JSON.stringify(obj));
  }
}
