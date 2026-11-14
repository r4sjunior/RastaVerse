// RastaME MR — backend
//  - serve o app do celular (web/) e o visualizador do PC (web/viewer.html)
//  - recebe pela WebSocket os quadros de depth + pose (SLAM do ARCore) do celular
//  - funde tudo num mapa de voxels / nuvem de pontos em escala 1:1 (metros)
//  - retransmite deltas do mapa e o estado do jogo para os visualizadores
//  - grava sessões (depth + poses crus) para reconstrução 3D offline (tools/reconstruct_open3d.py)
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { decodeDepthFrame } from '../shared/protocol.js';
import { unprojectDepth } from '../shared/depth.js';
import { VoxelMap, unpackKey } from '../shared/voxelmap.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 8080);
const HTTPS_PORT = Number(process.env.HTTPS_PORT || 8443);
const RES = Number(process.env.VOXEL || 0.02);
const DATA_DIR = path.join(ROOT, 'data');

const ROUTES = [
  ['/vendor/three/', path.join(ROOT, 'node_modules/three/')],
  ['/vendor/rapier/', path.join(ROOT, 'node_modules/@dimforge/rapier3d-compat/')],
  ['/shared/', path.join(ROOT, 'shared/')],
  ['/', path.join(ROOT, 'web/')],
];
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

// ---------------------------------------------------------------- estado
const map = new VoxelMap({ res: RES, hit: 2, miss: 1, occ: 4, max: 30 });
const trajectory = [];               // [t, x, y, z] da câmera
const stats = { frames: 0, points: 0, bytes: 0, lastFrameAt: 0, phones: 0, viewers: 0 };
let lastState = null;
let recording = null;                // { dir, stream, frames, poses }

function startRecording() {
  if (recording) return recording.name;
  const name = 'session-' + new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(DATA_DIR, name);
  fs.mkdirSync(dir, { recursive: true });
  recording = { name, dir, stream: fs.createWriteStream(path.join(dir, 'frames.rmd')), frames: 0, started: Date.now() };
  console.log('[rec] gravando em', dir);
  broadcast({ t: 'rec', on: true, name });
  return name;
}
function stopRecording() {
  if (!recording) return null;
  const r = recording; recording = null;
  r.stream.end();
  fs.writeFileSync(path.join(r.dir, 'meta.json'), JSON.stringify({
    format: 'RMD1 (ver shared/protocol.js); cada quadro precedido por u32 LE com o tamanho',
    frames: r.frames, voxel: RES, seconds: (Date.now() - r.started) / 1000,
  }, null, 2));
  fs.writeFileSync(path.join(r.dir, 'cloud.ply'), buildPly());
  console.log(`[rec] sessão salva: ${r.dir} (${r.frames} quadros)`);
  broadcast({ t: 'rec', on: false, name: r.name });
  return r.name;
}

function ingestDepth(buf) {
  const f = decodeDepthFrame(buf);
  if (!f) return;
  stats.frames++; stats.bytes += buf.byteLength; stats.lastFrameAt = Date.now();
  let i = 0;
  stats.points += unprojectDepth(f, (x, y, z, ox, oy, oz) => {
    map.addPoint(x, y, z);
    if ((i++ & 3) === 0) map.carve(ox, oy, oz, x, y, z);
  }, { step: 2, maxDepth: 5 });
  const W = f.worldFromView;
  trajectory.push([Date.now(), W[12], W[13], W[14]]);
  if (trajectory.length > 20000) trajectory.splice(0, 5000);
  pendingPose = Array.from(W);
  if (recording) {
    const len = Buffer.alloc(4); len.writeUInt32LE(buf.byteLength);
    recording.stream.write(len); recording.stream.write(Buffer.from(buf));
    recording.frames++;
  }
}

