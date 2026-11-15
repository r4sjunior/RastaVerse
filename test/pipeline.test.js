// node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unprojectDepth, scoreOrientation } from '../shared/depth.js';
import { encodeDepthFrame, decodeDepthFrame } from '../shared/protocol.js';
import { VoxelMap, packKey, unpackKey } from '../shared/voxelmap.js';
import { perspective, lookAtWorld, invert, transform4 } from '../shared/mat4.js';

/** gera um quadro de depth de um plano horizontal y=planeY, com buffer de depth girado 90° (celular em retrato) */
function syntheticFrame({ planeY = 0.75, eye = [0, 1.2, 0.6], target = [0, 0.75, 0], W = 90, H = 160, rotate = true } = {}) {
  const proj = perspective(1.0, 9 / 16, 0.05, 20);
  const world = lookAtWorld(eye, target);
  const invProj = invert(proj);
  // depth (bu,bv) = (1 - v, u)  =>  u = bv, v = 1 - bu
  const M = rotate
    ? Float32Array.from([0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 1])
    : Float32Array.from([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const dw = rotate ? H : W, dh = rotate ? W : H; // buffer em paisagem
  const data = new Uint16Array(dw * dh);
  const t = [0, 0, 0, 0];
  for (let py = 0; py < dh; py++) {
    for (let px = 0; px < dw; px++) {
      const bu = (px + 0.5) / dw, bv = (py + 0.5) / dh;
      const u = rotate ? bv : bu, v = rotate ? 1 - bu : bv;
      transform4(invProj, u * 2 - 1, 1 - v * 2, 1, 1, t);
      const rx = t[0] / t[3], ry = t[1] / t[3], rz = t[2] / t[3];
      // raio em mundo
      const dx = world[0] * rx + world[4] * ry + world[8] * rz;
      const dy = world[1] * rx + world[5] * ry + world[9] * rz;
      if (dy >= -1e-6) continue;
      const s = (planeY - eye[1]) / dy;      // fator ao longo do raio (rz em câmera)
      const depth = -rz * s;                 // profundidade no eixo óptico
      if (depth > 0 && depth < 10) data[py * dw + px] = Math.round(depth * 1000);
      void dx;
    }
  }
  return { seq: 7, timestamp: 123.5, width: dw, height: dh, data, rawValueToMeters: 0.001, worldFromView: world, projection: proj, normDepthFromNormView: M };
}

test('desprojeção reconstrói o plano da mesa (buffer girado, como no celular em retrato)', () => {
  const f = syntheticFrame();
  let n = 0, maxErr = 0, minZ = Infinity, maxZ = -Infinity;
  unprojectDepth(f, (x, y, z) => { n++; maxErr = Math.max(maxErr, Math.abs(y - 0.75)); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); }, { step: 1, maxDepth: 10 });
  assert.ok(n > 5000, 'pontos: ' + n);
  assert.ok(maxErr < 0.003, 'erro de altura ' + maxErr);
  assert.ok(minZ < 0 && maxZ > 0, 'cobre a região à frente e atrás do alvo');
});

test('o centro da imagem cai no ponto para onde a câmera olha', () => {
  const f = syntheticFrame({ rotate: false, W: 101, H: 101 });
  const pts = [];
  unprojectDepth(f, (x, y, z) => pts.push([x, y, z]), { step: 1, maxDepth: 10 });
  // pixel central
  const c = pts.reduce((best, p) => (Math.hypot(p[0], p[2]) < Math.hypot(best[0], best[2]) ? p : best));
  assert.ok(Math.hypot(c[0], c[2]) < 0.01, JSON.stringify(c));
});

test('protocolo binário ida e volta', () => {
  const f = syntheticFrame({ W: 32, H: 24 });
  const back = decodeDepthFrame(Buffer.from(encodeDepthFrame(f)));
  assert.equal(back.width, f.width); assert.equal(back.height, f.height); assert.equal(back.seq, 7);
  assert.equal(back.timestamp, 123.5);
  assert.deepEqual(Array.from(back.data), Array.from(f.data));
  assert.deepEqual(Array.from(back.worldFromView), Array.from(f.worldFromView));
  assert.deepEqual(Array.from(back.normDepthFromNormView), Array.from(f.normDepthFromNormView));
});

test('chaves de voxel com índices negativos', () => {
  for (const ijk of [[0, 0, 0], [-1, -2, -3], [500, -65536, 65535], [-65536, 65535, 0]]) {
    assert.deepEqual(unpackKey(packKey(...ijk)), ijk);
  }
});

test('mapa: ponto confirma voxel, raio livre apaga objeto que saiu', () => {
  const m = new VoxelMap({ res: 0.05, trackY: true });
  m.addPoint(1, 0.52, 0); m.addPoint(1, 0.52, 0);
  assert.equal(m.occupied, 1);
  assert.equal(m.drain().added.length, 1);
  const key = m.key(1, 0.52, 0);
  assert.ok(Math.abs(m.surfaceTop(key, Math.floor(0.52 / 0.05)) - 0.52) < 1e-6);
  // vários raios atravessando o voxel até a parede mais atrás
  for (let i = 0; i < 10; i++) m.carve(0, 0.52, 0, 3, 0.52, 0);
  assert.equal(m.occupied, 0);
  assert.equal(m.drain().removed.length, 1);
});

test('autocalibração detecta depth de cabeça para baixo', () => {
  const f = syntheticFrame({ rotate: false, W: 90, H: 160 });
  const [ok, flipped] = scoreOrientation(f, 0.75, 0, 0);
  assert.ok(ok < 0.005 && flipped > 0.03, `normal ${ok} invertido ${flipped}`);
  // mesmo quadro com as linhas do buffer invertidas: agora a hipótese "invertida" é a certa
  const g = { ...f, data: new Uint16Array(f.data.length) };
  for (let y = 0; y < f.height; y++) g.data.set(f.data.subarray(y * f.width, (y + 1) * f.width), (f.height - 1 - y) * f.width);
  const [ok2, flipped2] = scoreOrientation(g, 0.75, 0, 0);
  assert.ok(flipped2 < 0.005 && ok2 > 0.03, `normal ${ok2} invertido ${flipped2}`);
  let maxErr = 0;
  unprojectDepth({ ...g, flipY: true }, (x, y) => { maxErr = Math.max(maxErr, Math.abs(y - 0.75)); }, { step: 2, maxDepth: 10 });
  assert.ok(maxErr < 0.003, 'com flipY o plano volta ao lugar: ' + maxErr);
});

test('protocolo carrega a flag de orientação', () => {
  const f = { ...syntheticFrame({ W: 16, H: 12 }), flipY: true };
  assert.equal(decodeDepthFrame(encodeDepthFrame(f)).flipY, true);
  assert.equal(decodeDepthFrame(encodeDepthFrame({ ...f, flipY: false })).flipY, false);
});

test('filtro de pixels voadores descarta a borda entre objeto e fundo', () => {
  // mesa a 1 m com uma "caixa" a 0,6 m no meio: os pixels da borda não podem virar pontos
  const W = 40, H = 30, data = new Uint16Array(W * H).fill(1000);
  for (let y = 10; y < 20; y++) for (let x = 15; x < 25; x++) data[y * W + x] = 600;
  data[15 * W + 14] = 800;                  // pixel "misturado" na borda (voador)
  const f = { width: W, height: H, data, rawValueToMeters: 0.001,
    worldFromView: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], projection: perspective(1, W / H, 0.05, 20),
    normDepthFromNormView: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] };
  const zs = [];
  unprojectDepth(f, (x, y, z) => zs.push(-z), { step: 1, maxDepth: 5 });
  assert.ok(!zs.some((z) => z > 0.7 && z < 0.9), 'nenhum ponto voador a 0,8 m');
  assert.ok(zs.some((z) => Math.abs(z - 0.6) < 0.01) && zs.some((z) => Math.abs(z - 1) < 0.01), 'caixa e mesa continuam');
  let semFiltro = 0;
  unprojectDepth(f, (x, y, z) => { if (-z > 0.7 && -z < 0.9) semFiltro++; }, { step: 1, maxDepth: 5, edge: 0 });
  assert.equal(semFiltro, 1);
});

