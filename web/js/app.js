// RastaME MR — app do celular (WebXR immersive-ar + ARCore) e simulador de PC.
import * as THREE from 'three';
import RAPIER from '/vendor/rapier/rapier.mjs';
import { loadAvatar } from './avatar.js';
import { World } from './world.js';
import { Character } from './character.js';
import { Pad, B } from './gamepad.js';
import { Link } from './net.js';
import { TouchControls } from './touch.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
const SIM = params.has('sim');
const DANCES = ['danceBreakin', 'danceCWalk', 'danceShuffle', 'danceHype', 'danceSnoop', 'danceTechno', 'vibe'];

// ------------------------------------------------------------------ preferências
const cfg = { height: 0.25, res: 0.03 };
try { Object.assign(cfg, JSON.parse(localStorage.getItem('rastame.cfg') || '{}')); } catch { /* sem storage */ }
const saveCfg = () => { try { localStorage.setItem('rastame.cfg', JSON.stringify(cfg)); } catch { /* ok */ } };
$('#opt-height').value = String(cfg.height);
$('#opt-res').value = String(cfg.res);
$('#opt-height').onchange = (e) => { cfg.height = Number(e.target.value); saveCfg(); };
$('#opt-res').onchange = (e) => { cfg.res = Number(e.target.value); saveCfg(); };

// ------------------------------------------------------------------ tela inicial
const pad = new Pad();
const link = new Link('phone');
function setCheck(id, state, text) {
  const el = $(id); el.className = 'check ' + state; el.querySelector('em').textContent = text;
}
let xrSupported = false;
(async () => {
  if (!window.isSecureContext) {
    setCheck('#ck-xr', 'bad', 'página não é "segura" (precisa HTTPS ou a flag do Chrome — ver README)');
  } else if (!navigator.xr) {
    setCheck('#ck-xr', 'bad', 'navegador sem WebXR (use o Chrome no Android com ARCore)');
  } else {
    xrSupported = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
    setCheck('#ck-xr', xrSupported ? 'ok' : 'bad', xrSupported ? 'immersive-ar disponível' : 'immersive-ar indisponível neste aparelho');
  }
  $('#btn-ar').disabled = !xrSupported;
  if (!xrSupported) $('#why').textContent = 'Sem AR aqui — use o Simulador para testar no PC.';
})();
const startTimer = setInterval(() => {
  pad.poll();
  if (pad.connected) setCheck('#ck-pad', 'ok', pad.id.slice(0, 60));
  setCheck('#ck-srv', link.ok ? 'ok' : 'warn', link.ok ? `conectado · voxel ${(link.server.voxel || 0) * 100} cm` : 'offline (o AR funciona, mas sem nuvem de pontos no PC)');
}, 300);

$('#btn-ar').onclick = () => startAR().catch((e) => { console.error(e); $('#why').textContent = 'Falha ao iniciar AR: ' + e.message; });
$('#btn-exit').onclick = () => { if (G.session) G.session.end(); else location.href = location.pathname; };
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
  await RAPIER.init();
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  document.body.appendChild(renderer.domElement);
  document.body.classList.add('running');
  $('#start').hidden = true; $('#hud').hidden = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 50);
  scene.add(camera);
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x5a5048, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.004;
  scene.add(sun, sun.target);

  const world = new World(RAPIER, scene, { res: cfg.res });
  const avatar = await loadAvatar('./assets/avatar.json', { height: cfg.height });
  avatar.root.visible = false;
  const char = new Character(world, avatar, scene);
  char.onLand = (t) => pad.rumble(Math.min(1, t), 0.3, 90);

  Object.assign(G, { renderer, scene, camera, world, char, avatar, sun });
  buildOverlays();
  G.touch = new TouchControls($('#hud'), pad);
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
  const type = await session.requestReferenceSpace('local-floor').then(() => 'local-floor', () => 'local');
  renderer.xr.setReferenceSpaceType(type);
  await renderer.xr.setSession(session);
  G.session = session;
  G.refSpace = renderer.xr.getReferenceSpace();
  // em 'local-floor' o ARCore estima o piso em y=0: vira um chão físico de reserva
  if (type === 'local-floor') G.world.setFloor(0);
  G.depthFormat = session.depthDataFormat || null;
  G.depthUsage = session.depthUsage || null;
  const viewer = await session.requestReferenceSpace('viewer');
  G.hitCenter = await session.requestHitTestSource({ space: viewer });
  // grade de raios: amostra superfícies (planos do ARCore) mesmo sem Depth API
  G.hitGrid = [];
  for (let gy = -2; gy <= 2; gy++) {
    for (let gx = -2; gx <= 2; gx++) {
      if (!gx && !gy) continue;
      const src = await session.requestHitTestSource({ space: viewer, offsetRay: new XRRay({ x: 0, y: 0, z: 0, w: 1 }, { x: gx * 0.22, y: gy * 0.3, z: -1, w: 0 }) }).catch(() => null);
      if (src) G.hitGrid.push(src);
    }
  }
  // toque na tela (fora dos botões) coloca o avatar onde a câmera mira
  session.addEventListener('select', () => { if (!G.placed) place(); });
  session.addEventListener('end', () => location.reload());
  hint('Mova o celular devagar sobre a mesa ou o chão. Quando o alvo aparecer, toque em “Colocar aqui”');
  renderer.setAnimationLoop(onXRFrame);
}

