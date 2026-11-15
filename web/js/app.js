// RastaME MR — app do celular (WebXR immersive-ar + ARCore) e simulador de PC.
import * as THREE from 'three';
import RAPIER from '/vendor/rapier/rapier.mjs';
import { VoxelAvatar } from './avatar.js';
import { World } from './world.js';
import { Character } from './character.js';
import { Pad, B } from './gamepad.js';
import { Link } from './net.js';
import { Hud } from './hud.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim');
const DANCES = ['danceBreakin', 'danceCWalk', 'danceShuffle', 'danceHype', 'danceSnoop', 'danceTechno', 'vibe'];

// ------------------------------------------------------------------ preferências
const cfg = { height: 0.25, res: 0.03, orient: 'landscape' };
try { Object.assign(cfg, JSON.parse(localStorage.getItem('rastame.cfg') || '{}')); } catch { /* sem storage */ }
const saveCfg = () => { try { localStorage.setItem('rastame.cfg', JSON.stringify(cfg)); } catch { /* ok */ } };
$('#opt-height').value = String(cfg.height);
$('#opt-res').value = String(cfg.res);
$('#opt-height').onchange = (e) => { cfg.height = Number(e.target.value); saveCfg(); };
$('#opt-res').onchange = (e) => { cfg.res = Number(e.target.value); saveCfg(); };
$('#opt-orient').value = cfg.orient;
$('#opt-orient').onchange = (e) => { cfg.orient = e.target.value; saveCfg(); };

/**
 * Gira para a horizontal ANTES de abrir a câmera (tela cheia + trava), para a sessão de AR já nascer
 * deitada — girar no meio da sessão deixa a imagem ruim. Espera a rotação assentar.
 */
async function prepareLandscape() {
  if (cfg.orient !== 'landscape' || !screen.orientation?.lock) return false;
  if (innerWidth > innerHeight) return true;
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    await screen.orientation.lock('landscape');
    const t0 = performance.now();
    while (innerWidth <= innerHeight && performance.now() - t0 < 900) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => setTimeout(r, 150));
    return innerWidth > innerHeight;
  } catch { return false; }
}

// ------------------------------------------------------------------ pré-carregamento
// física (WASM) e avatar já carregam enquanto a tela inicial está aberta: a câmera abre sem espera
const preload = {
  rapier: RAPIER.init(),
  avatar: fetch('./assets/avatar.json').then((r) => { if (!r.ok) throw new Error('avatar.json ' + r.status); return r.json(); }),
};
preload.avatar.catch(() => {});

// ------------------------------------------------------------------ tela inicial
const pad = new Pad();
const link = new Link('phone');
function setCheck(id, state, text) {
  const el = $(id); el.className = 'check ' + state; el.querySelector('em').textContent = text;
}
let xrSupported = false;
const btnAr = $('#btn-ar');
btnAr.disabled = true;
(async () => {
  let why = '';
  if (!window.isSecureContext) why = 'Abra pelo link https:// do app.';
  else if (!navigator.xr) why = 'Abra este link no Google Chrome do Android.';
  else {
    xrSupported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    if (!xrSupported) why = 'Este aparelho ainda não tem realidade aumentada. Instale/atualize o “Google Play Services for AR” e abra no Chrome.';
  }
  setCheck('#ck-xr', xrSupported ? 'ok' : 'bad', xrSupported ? 'pronto' : why);
  btnAr.disabled = false;
  if (!xrSupported) { setBtn('Abrir simulador'); $('#why').textContent = why; $('#cam-note').hidden = true; }
})();
const startTimer = setInterval(() => {
  pad.poll();
  if (pad.connected) setCheck('#ck-pad', 'ok', pad.id.slice(0, 60));
  setCheck('#ck-srv', link.ok ? 'ok' : 'warn', link.ok ? `conectado · voxel ${(link.server.voxel || 0) * 100} cm` : 'offline (o AR funciona, mas sem nuvem de pontos no PC)');
}, 300);

function setBtn(text) { const sp = btnAr.querySelector('span'); if (sp) sp.textContent = text; else btnAr.textContent = text; }

// painel de ajustes
const dlg = $('#settings');
$('#btn-settings')?.addEventListener('click', () => dlg.showModal());
$('#settings-close')?.addEventListener('click', () => dlg.close());
dlg?.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); });

