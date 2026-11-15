// Visualizador do PC: recebe do backend os deltas do mapa de voxels (nuvem de pontos fundida),
// a pose da câmera do celular (SLAM) e o estado do jogo (avatar e objetos), em tempo real.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { loadAvatar } from './avatar.js';

const $ = (s) => document.querySelector(s);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111317);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.01, 200);
camera.position.set(1.6, 1.8, 2.0);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.6, 0); controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.4));
const dl = new THREE.DirectionalLight(0xffffff, 1.4); dl.position.set(2, 5, 3); scene.add(dl);
const grid = new THREE.GridHelper(10, 50, 0x2c3038, 0x1f2228); scene.add(grid);
scene.add(new THREE.AxesHelper(0.25));

// ------------------------------------------------------------ voxels (cubos instanciados ou pontos)
let RES = 0.02;
const CAP0 = 50000;
const state = { keys: new Map(), list: [], cap: CAP0, minY: Infinity, maxY: -Infinity };
let cubes, points;
const color = new THREE.Color(), mtx = new THREE.Matrix4();
function makeBuffers(cap) {
  if (cubes) { scene.remove(cubes); cubes.geometry.dispose(); }
  if (points) { scene.remove(points); points.geometry.dispose(); }
  cubes = new THREE.InstancedMesh(new THREE.BoxGeometry(RES, RES, RES), new THREE.MeshLambertMaterial(), cap);
  cubes.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3);
  cubes.count = 0; cubes.frustumCulled = false;
  const pg = new THREE.BufferGeometry();
  pg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
  pg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(cap * 3), 3));
  pg.setDrawRange(0, 0);
  points = new THREE.Points(pg, new THREE.PointsMaterial({ size: RES * 1.1, vertexColors: true, sizeAttenuation: true }));
  points.frustumCulled = false;
  points.visible = viewMode === 'pontos'; cubes.visible = !points.visible;
  scene.add(cubes, points);
}
let viewMode = 'pontos';
makeBuffers(CAP0);

function heightColor(y) {
  const t = state.maxY > state.minY ? (y - state.minY) / (state.maxY - state.minY) : 0.5;
  return color.setHSL(0.66 - 0.66 * THREE.MathUtils.clamp(t, 0, 1), 0.75, 0.55);
}
function writeSlot(idx, i, j, k) {
  const x = (i + 0.5) * RES, y = (j + 0.5) * RES, z = (k + 0.5) * RES;
  mtx.makeTranslation(x, y, z); cubes.setMatrixAt(idx, mtx);
  heightColor(y);
  cubes.setColorAt(idx, color);
  points.geometry.attributes.position.setXYZ(idx, x, y, z);
  points.geometry.attributes.color.setXYZ(idx, color.r, color.g, color.b);
}
function grow() {
  const old = state.list.slice();
  state.cap *= 2; makeBuffers(state.cap);
  old.forEach((v, idx) => writeSlot(idx, v[0], v[1], v[2]));
}
function addVoxel(i, j, k) {
  const key = `${i},${j},${k}`;
  if (state.keys.has(key)) return;
  if (state.list.length >= state.cap) grow();
  const y = (j + 0.5) * RES;
  let recolor = false;
  if (y < state.minY) { state.minY = y; recolor = true; }
  if (y > state.maxY) { state.maxY = y; recolor = true; }
  const idx = state.list.length;
  state.keys.set(key, idx); state.list.push([i, j, k]);
  writeSlot(idx, i, j, k);
  if (recolor) needsRecolor = true;
}
function removeVoxel(i, j, k) {
  const key = `${i},${j},${k}`;
  const idx = state.keys.get(key);
  if (idx === undefined) return;
  const last = state.list.length - 1;
  if (idx !== last) {
    const v = state.list[last];
    state.list[idx] = v; state.keys.set(`${v[0]},${v[1]},${v[2]}`, idx);
    writeSlot(idx, v[0], v[1], v[2]);
  }
  state.list.pop(); state.keys.delete(key);
}
let needsRecolor = false;
function commit() {
  if (needsRecolor) { state.list.forEach((v, idx) => writeSlot(idx, v[0], v[1], v[2])); needsRecolor = false; }
  cubes.count = state.list.length;
  cubes.instanceMatrix.needsUpdate = true; cubes.instanceColor.needsUpdate = true;
  points.geometry.setDrawRange(0, state.list.length);
  points.geometry.attributes.position.needsUpdate = true; points.geometry.attributes.color.needsUpdate = true;
}
function resetMap() { state.keys.clear(); state.list.length = 0; state.minY = Infinity; state.maxY = -Infinity; commit(); traj.n = 0; traj.line.geometry.setDrawRange(0, 0); }