test('mapa: índice por camada acompanha voxels confirmados e apagados (inclusive índices negativos)', () => {
  const m = new VoxelMap({ res: 0.05, layers: true });
  for (let n = 0; n < 2; n++) { m.addPoint(1, 0.52, 0); m.addPoint(-2, -0.33, 1.5); }
  const j1 = Math.floor(0.52 / 0.05), j2 = Math.floor(-0.33 / 0.05);
  assert.equal(m.layer(j1)?.size, 1);
  assert.equal(m.layer(j2)?.size, 1);
  assert.ok(m.layer(j1).has(m.key(1, 0.52, 0)));
  for (let i = 0; i < 10; i++) m.carve(0, 0.52, 0, 3, 0.52, 0);
  assert.equal(m.layer(j1), undefined);
  m.clear();
  assert.equal(m.layer(j2), undefined);
});

test('mapa: prune esquece ruído não confirmado e mantém voxels confirmados e ruído recente', () => {
  const m = new VoxelMap({ res: 0.05, occ: 6, prune: true });
  m.addPoint(0, 0, 0); m.addPoint(0, 0, 0); m.addPoint(0, 0, 0);   // confirmado (2+2+2 = 6)
  m.addPoint(1, 0, 0);                                              // ruído (2 < 6)
  assert.equal(m.prune(), 0);                                       // ruído foi tocado neste intervalo
  m.addPoint(2, 0, 0);                                              // ruído novo
  assert.equal(m.prune(), 1);                                       // só o ruído antigo sai
  assert.ok(m.isOccupiedAt(0, 0, 0));
  assert.ok(m.cells.has(m.key(2, 0, 0)));
  assert.ok(!m.cells.has(m.key(1, 0, 0)));
});