// ------------------------------------------------------------------ avatar 3D ao vivo na tela inicial
const preview = { r: null, raf: 0 };
async function startPreview() {
  const canvas = $('#preview');
  if (!canvas || SIM) return;
  let data;
  try { data = await preload.avatar; } catch { return; }
  if (G.renderer) return; // já entrou no mundo
  const r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  r.setPixelRatio(Math.min(devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff3e0, 0x2a2e35, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.7); key.position.set(1.6, 2.4, 2.2); scene.add(key);
  const rim = new THREE.DirectionalLight(0xd9e27a, 1.6); rim.position.set(-2, 1.4, -2.2); scene.add(rim);
  const av = new VoxelAvatar(data, { height: 1, silhouette: false });
  scene.add(av.root);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20);
  cam.position.set(0, 0.6, 2.55); cam.lookAt(0, 0.5, 0);
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const seq = ['hi', 'idle', 'danceCWalk', 'idle', 'cheer', 'danceShuffle', 'vibe'];
  let si = 0, nextAt = 0;
  canvas.closest('.portal')?.classList.add('live');
  preview.r = r;
  let last = performance.now();
  const loop = (t) => {
    preview.raf = requestAnimationFrame(loop);
    if (document.hidden) return;
    const dt = Math.min(0.05, (t - last) / 1000); last = t;
    const w = canvas.clientWidth | 0;
    if (w && (canvas.width !== Math.round(w * r.getPixelRatio()))) r.setSize(w, w, false);
    if (!still && t > nextAt) { av.play(seq[si++ % seq.length], { fade: 0.3 }); nextAt = t + 3600; }
    if (!still) av.root.rotation.y = Math.sin(t / 2600) * 0.55;
    av.update(still ? 0 : dt);
    r.render(scene, cam);
  };
  preview.raf = requestAnimationFrame(loop);
}
function stopPreview() {
  cancelAnimationFrame(preview.raf);
  if (preview.r) { preview.r.dispose(); preview.r.forceContextLoss(); preview.r = null; }
}
startPreview();

btnAr.onclick = async () => {
  if (!xrSupported) { location.search = '?sim=1'; return; }
  btnAr.disabled = true; setBtn('Abrindo a câmera…');
  await prepareLandscape();
  startAR().catch((e) => {
    console.error(e);
    btnAr.disabled = false;
    const gesture = /activation|gesture|user/i.test(e.message) || e.name === 'SecurityError';
    setBtn(gesture ? 'Tocar para abrir a câmera' : 'Entrar no mundo');
    $('#why').textContent = gesture ? 'Tela pronta na horizontal. Toque de novo para abrir a câmera.'
      : /denied|permission|NotAllowed/i.test(e.name + e.message)
        ? 'Precisamos da câmera para colocar o avatar no seu mundo. Toque de novo e permita o acesso.'
        : 'Não deu para abrir a câmera: ' + e.message;
  });
};
if (SIM) startSim().catch((e) => { console.error(e); $('#why').textContent = 'Falha no simulador: ' + e.message; });

// ------------------------------------------------------------------ estado global do jogo
const G = {
  renderer: null, scene: null, camera: null, world: null, char: null, avatar: null,
  session: null, refSpace: null, sim: null,
  placed: false, reticle: null, reticleHit: null,
  camPos: new THREE.Vector3(), camFwd: new THREE.Vector3(0, 0, -1),
  depthOk: false, depthFrames: 0, lastDepth: 0, lastSend: 0, lastState: 0, lastHud: 0,
  danceIdx: 0, fps: 60, toastT: 0,
};

async function boot() {
  clearInterval(startTimer);
  stopPreview();
  if (dlg?.open) dlg.close();
  await preload.rapier;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;   // a sombra é recalculada a cada 2 quadros (ver tick)
  document.body.appendChild(renderer.domElement);
  document.body.classList.add('running');
  $('#start').hidden = true; $('#hud').hidden = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 50);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x5a5048, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(512, 512);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.004;
  scene.add(sun, sun.target);

  const world = new World(RAPIER, scene, { res: cfg.res });
  const avatar = new VoxelAvatar(await preload.avatar, { height: cfg.height });
  avatar.root.visible = false;
  const char = new Character(world, avatar, scene);
  char.onLand = (t) => pad.rumble(Math.min(1, t), 0.3, 90);

  Object.assign(G, { renderer, scene, camera, world, char, avatar, sun });
  buildOverlays();
  G.hud = new Hud($('#hud'), pad, { onExit: () => { if (G.session) G.session.end(); else location.href = location.pathname; } });
  G.hud.size(fmtSize(cfg.height));
  char.onRespawn = () => toast('Caiu onde a câmera não viu — mostre o chão para ele cair lá');
  world.onScores = onCalScores;
  avatar.setSilhouette(world.occlusion);
  addEventListener('resize', () => {
    if (renderer.xr.isPresenting) return;
    camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight);
  });
  link.onMessage = (m) => {
    if (m.t === 'rec') toast(m.on ? '● gravando sessão no backend' : 'sessão salva: ' + m.name);
  };
}