function onDelta(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x31564d52) return;
  const res = dv.getFloat32(4, true);
  if (Math.abs(res - RES) > 1e-6) { RES = res; resetMap(); makeBuffers(state.cap); }
  const na = dv.getUint32(8, true), nr = dv.getUint32(12, true);
  const ints = new Int32Array(buf, 16, (na + nr) * 3);
  for (let n = 0; n < na; n++) addVoxel(ints[n * 3], ints[n * 3 + 1], ints[n * 3 + 2]);
  for (let n = na; n < na + nr; n++) removeVoxel(ints[n * 3], ints[n * 3 + 1], ints[n * 3 + 2]);
  commit();
}

// ------------------------------------------------------------ trajetória e câmera do celular
const TN = 20000;
const traj = { n: 0, line: new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5 })) };
traj.line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TN * 3), 3));
traj.line.geometry.setDrawRange(0, 0); traj.line.frustumCulled = false; scene.add(traj.line);
function trajPush(x, y, z) {
  const a = traj.line.geometry.attributes.position;
  if (traj.n >= TN) { a.array.copyWithin(0, 3 * 1000); traj.n -= 1000; }
  a.setXYZ(traj.n++, x, y, z); a.needsUpdate = true; traj.line.geometry.setDrawRange(0, traj.n);
}
const phoneCam = new THREE.PerspectiveCamera(50, 9 / 16, 0.03, 0.12);
const phoneHelper = new THREE.CameraHelper(phoneCam);
phoneHelper.setColors(new THREE.Color(0xd9e27a), new THREE.Color(0xd9e27a), new THREE.Color(0xd9e27a), new THREE.Color(0xd9e27a), new THREE.Color(0xd9e27a));
phoneCam.matrixAutoUpdate = false;
scene.add(phoneCam, phoneHelper);
let follow = true;
const camPos = new THREE.Vector3();

// ------------------------------------------------------------ avatar e objetos (espelho do celular)
let avatar = null;
loadAvatar('./assets/avatar.json', { height: 0.25, silhouette: false }).then((a) => { avatar = a; a.root.visible = false; scene.add(a.root); }).catch(console.warn);
const propMeshes = [];
const boxGeo = new THREE.BoxGeometry(1, 1, 1), ballGeo = new THREE.SphereGeometry(1, 16, 12);
const propMat = { box: new THREE.MeshStandardMaterial({ color: 0xd9e27a }), ball: new THREE.MeshStandardMaterial({ color: 0xe8ff6a }) };
const avatarTrail = { n: 0, last: new THREE.Vector3(1e9, 0, 0), line: new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xd9e27a })) };
avatarTrail.line.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3000 * 3), 3));
avatarTrail.line.frustumCulled = false; scene.add(avatarTrail.line);