// ---------------------------------------------------------------- PLY
function buildPly() {
  const occ = map.occupiedList();
  const n = occ.length / 4;
  let minY = Infinity, maxY = -Infinity;
  for (let i = 1; i < occ.length; i += 4) { minY = Math.min(minY, occ[i]); maxY = Math.max(maxY, occ[i]); }
  const head = `ply\nformat binary_little_endian 1.0\ncomment RastaME MR voxel ${RES} m\nelement vertex ${n}\n` +
    'property float x\nproperty float y\nproperty float z\nproperty uchar red\nproperty uchar green\nproperty uchar blue\nend_header\n';
  const body = Buffer.alloc(n * 15);
  for (let v = 0; v < n; v++) {
    const i = occ[v * 4], j = occ[v * 4 + 1], k = occ[v * 4 + 2];
    const o = v * 15;
    body.writeFloatLE((i + 0.5) * RES, o); body.writeFloatLE((j + 0.5) * RES, o + 4); body.writeFloatLE((k + 0.5) * RES, o + 8);
    const t = maxY > minY ? (j - minY) / (maxY - minY) : 0.5;
    const [r, g, b] = heightColor(t);
    body[o + 12] = r; body[o + 13] = g; body[o + 14] = b;
  }
  return Buffer.concat([Buffer.from(head, 'ascii'), body]);
}
function heightColor(t) {
  // azul -> verde -> amarelo -> vermelho
  const c = [[40, 70, 200], [40, 190, 120], [240, 220, 60], [230, 70, 50]];
  const x = Math.max(0, Math.min(0.999, t)) * 3, i = Math.floor(x), f = x - i;
  return c[i].map((v, n) => Math.round(v + (c[i + 1][n] - v) * f));
}

// ---------------------------------------------------------------- HTTP
function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let p = decodeURIComponent(url.pathname);
  for (const [prefix, dir] of ROUTES) {
    if (!p.startsWith(prefix)) continue;
    let rel = p.slice(prefix.length) || 'index.html';
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.resolve(dir, rel);
    if (!file.startsWith(path.resolve(dir))) break; // path traversal
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); res.end('404'); return; }
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      });
      fs.createReadStream(file).pipe(res);
    });
    return;
  }
  res.writeHead(404); res.end('404');
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/status') {
    return json(res, 200, {
      voxel: RES, occupied: map.occupied, cells: map.cells.size, ...stats,
      recording: recording ? recording.name : null, trajectory: trajectory.length,
    });
  }
  if (url.pathname === '/api/map.ply') {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': 'attachment; filename="rastame-cloud.ply"' });
    return res.end(buildPly());
  }
  if (url.pathname === '/api/clear' && req.method === 'POST') {
    map.clear(); trajectory.length = 0; flushViewers(true);
    broadcast({ t: 'cleared' });
    return json(res, 200, { ok: true });
  }
  if (url.pathname === '/api/record' && req.method === 'POST') {
    const name = recording ? stopRecording() : startRecording();
    return json(res, 200, { ok: true, recording: recording ? recording.name : null, name });
  }
  serveStatic(req, res);
}

// ---------------------------------------------------------------- WebSocket
const phones = new Set(), viewers = new Set();
let pendingPose = null;

function broadcast(obj, to = viewers) {
  const s = JSON.stringify(obj);
  for (const ws of to) if (ws.readyState === 1) ws.send(s);
}
function broadcastAll(obj) { broadcast(obj, viewers); broadcast(obj, phones); }

/** delta do mapa: 'RMV1' | f32 res | u32 nAdd | u32 nRem | i32 ijk... (add) | i32 ijk... (rem) */
function encodeMapDelta(added, removed) {
  const buf = new ArrayBuffer(16 + (added.length + removed.length) * 12);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x31564d52, true);
  dv.setFloat32(4, RES, true);
  dv.setUint32(8, added.length, true);
  dv.setUint32(12, removed.length, true);
  const ints = new Int32Array(buf, 16);
  const t = [0, 0, 0];
  let o = 0;
  for (const list of [added, removed]) for (const key of list) { unpackKey(key, t); ints[o++] = t[0]; ints[o++] = t[1]; ints[o++] = t[2]; }
  return buf;
}