const _m = new THREE.Matrix4();
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
        const up = new THREE.Vector3(_m.elements[4], _m.elements[5], _m.elements[6]);
        if (up.y > 0.75) G.reticleHit = new THREE.Vector3().setFromMatrixPosition(_m);
      }
    }
    // pontos de superfície da grade de hit-test (reforça o mapa)
    if ((G.frameN = (G.frameN || 0) + 1) % 3 === 0) {
      for (const src of G.hitGrid) {
        const r = frame.getHitTestResults(src)[0];
        const p = r?.getPose(ref);
        if (p) { const m = p.transform.matrix; G.world.addSurfacePoint(m[12], m[13] - 0.001, m[14], 1); }
      }
    }
    // depth do ARCore (~8 Hz local, ~5 Hz para o backend)
    if (t - G.lastDepth > 120) {
      G.lastDepth = t;
      const f = readDepth(frame, pose.views[0]);
      if (f) {
        G.depthOk = true; G.depthFrames++;
        G.world.ingestDepth(f, cfg.res >= 0.04 ? 3 : 2);
        if (t - G.lastSend > 190 && link.sendDepth(f)) G.lastSend = t;
      }
    }
  }
  tick(t);
  renderer.render(G.scene, G.camera);
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
  G.world.shadowMesh.visible = false; // o mundo simulado já recebe sombra
  G.world.occlusion = false;          // e já se oculta sozinho (no AR o fundo é a câmera)
  G.world.setFloor(0);
  hint('Simulador: mire na mesa (centro da tela) e toque em “Colocar aqui” (ou Espaço) · arraste para girar');
  const clock = new THREE.Clock();
  let lastDepth = -1;
  G.renderer.setAnimationLoop((t) => {
    sim.update();
    G.camera.updateMatrixWorld();
    G.camPos.setFromMatrixPosition(G.camera.matrixWorld);
    G.camera.getWorldDirection(G.camFwd);
    if (t - lastDepth > 250) {
      lastDepth = t;
      const f = sim.depthFrame();
      G.depthOk = true; G.depthFrames++;
      G.world.ingestDepth(f, 1);
      link.sendDepth(f);
    }
    G.reticleHit = sim.hitTest();
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
  const ret = new THREE.Mesh(new THREE.RingGeometry(0.035, 0.045, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthTest: false }));
  ret.renderOrder = 20; ret.visible = false; scene.add(ret); G.reticle = ret;
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
  world.sync(SIM ? 4000 : 1500);

  // retícula
  G.reticle.visible = !!G.reticleHit && (!G.placed || pad.held(B.R3));
  if (G.reticleHit) G.reticle.position.copy(G.reticleHit).y += 0.002;

  // eixos relativos à câmera, no plano do chão
  _fwd.copy(G.camFwd).setY(0);
  if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1);
  _fwd.normalize();
  _right.set(-_fwd.z, 0, _fwd.x);

  handleGlobalButtons();
  if (!G.placed) {
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
  if (G.toastT > 0 && (G.toastT -= dt) <= 0) $('#toast').classList.remove('show');
  if (t - G.lastHud > 300) { G.lastHud = t; updateHud(); }
  if (t - G.lastState > 100) { G.lastState = t; sendState(); }
}

function place() {
  const p = G.reticleHit;
  if (!p) { toast('Sem superfície no alvo — mova o celular devagar'); return; }
  G.char.spawn(p.clone().add(new THREE.Vector3(0, 0.01, 0)), cfg.height);
  G.avatar.root.visible = true;
  G.char.yaw = Math.atan2(G.camPos.x - p.x, G.camPos.z - p.z); // olhando para você
  G.placed = true;
  G.touch.setPlaced(true);
  G.char.playEmote('hi');
  hint('');
  pad.rumble(0.3, 0.6, 120);
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
    toast(`Altura do avatar: ${cfg.height >= 1 ? cfg.height.toFixed(2).replace('.', ',') + ' m' : Math.round(cfg.height * 100) + ' cm'}`);
  }
  if (pad.pressed(B.R3) && G.reticleHit) { G.char.spawn(G.reticleHit.clone().add(new THREE.Vector3(0, 0.01, 0)), cfg.height); toast('Avatar recolocado'); }
}

/** botões que valem mesmo antes de colocar o avatar */
function handleGlobalButtons() {
  const { world } = G;
  if (pad.pressed(B.L3) && !G.sim) { world.occlusion = !world.occlusion; toast('Oclusão ' + (world.occlusion ? 'ligada' : 'desligada')); }
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
  const active = G.placed && pad.lm > 0;
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
  if (gy !== null) {
    const h = Math.max(0, p.y - gy);
    const s = H * 0.55 * (1 + h / H * 0.6);
    blob.scale.set(s, 1, s);
    blob.position.set(p.x, gy + 0.003, p.z);
    blob.material.opacity = THREE.MathUtils.clamp(1 - h / (H * 3), 0.15, 1);
  }
}

// ------------------------------------------------------------------ HUD e rede
function chip(label, value, cls = '') { return `<span class="chip ${cls}">${label} <b>${value}</b></span>`; }
function updateHud() {
  // com o PS4 conectado os botões da tela somem (voltam se ele desconectar)
  G.touch.visible = !pad.connected;
  const s = link.server;
  $('#chips').innerHTML = [
    chip('controle', pad.connected ? 'ok' : pad.source === 'teclado' ? 'teclado' : '—', pad.connected ? 'ok' : 'warn'),
    chip('depth', G.depthOk ? `${G.depthFrames}` : (G.session ? 'só planos' : '—'), G.depthOk ? 'ok' : 'warn'),
    chip('voxels', G.world.keys.length.toLocaleString('pt-BR')),
    chip('backend', link.ok ? (s.occupied ?? 0).toLocaleString('pt-BR') : 'offline', link.ok ? 'ok' : 'bad'),
    chip('fps', Math.round(G.fps)),
    s.recording ? '<span class="chip rec">● REC</span>' : '',
  ].join('');
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

function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('show'); G.toastT = 1.8; }
function hint(msg) { $('#hint').textContent = msg; }