// ------------------------------------------------------------------ AR (celular)
async function startAR() {
  const hud = $('#hud');
  const session = await navigator.xr.requestSession('immersive-ar', {
    requiredFeatures: ['hit-test'],
    optionalFeatures: ['local-floor', 'depth-sensing', 'dom-overlay', 'anchors', 'light-estimation'],
    domOverlay: { root: hud },
    depthSensing: { usagePreference: ['cpu-optimized'], dataFormatPreference: ['luminance-alpha', 'float32'] },
  });
  await boot();
  const { renderer } = G;
  renderer.xr.enabled = true;
  // 80% da resolução nativa: ~36% menos pixels por quadro, diferença quase invisível na tela do celular
  renderer.xr.setFramebufferScaleFactor(0.8);
  const type = await session.requestReferenceSpace('local-floor').then(() => 'local-floor', () => 'local');
  renderer.xr.setReferenceSpaceType(type);
  await renderer.xr.setSession(session);
  G.session = session;
  G.refSpace = renderer.xr.getReferenceSpace();
  // em 'local-floor' o ARCore estima o piso em y=0: vira um chão físico de reserva
  // em 'local-floor' o y=0 é a ESTIMATIVA de chão do Chrome — só é usada depois de conferida (updateFloor)
  if (type === 'local-floor') G.floorGuess = 0;
  G.depthFormat = session.depthDataFormat || null;
  G.depthUsage = session.depthUsage || null;
  const viewer = await session.requestReferenceSpace('viewer');
  G.hitCenter = await session.requestHitTestSource({ space: viewer });
  // grade de raios: amostra superfícies (planos do ARCore) mesmo sem Depth API
  G.hitGrid = [];
  for (let gy = -1; gy <= 1; gy++) {
    for (let gx = -1; gx <= 1; gx++) {
      if (!gx && !gy) continue;
      const src = await session.requestHitTestSource({ space: viewer, offsetRay: new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: gx * 0.4, y: gy * 0.55, z: -1, w: 0 }) }).catch(() => null);
      if (src) G.hitGrid.push(src);
    }
  }
  // toque na tela (fora dos botões) coloca o avatar onde a câmera mira
  session.addEventListener('select', () => { if (!G.placed) place(); });
  session.addEventListener('end', () => { try { screen.orientation?.unlock?.(); } catch { /* ok */ } location.reload(); });
  hint('Mova o celular devagar sobre a mesa ou o chão');
  renderer.setAnimationLoop(onXRFrame);
}

const _m = new THREE.Matrix4();
const _hitPos = new THREE.Vector3();
function onXRFrame(t, frame) {
  const { renderer } = G;
  const ref = renderer.xr.getReferenceSpace();
  const pose = frame.getViewerPose(ref);
  if (pose) {
    _m.fromArray(pose.transform.matrix);
    G.camPos.setFromMatrixPosition(_m);
    G.camFwd.set(-_m.elements[8], -_m.elements[9], -_m.elements[10]).normalize();

    // alvo (retícula) no centro da tela
    const hits = frame.getHitTestResults(G.hitCenter);
    G.reticleHit = null;
    if (hits.length) {
      const p = hits[0].getPose(ref);
      if (p) {
        _m.fromArray(p.transform.matrix);
        if (_m.elements[5] > 0.75) {          // normal para cima: mesa/chão
          G.reticleHit = _hitPos.setFromMatrixPosition(_m);
          G.centerHit = hits[0];
          G.world.addPlaneHeight(_hitPos.y);
        }
      }
    }
    // âncora do ARCore: quando o rastreamento se corrige, o ponto físico onde o avatar foi colocado
    // "anda" no espaço de referência — o avatar acompanha, ficando preso à mesa de verdade
    if (G.anchor && frame.trackedAnchors?.has(G.anchor.a)) {
      const ap = frame.getPose(G.anchor.a.anchorSpace, ref);
      if (ap) {
        const m = ap.transform.matrix;
        const dx = m[12] - G.anchor.last.x, dy = m[13] - G.anchor.last.y, dz = m[14] - G.anchor.last.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > 0.002 && d < 0.15) G.char.shift(dx, dy, dz);
        G.anchor.last.set(m[12], m[13], m[14]);
      }
    }
    // pontos de superfície da grade de hit-test (reforça o mapa)
    if ((G.frameN = (G.frameN || 0) + 1) % 4 === 0) {
      for (const src of G.hitGrid) {
        const r = frame.getHitTestResults(src)[0];
        const p = r?.getPose(ref);
        // só superfícies horizontais (mesa, chão); paredes ficam por conta do depth
        if (p && p.transform.matrix[5] > 0.9) { const m = p.transform.matrix; G.world.addSurfacePoint(m[12], m[13], m[14]); }
      }
      G.world.flushSurface();
    }
    // depth do ARCore (~8 Hz local, ~5 Hz para o backend)
    if (t - G.lastDepth > 140) {
      G.lastDepth = t;
      const f = !G.world.busy && readDepth(frame, pose.views[0]);
      if (f) {
        f.flipY = G.world.flipY;
        if (cal.done && t - G.lastSend > 190 && link.sendDepth(f)) G.lastSend = t;   // antes: o buffer vai para o worker
        const r = G.reticleHit;
        const calib = !cal.done && r ? { x: r.x, y: r.y, z: r.z } : null;
        if (G.world.ingestDepth(f, cfg.res >= 0.04 ? 3 : 2, { ingest: cal.done, calib })) {
          if (cal.done) { G.depthOk = true; G.depthFrames++; } else if (++cal.tries > 120) finishCal();
        }
      }
    }
  }
  tick(t);
  renderer.render(G.scene, G.camera);
}