function onState(s) {
  if (s.avatar && avatar) {
    const a = s.avatar;
    avatar.root.visible = true;
    if (Math.abs(avatar.height - a.h) > 1e-3) avatar.setHeight(a.h);
    avatar.root.position.fromArray(a.p);
    avatar.root.rotation.y = a.yaw;
    if (a.anim) avatar.play(a.anim);
    if (avatarTrail.last.distanceTo(avatar.root.position) > 0.01 && avatarTrail.n < 3000) {
      avatarTrail.last.copy(avatar.root.position);
      avatarTrail.line.geometry.attributes.position.setXYZ(avatarTrail.n++, a.p[0], a.p[1] + 0.003, a.p[2]);
      avatarTrail.line.geometry.attributes.position.needsUpdate = true;
      avatarTrail.line.geometry.setDrawRange(0, avatarTrail.n);
    }
  }
  const props = s.props || [];
  while (propMeshes.length > props.length) scene.remove(propMeshes.pop());
  props.forEach((p, i) => {
    let m = propMeshes[i];
    if (!m || m.userData.k !== p.k) {
      if (m) scene.remove(m);
      m = new THREE.Mesh(p.k === 'ball' ? ballGeo : boxGeo, propMat[p.k] || propMat.box); m.userData.k = p.k;
      scene.add(m); propMeshes[i] = m;
    }
    m.scale.setScalar(p.k === 'ball' ? p.s : p.s);
    m.position.fromArray(p.p); m.quaternion.fromArray(p.q);
  });
}

// ------------------------------------------------------------ rede
let server = {};
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws?role=viewer`);
  ws.binaryType = 'arraybuffer';
  ws.onmessage = (e) => {
    if (typeof e.data !== 'string') { onDelta(e.data); return; }
    const m = JSON.parse(e.data);
    if (m.t === 'reset' || m.t === 'cleared') resetMap();
    else if (m.t === 'pose') {
      phoneCam.matrix.fromArray(m.m); phoneCam.matrixWorld.copy(phoneCam.matrix); phoneHelper.update();
      camPos.set(m.m[12], m.m[13], m.m[14]); trajPush(camPos.x, camPos.y, camPos.z);
      server.lastPose = performance.now();
    } else if (m.t === 'trajectory') { m.pts.forEach((p) => trajPush(p[0], p[1], p[2])); }
    else if (m.t === 'state') onState(m);
    else if (m.t === 'stats' || m.t === 'hello') Object.assign(server, m);
    else if (m.t === 'rec') server.recording = m.on ? m.name : null;
  };
  ws.onopen = () => { server.online = true; };
  ws.onclose = () => { server.online = false; setTimeout(connect, 1500); };
}
connect();

// ------------------------------------------------------------ UI
$('#b-follow').onclick = (e) => { follow = !follow; e.target.classList.toggle('on', follow); };
$('#b-mode').onclick = (e) => {
  viewMode = viewMode === 'pontos' ? 'cubos' : 'pontos';
  points.visible = viewMode === 'pontos'; cubes.visible = !points.visible;
  e.target.textContent = viewMode === 'pontos' ? 'Cubos' : 'Pontos';
};
$('#b-rec').onclick = () => fetch('/api/record', { method: 'POST' });
$('#b-clear').onclick = () => fetch('/api/clear', { method: 'POST' });
function updateStats() {
  const live = server.lastPose && performance.now() - server.lastPose < 1500;
  const rows = [
    ['backend', server.online ? 'online' : 'offline'],
    ['celular', server.phones ? (live ? 'transmitindo' : 'conectado') : '—'],
    ['voxel', `${(RES * 100).toFixed(0)} cm`],
    ['voxels', state.list.length.toLocaleString('pt-BR')],
    ['quadros', (server.frames || 0).toLocaleString('pt-BR')],
    ['área', state.list.length ? `${(state.list.length * RES * RES).toFixed(2).replace('.', ',')} m² (aprox.)` : '—'],
  ];
  $('#stats').innerHTML = rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');
  const rec = $('#b-rec');
  rec.textContent = server.recording ? '■ Parar gravação' : 'Gravar sessão';
  rec.classList.toggle('rec', !!server.recording);
}
setInterval(updateStats, 400);

const clock = new THREE.Clock();
const goal = new THREE.Vector3();
renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  if (follow && server.lastPose) {
    goal.copy(avatar?.root.visible ? avatar.root.position : camPos);
    controls.target.lerp(goal, Math.min(1, dt * 2));
  }
  controls.update();
  avatar?.update(dt);
  renderer.render(scene, camera);
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
window.__viewer = { state, scene };