function snapshotKeys() {
  const out = [];
  for (const [key, v] of map.cells) if (v >= map.occ) out.push(key);
  return out;
}

function flushViewers(full = false) {
  const d = map.drain();
  if (full) {
    const buf = encodeMapDelta(snapshotKeys(), []);
    for (const ws of viewers) if (ws.readyState === 1) { ws.send(JSON.stringify({ t: 'reset' })); ws.send(buf); }
    return;
  }
  if (d.added.length || d.removed.length) {
    const buf = encodeMapDelta(d.added, d.removed);
    for (const ws of viewers) if (ws.readyState === 1 && ws.bufferedAmount < 4e6) ws.send(buf);
  }
  if (pendingPose) { broadcast({ t: 'pose', m: pendingPose }); pendingPose = null; }
  if (lastState) { broadcast(lastState); lastState = null; }
}
setInterval(flushViewers, 150);
setInterval(() => broadcastAll({ t: 'stats', occupied: map.occupied, frames: stats.frames, recording: recording?.name || null, phones: phones.size, viewers: viewers.size }), 1000);

function attachWs(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 * 1024 });
  wss.on('connection', (ws, req) => {
    const role = new URL(req.url, 'http://x').searchParams.get('role') || 'viewer';
    const set = role === 'phone' ? phones : viewers;
    set.add(ws);
    stats.phones = phones.size; stats.viewers = viewers.size;
    console.log(`[ws] ${role} conectado (${req.socket.remoteAddress})`);
    ws.send(JSON.stringify({ t: 'hello', role, voxel: RES, recording: recording?.name || null }));
    if (role === 'viewer') {
      ws.send(JSON.stringify({ t: 'reset' }));
      ws.send(encodeMapDelta(snapshotKeys(), []));
      ws.send(JSON.stringify({ t: 'trajectory', pts: trajectory.slice(-4000).map((p) => [p[1], p[2], p[3]]) }));
    }
    ws.on('message', (data, isBinary) => {
      if (isBinary) { if (role === 'phone') ingestDepth(data); return; }
      let msg; try { msg = JSON.parse(data.toString()); } catch { return; }
      if (msg.t === 'state') lastState = msg;
      else if (msg.t === 'event') broadcast(msg);
      else if (msg.t === 'record') { if (msg.on && !recording) startRecording(); else if (!msg.on && recording) stopRecording(); }
      else if (msg.t === 'clear') { map.clear(); trajectory.length = 0; flushViewers(true); broadcast({ t: 'cleared' }); }
    });
    ws.on('close', () => { set.delete(ws); stats.phones = phones.size; stats.viewers = viewers.size; console.log(`[ws] ${role} saiu`); });
  });
}

const httpServer = http.createServer(handler);
attachWs(httpServer);
httpServer.listen(PORT, '0.0.0.0');

const keyFile = path.join(ROOT, 'certs/key.pem'), certFile = path.join(ROOT, 'certs/cert.pem');
let httpsOn = false;
if (fs.existsSync(keyFile) && fs.existsSync(certFile)) {
  const s = https.createServer({ key: fs.readFileSync(keyFile), cert: fs.readFileSync(certFile) }, handler);
  attachWs(s);
  s.listen(HTTPS_PORT, '0.0.0.0');
  httpsOn = true;
}

const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);
console.log(`\nRastaME MR backend — voxel ${RES * 100} cm`);
console.log(`  PC (visualizador):  http://localhost:${PORT}/viewer.html`);
for (const ip of ips) {
  console.log(`  Celular (AR):       http://${ip}:${PORT}/   (com a flag do Chrome, ver README)`);
  if (httpsOn) console.log(`                      https://${ip}:${HTTPS_PORT}/  (certificado próprio)`);
}
console.log(`  Simulador no PC:    http://localhost:${PORT}/?sim=1\n`);

process.on('SIGINT', () => { stopRecording(); process.exit(0); });