// A convenção vertical do depth pode variar entre aparelhos/versões do Chrome. Antes de usar o depth,
// compara as duas hipóteses contra o plano do hit-test (verdade do ARCore) por alguns quadros.
// (a conta roda no worker; aqui só os votos)
const cal = { done: false, a: 0, b: 0, n: 0, tries: 0 };
function onCalScores([ea, eb]) {
  if (cal.done || !(Number.isFinite(ea) || Number.isFinite(eb))) return;
  cal.n++;
  // só conta voto para "invertido" com evidência forte (erro bem menor e o normal claramente ruim)
  if (eb < ea * 0.4 && ea > 0.04) cal.b++; else cal.a++;
  G.calErr = [ea, eb];
  if (cal.n >= 8) finishCal();
}
function finishCal() {
  if (cal.done) return;
  cal.done = true;
  G.world.flipY = cal.b >= 6;             // padrão: orientação normal (a que funcionou no 1º teste)
  console.info('[depth] orientação', G.world.flipY ? 'invertida' : 'normal', cal, G.calErr);
}

let depthSeq = 0;
function readDepth(frame, view) {
  if (!frame.getDepthInformation || G.depthUsage === 'gpu-optimized') return null;
  let di;
  try { di = frame.getDepthInformation(view); } catch { return null; }
  if (!di || !di.data || !di.width) return null;
  const isF32 = G.depthFormat === 'float32';
  const data = isF32 ? new Float32Array(di.data.slice(0)) : new Uint16Array(di.data.slice(0));
  return {
    seq: depthSeq++, timestamp: performance.now(), width: di.width, height: di.height, data,
    rawValueToMeters: di.rawValueToMeters,
    worldFromView: Float32Array.from(di.transform?.matrix || view.transform.matrix),
    projection: Float32Array.from(di.projectionMatrix || view.projectionMatrix),
    normDepthFromNormView: Float32Array.from(di.normDepthBufferFromNormView.matrix),
  };
}

// ------------------------------------------------------------------ simulador (PC)
async function startSim() {
  await boot();
  const { Sim } = await import('./sim.js');
  const sim = new Sim(G.scene, G.camera, G.renderer.domElement);
  G.sim = sim;
  addEventListener('resize', () => sim.update());
  G.world.occlusion = false;          // e já se oculta sozinho (no AR o fundo é a câmera)
  G.floorGuess = params.has('floorGuess') ? Number(params.get('floorGuess')) : 0;
  hint('Simulador: mire na mesa e toque em “Colocar aqui” (ou Espaço) · arraste para girar a câmera');
  const clock = new THREE.Clock();
  let lastDepth = -1;
  // ?noise=0.04 simula depth ruidoso de aparelho real (fração da distância)
  const simNoise = Number(params.get('noise') || 0.004);
  G.renderer.setAnimationLoop((t) => {
    sim.update();
    G.camera.updateMatrixWorld();
    G.camPos.setFromMatrixPosition(G.camera.matrixWorld);
    G.camera.getWorldDirection(G.camFwd);
    if (t - lastDepth > 250) {
      lastDepth = t;
      for (const p of sim.hitGrid()) G.world.addSurfacePoint(p.x, p.y, p.z);
      G.world.flushSurface();
      if (!G.world.busy) {
        const f = sim.depthFrame(simNoise);
        link.sendDepth(f);
        if (G.world.ingestDepth(f, 1)) { G.depthOk = true; G.depthFrames++; }
      }
    }
    G.reticleHit = sim.hitTest();
    if (G.reticleHit) G.world.addPlaneHeight(G.reticleHit.y);
    sim.orbit(pad.rx, pad.ry, Math.min(clock.getDelta(), 0.05));
    tick(t);
    G.renderer.render(G.scene, G.camera);
  });
  window.__rastame = G; // para testes automatizados
}

