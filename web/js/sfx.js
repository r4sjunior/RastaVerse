// Efeitos sonoros sintetizados na hora (WebAudio) — sem arquivos, leves, funcionam offline.
let ctx = null;
let muted = false;
try { muted = localStorage.getItem('rastame.mute') === '1'; } catch { /* sem storage */ }

function ac() {
  if (!ctx) { const C = window.AudioContext || window.webkitAudioContext; if (!C) return null; ctx = new C(); }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function tone(freq, dur, { type = 'square', vol = 0.08, slide = 0, delay = 0 } = {}) {
  if (muted) return;
  const a = ac(); if (!a) return;
  const t = a.currentTime + delay;
  const o = a.createOscillator(), g = a.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(a.destination);
  o.start(t); o.stop(t + dur + 0.02);
}

export const sfx = {
  unlock() { ac(); },
  get muted() { return muted; },
  set muted(v) { muted = v; try { localStorage.setItem('rastame.mute', v ? '1' : '0'); } catch { /* ok */ } },
  coin() { tone(988, 0.07, { type: 'square', vol: 0.06 }); tone(1319, 0.16, { type: 'square', vol: 0.06, delay: 0.07 }); },
  gate() { tone(660, 0.1, { type: 'triangle', vol: 0.1 }); tone(990, 0.18, { type: 'triangle', vol: 0.1, delay: 0.08 }); },
  score() { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.12, { type: 'triangle', vol: 0.09, delay: i * 0.07 })); },
  pin() { tone(180, 0.12, { type: 'sawtooth', vol: 0.05, slide: -80 }); },
  jump() { tone(330, 0.12, { type: 'triangle', vol: 0.05, slide: 260 }); },
  grab() { tone(440, 0.06, { type: 'triangle', vol: 0.06 }); },
  throw() { tone(520, 0.14, { type: 'triangle', vol: 0.05, slide: -300 }); },
  climb() { tone(260, 0.09, { type: 'triangle', vol: 0.05, slide: 200 }); },
  tick() { tone(880, 0.05, { type: 'sine', vol: 0.06 }); },
  go() { tone(1320, 0.25, { type: 'sine', vol: 0.08 }); },
  fail() { tone(300, 0.25, { type: 'sawtooth', vol: 0.05, slide: -150 }); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.18, { type: 'square', vol: 0.05, delay: i * 0.1 })); },
};
