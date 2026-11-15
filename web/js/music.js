// Trilha sonora: playlist "CryptoRastas Family" do Audius (https://audius.co/digitaldubs/playlist/cryptorastas-family-playlist)
// tocada direto pela API pública do Audius. A playlist é lida ao vivo: faixas novas entram sozinhas.
const API = 'https://api.audius.co/v1';
const APP = 'RastaMEMR';
const PLAYLIST_ID = 'E2p9r';
const PLAYLIST_URL = 'https://audius.co/digitaldubs/playlist/cryptorastas-family-playlist';
const VOLUME = 0.32;
// 0,1 s de silêncio: tocado DENTRO do toque do usuário, libera o <audio> no iPhone para as faixas que
// chegam depois (a lista vem da rede, e aí o gesto já passou)
const SILENCE = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';

let enabled = true;
try { enabled = localStorage.getItem('rastame.music') !== '0'; } catch { /* sem storage */ }

class Music {
  constructor() {
    this.audio = null;
    this.tracks = [];
    this.i = -1;
    this.started = false;
    this.onTrack = null;      // (titulo, artista) => void
    this.fails = 0;
    document.addEventListener('visibilitychange', () => {
      if (!this.audio) return;
      if (document.hidden) this.audio.pause(); else if (enabled && this.started) this.audio.play().catch(() => {});
    });
  }

  get enabled() { return enabled; }

  async _load() {
    if (this.tracks.length) return;
    let list = null;
    try {
      const r = await fetch(`${API}/playlists/${PLAYLIST_ID}/tracks?app_name=${APP}`);
      if (r.ok) list = (await r.json()).data;
    } catch { /* tenta pelo link */ }
    if (!list?.length) {
      try {
        const r = await fetch(`${API}/resolve?url=${encodeURIComponent(PLAYLIST_URL)}&app_name=${APP}`);
        if (r.ok) { const d = (await r.json()).data; list = (Array.isArray(d) ? d[0] : d)?.tracks; }
      } catch { /* sem internet */ }
    }
    this.tracks = (list || []).filter((t) => t.is_streamable !== false && !t.is_stream_gated)
      .map((t) => ({ id: t.id, title: t.title, artist: t.user?.name || '' }));
    for (let k = this.tracks.length - 1; k > 0; k--) { const j = (Math.random() * (k + 1)) | 0; [this.tracks[k], this.tracks[j]] = [this.tracks[j], this.tracks[k]]; }
  }

  /** chamar a partir de um toque do usuário (política de autoplay do navegador) */
  async start() {
    if (this.started || !enabled) return;
    this.started = true;
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.volume = VOLUME;
      this.audio.addEventListener('ended', () => { if (this.i >= 0) this.next(); });
      this.audio.addEventListener('error', () => { if (this.i >= 0 && ++this.fails < 5) this.next(); });
      this.audio.addEventListener('playing', () => { this.fails = 0; });
      this.audio.src = SILENCE;
      this.audio.play().catch(() => {});
    }
    await this._load();
    if (this.tracks.length) this.next();
  }

  next() {
    if (!this.tracks.length || !this.audio) return;
    this.i = (this.i + 1) % this.tracks.length;
    const t = this.tracks[this.i];
    this.audio.src = `${API}/tracks/${t.id}/stream?app_name=${APP}`;
    if (enabled) this.audio.play().catch(() => {});
    this.onTrack?.(t.title, t.artist);
  }

  toggle() {
    enabled = !enabled;
    try { localStorage.setItem('rastame.music', enabled ? '1' : '0'); } catch { /* ok */ }
    if (!enabled) this.audio?.pause();
    else if (!this.started) this.start();
    else this.audio?.play().catch(() => {});
    return enabled;
  }

  get current() { return this.tracks[this.i] || null; }
}

export const music = new Music();