// ------------------------------------------------------------------ overlays 3D
function buildOverlays() {
  const { scene } = G;
  const accent = 0xd9e27a;
  // retícula
  const retMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.95, depthTest: false });
  const ret = new THREE.Group();
  ret.add(new THREE.Mesh(new THREE.RingGeometry(0.04, 0.048, 48).rotateX(-Math.PI / 2), retMat));
  ret.add(new THREE.Mesh(new THREE.CircleGeometry(0.006, 16).rotateX(-Math.PI / 2), retMat));
  ret.children.forEach((m) => { m.renderOrder = 20; });
  ret.visible = false; scene.add(ret); G.reticle = ret; G.reticleMat = retMat;
  G.retSmooth = new THREE.Vector3(); G.retHist = []; G.retPool = Array.from({ length: 12 }, () => new THREE.Vector3()); G.retIdx = 0;
  // anéis do analógico (como no vídeo): faixa grande = alcance, anel pequeno = posição do stick
  const ringMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35, depthWrite: false });
  const knobMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.9, depthWrite: false });
  const stick = new THREE.Group();
  const R = 0.09;
  stick.add(new THREE.Mesh(new THREE.RingGeometry(R * 0.92, R, 64).rotateX(-Math.PI / 2), ringMat));
  const knob = new THREE.Mesh(new THREE.RingGeometry(R * 0.2, R * 0.33, 40).rotateX(-Math.PI / 2), knobMat);
  stick.add(knob);
  stick.renderOrder = 15; stick.visible = false;
  scene.add(stick);
  G.stick = { group: stick, knob, R, mats: [ringMat, knobMat], alpha: 0, center: new THREE.Vector3() };
  // rastro do avatar
  const N = 600;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  trailGeo.setDrawRange(0, 0);
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
  trail.frustumCulled = false; scene.add(trail);
  G.trail = { line: trail, n: 0, N, last: new THREE.Vector3(1e9, 0, 0) };
  // sombra de contato (complementa a sombra projetada nos voxels)
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  blob.renderOrder = 6; blob.visible = false; scene.add(blob); G.blob = blob;
  // apanhador de sombra: disco invisível que só mostra a sombra projetada do avatar/objetos
  const catcher = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2),
    new THREE.ShadowMaterial({ opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  catcher.receiveShadow = true; catcher.renderOrder = 7; catcher.visible = false;
  scene.add(catcher); G.catcher = catcher;
}

// ------------------------------------------------------------------ loop do jogo (AR e simulador)
let lastT = 0;
const _fwd = new THREE.Vector3(), _right = new THREE.Vector3(), _move = new THREE.Vector3();
function tick(t) {
  const dt = Math.min(0.05, lastT ? (t - lastT) / 1000 : 0.016);
  lastT = t;
  G.fps += ((dt > 0 ? 1 / dt : 60) - G.fps) * 0.05;
  pad.poll();
  const { world, char } = G;
  world.sync(SIM ? 600 : 120);
  if ((G.shadowN = (G.shadowN || 0) + 1) % 2 === 0) G.renderer.shadowMap.needsUpdate = true;

  updateReticle(dt);

  // eixos relativos à câmera, no plano do chão
  _fwd.copy(G.camFwd).setY(0);
  if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
  _fwd.normalize();
  _right.set(-_fwd.z, 0, _fwd.x);

  handleGlobalButtons();
  if (!G.placed) {
    updatePreview(dt);
    if (pad.pressed(B.CROSS)) place();
  } else {
    handleButtons();
    _move.set(0, 0, 0).addScaledVector(_right, pad.lx).addScaledVector(_fwd, -pad.ly);
    char.update(dt, { move: _move, mag: pad.lm, sprint: pad.r2, walk: pad.held(B.L2), jump: pad.pressed(B.CROSS) });
  }
  world.step(dt);
  updateStick(dt);
  updateTrail();
  updateShadows();
  G.hud.tick(dt);
  updateArrow();
  if (G.placed && (G.floorT = (G.floorT || 0) + dt) > 1) {
    G.floorT = 0;
    updateFloor();
  }
  if (t - G.lastHud > 300) { G.lastHud = t; updateHud(); }
  if (t - G.lastState > 100) { G.lastState = t; sendState(); }
}

function place() {
  if (!G.reticleHit) { toast('Mire numa mesa ou no chão'); return; }
  const p = G.retSmooth.clone();
  spawnAt(p);
  G.avatar.setGhost(false);
  G.avatar.root.visible = true;
  G.char.yaw = Math.atan2(G.camPos.x - p.x, G.camPos.z - p.z); // olhando para você
  G.placed = true; G.placeY = p.y; G.placeCamH = G.camPos.y - p.y;
  updateFloor();
  G.hud.setPlaced(true);
  G.reticle.visible = false;
  G.char.playEmote('hi');
  hint('');
  pad.rumble(0.3, 0.6, 120);
  anchorAt(p);
}

/**
 * Chão físico "infinito" de reserva (cobre o chão que a câmera ainda não mapeou), escolhido com cuidado:
 *  1) chão real: plano do ARCore pelo menos 30 cm abaixo de onde o avatar está;
 *  2) avatar colocado no próprio chão (celular a mais de 90 cm acima da superfície): o chão é essa superfície;
 *  3) estimativa 'local-floor' do Chrome, SÓ se estiver 30 cm abaixo da mesa — o Chrome às vezes estima o
 *     chão na altura da mesa (quando só a mesa foi vista), e aí o avatar andava no ar em vez de cair.
 *  Sem nada disso: sem chão de reserva — ele cai de verdade e cai nos voxels do chão mapeado pelo depth.
 */
function updateFloor() {
  const w = G.world;
  if (!G.placed || w.floorFromPlanes(G.placeY)) return;
  let y = null;
  if (G.placeCamH > 0.9) y = G.placeY;
  else if (G.floorGuess !== undefined && G.placeY - G.floorGuess >= 0.3) y = G.floorGuess;
  if (y === null) { if (w.floor) w.removeFloor(); }
  else if (w.floorSource !== 'guess' || Math.abs(w.floorY - y) > 0.01) w.setFloor(y, 'guess');
}

/** cria uma âncora do ARCore no ponto (o avatar fica preso ao lugar físico mesmo com correções do rastreamento) */
function anchorAt(p) {
  G.anchor?.a.delete?.();
  G.anchor = null;
  const hit = G.centerHit;
  if (!G.session || !hit?.createAnchor) return;
  hit.createAnchor().then((a) => { G.anchor = { a, last: p.clone() }; }).catch(() => { /* sem anchors: segue sem */ });
}

/** retícula suavizada; "estável" quando o alvo parou de tremer (melhor hora de colocar) */
function updateReticle(dt) {
  const r = G.reticleHit, show = !!r && (!G.placed || pad.held(B.R3));
  G.reticle.visible = show;
  if (!r) { G.retHist.length = 0; G.retStable = false; return; }
  if (G.retHist.length === 0 || G.retSmooth.distanceTo(r) > 0.25) G.retSmooth.copy(r);
  else G.retSmooth.lerp(r, Math.min(1, dt * 14));
  const slot = G.retPool[G.retIdx++ % 12].copy(r);
  if (G.retHist.length < 12) G.retHist.push(slot);
  let spread = 0;
  for (const h of G.retHist) spread = Math.max(spread, h.distanceTo(G.retSmooth));
  G.retStable = G.retHist.length >= 8 && spread < 0.012;
  G.reticle.position.copy(G.retSmooth).y += 0.002;
  G.reticleMat.color.set(G.retStable ? 0xd9e27a : 0xffffff);
  const s = 1 + Math.sin(performance.now() / 180) * (G.retStable ? 0 : 0.06);
  G.reticle.scale.setScalar(s * Math.max(0.6, cfg.height / 0.25));
}

/** prévia translúcida do avatar no alvo antes de colocar: você vê exatamente onde e o tamanho */
const _up = new THREE.Vector3(0, 1, 0);
function updatePreview(dt) {
  const a = G.avatar;
  if (!G.reticleHit) { a.root.visible = false; return; }
  a.setGhost(true);
  a.root.visible = true;
  a.root.position.copy(G.retSmooth);
  a.root.quaternion.setFromAxisAngle(_up, Math.atan2(G.camPos.x - G.retSmooth.x, G.camPos.z - G.retSmooth.z));
  a.update(dt);
}

/** seta na borda quando o avatar sai da tela */
const _proj = new THREE.Vector3();
function updateArrow() {
  if (!G.placed) { G.hud.arrow(null); return; }
  _proj.copy(G.char.position).y += G.char.height * 0.5;
  _proj.project(G.camera);
  const off = _proj.z > 1 || Math.abs(_proj.x) > 0.95 || Math.abs(_proj.y) > 0.95;
  G.hud.arrow(off ? { x: _proj.x, y: _proj.y, z: _proj.z } : null);
}

function fmtSize(h) { return h >= 1 ? h.toFixed(2).replace('.', ',') + ' m' : Math.round(h * 100) + ' cm'; }

/** nasce sempre EM CIMA do que existir no ponto (plano do ARCore ou voxels), nunca dentro */
function spawnAt(p) {
  const H = cfg.height;
  const from = p.y + Math.max(0.3, H);
  const exclude = G.char.collider || null;
  const top = G.world.groundBelow(p.x, from, p.z, from - p.y + 0.1, exclude);
  // aceita a superfície encontrada se for coerente com o plano (ruído/objeto baixo); senão fica no plano
  const y = top !== null && top > p.y - 0.03 && top < p.y + 0.03 ? Math.max(top, p.y) : p.y;
  G.char.spawn(new THREE.Vector3(p.x, y + 0.01, p.z), H);
}

function handleButtons() {
  const { char, world } = G;
  const H = char.height;
  if (pad.pressed(B.SQUARE)) char.playEmote(char.emote === 'hi' ? 'wave' : 'hi');
  if (pad.pressed(B.UP)) char.playEmote('cheer');
  if (pad.pressed(B.DOWN)) char.playEmote('sitIdle', true);
  if (pad.pressed(B.LEFT)) char.playEmote('clap');
  if (pad.pressed(B.RIGHT)) { const d = DANCES[G.danceIdx++ % DANCES.length]; char.playEmote(d, true); toast('♪ ' + d.replace('dance', '')); }
  if (pad.pressed(B.TRIANGLE)) {
    const f = new THREE.Vector3(Math.sin(char.yaw), 0, Math.cos(char.yaw));
    world.spawnBox(char.position.clone().addScaledVector(f, H * 0.7).add(new THREE.Vector3(0, H * 1.4, 0)), Math.max(0.03, H * 0.32));
  }
  if (pad.pressed(B.CIRCLE)) throwBall();
  if (pad.pressed(B.L1) || pad.pressed(B.R1)) {
    const k = pad.pressed(B.R1) ? 1.25 : 0.8;
    cfg.height = Math.round(THREE.MathUtils.clamp(char.height * k, 0.06, 2.0) * 100) / 100;
    char.resize(cfg.height); saveCfg();
    G.hud.size(fmtSize(cfg.height));
    toast('Altura: ' + fmtSize(cfg.height));
  }
  if (pad.pressed(B.R3)) {
    if (G.reticleHit) {
      const p = G.retSmooth.clone(); spawnAt(p); G.placeY = p.y; G.placeCamH = G.camPos.y - p.y; anchorAt(p); updateFloor();
      toast('Avatar trazido para o alvo');
    }
    else toast('Mire numa superfície para trazer o avatar');
  }
}

/** botões que valem mesmo antes de colocar o avatar */
function handleGlobalButtons() {
  const { world } = G;
  if (pad.pressed(B.L3) && !G.sim) {
    world.occlusion = !world.occlusion; G.avatar.setSilhouette(world.occlusion);
    toast('Oclusão ' + (world.occlusion ? 'ligada' : 'desligada'));
  }
  if (pad.pressed(B.OPTIONS)) { world.debug = !world.debug; toast(world.debug ? 'Malha de voxels visível' : 'Malha de voxels oculta'); }
  if (pad.pressed(B.SHARE)) {
    if (!link.ok) toast('Backend offline — não dá para gravar');
    else link.send({ t: 'record', on: !link.server.recording });
  }
  if (pad.pressed(B.TOUCHPAD)) { world.clear(); link.send({ t: 'clear' }); toast('Mapa apagado'); }
}

function throwBall() {
  const dir = G.camFwd.clone();
  const from = G.camPos.clone().addScaledVector(dir, 0.12);
  const v = dir.multiplyScalar(4.5).add(new THREE.Vector3(0, 0.8, 0));
  G.world.spawnBall(from, v);
  pad.rumble(0.1, 0.4, 50);
}

function updateStick(dt) {
  const s = G.stick;
  const active = G.placed && pad.lm > 0 && pad.connected;
  s.alpha += ((active ? 1 : 0) - s.alpha) * Math.min(1, dt * (active ? 12 : 3));
  s.group.visible = s.alpha > 0.02;
  if (!s.group.visible) return;
  // fica no plano do chão do avatar, ~30 cm à frente da câmera (onde está o controle)
  const gy = G.char.grounded ? G.char.position.y : (G.char.lastSafe.y);
  s.center.copy(G.camPos).addScaledVector(_fwd, 0.3).setY(gy + 0.004);
  s.group.position.lerp(s.center, s.alpha < 0.1 ? 1 : Math.min(1, dt * 10));
  s.group.rotation.y = Math.atan2(-_fwd.x, -_fwd.z);
  s.knob.position.set(pad.lx * s.R * 0.85, 0.001, pad.ly * s.R * 0.85);
  s.mats[0].opacity = 0.35 * s.alpha; s.mats[1].opacity = 0.9 * s.alpha;
}

function updateTrail() {
  if (!G.placed) return;
  const tr = G.trail, p = G.char.position;
  if (tr.last.distanceToSquared(p) < (0.04 * G.char.height) ** 2) return;
  tr.last.copy(p);
  const a = tr.line.geometry.attributes.position;
  if (tr.n >= tr.N) { a.array.copyWithin(0, 3); tr.n = tr.N - 1; }
  a.setXYZ(tr.n++, p.x, p.y + 0.003, p.z);
  a.needsUpdate = true;
  tr.line.geometry.setDrawRange(0, tr.n);
}

function updateShadows() {
  if (!G.placed) return;
  const { sun, char, world, blob } = G;
  const p = char.position, H = char.height;
  sun.position.set(p.x + H * 1.2, p.y + H * 4, p.z + H * 0.8);
  sun.target.position.copy(p);
  const cam = sun.shadow.camera, e = Math.max(0.3, H * 3);
  if (cam.right !== e) { cam.left = -e; cam.right = e; cam.top = e; cam.bottom = -e; cam.near = 0.01; cam.far = H * 10 + 1; cam.updateProjectionMatrix(); }
  const gy = world.groundBelow(p.x, p.y + H * 0.2, p.z, 4, char.collider);
  blob.visible = gy !== null;
  G.catcher.visible = gy !== null && !G.sim;
  if (gy !== null) {
    const h = Math.max(0, p.y - gy);
    const s = H * 0.55 * (1 + h / H * 0.6);
    blob.scale.set(s, 1, s);
    blob.position.set(p.x, gy + 0.003, p.z);
    G.catcher.position.set(p.x, gy + 0.002, p.z);
    G.catcher.scale.setScalar(Math.max(0.25, H * 3));
    blob.material.opacity = THREE.MathUtils.clamp(1 - h / (H * 3), 0.15, 1);
  }
}

// ------------------------------------------------------------------ HUD e rede
function chip(label, value, cls = '') { return `<span class="chip ${cls}">${label} <b>${value}</b></span>`; }
function updateHud() {
  const { hud, world } = G;
  // com o PS4 conectado o joystick/botões da tela somem (voltam se ele desconectar)
  hud.touchVisible = !pad.connected;
  if (!G.placed) {
    if (!G.reticleHit) hud.status('search', 'Procurando superfície…');
    else hud.status('ready', G.retStable ? 'Pronto — toque em Colocar aqui' : 'Segure firme um instante');
  } else hud.status(G.fps < 24 ? 'warn' : 'ok', G.char.state === 'air' ? 'No ar' : 'No mundo');
  hud.toggles({ malha: world.debug, oclusao: world.occlusion, rec: !!link.server.recording });
  const s = link.server;
  hud.diag([
    chip('controle', pad.connected ? 'ok' : pad.source === 'teclado' ? 'teclado' : '—', pad.connected ? 'ok' : 'warn'),
    chip('depth', G.depthOk ? `${G.depthFrames}${G.world.flipY ? ' ↕' : ''}` : (G.session ? (cal.tries && !cal.done ? 'calibrando' : 'só planos') : '—'), G.depthOk ? 'ok' : 'warn'),
    chip('voxels', G.world.keys.length.toLocaleString('pt-BR')),
    chip('backend', link.ok ? (s.occupied ?? 0).toLocaleString('pt-BR') : 'offline', link.ok ? 'ok' : 'bad'),
    chip('fps', Math.round(G.fps)),
    s.recording ? '<span class="chip rec">● REC</span>' : '',
  ].join(''));
}

function sendState() {
  if (!link.ok) return;
  const c = G.char;
  link.send({
    t: 'state',
    cam: G.camera.matrixWorld.elements.map((v) => +v.toFixed(4)),
    camPos: G.camPos.toArray().map((v) => +v.toFixed(4)),
    avatar: G.placed ? { p: c.position.toArray().map((v) => +v.toFixed(4)), yaw: +c.yaw.toFixed(3), anim: G.avatar.current?.name, h: c.height } : null,
    props: G.world.props.map((p) => {
      const t = p.body.translation(), q = p.body.rotation();
      return { k: p.kind, s: p.size, p: [t.x, t.y, t.z].map((v) => +v.toFixed(4)), q: [q.x, q.y, q.z, q.w].map((v) => +v.toFixed(4)) };
    }),
  });
}

function toast(msg) { G.hud?.toast(msg); }
function hint(msg) { G.hud?.hint(msg); }
