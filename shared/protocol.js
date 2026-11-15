// Protocolo binário celular -> servidor (WebSocket). Little-endian.
//
// Quadro de depth "RMD1" (220 bytes de cabeçalho + dados):
//   0  'RMD1'            4  u32 seq           8  f64 timestamp (ms)
//  16  u16 width        18  u16 height       20  u8 formato (0=u16 mm, 1=f32 m)  21 u8 flags (bit0 = v invertido)  22..23 reservado
//  24  f32 rawValueToMeters
//  28  f32[16] worldFromView   (pose da câmera = resultado do SLAM do ARCore)
//  92  f32[16] projection
// 156  f32[16] normDepthFromNormView
// 220  dados (width*height de u16 ou f32)
//
// Mensagens de texto são JSON: { t: 'hello'|'state'|'event'|..., ... }

export const MAGIC_DEPTH = 0x31444d52; // 'RMD1'
export const HEADER = 220;

export function encodeDepthFrame(f) {
  const isF32 = f.data instanceof Float32Array;
  const bytes = f.data.byteLength;
  const buf = new ArrayBuffer(HEADER + bytes);
  const dv = new DataView(buf);
  dv.setUint32(0, MAGIC_DEPTH, true);
  dv.setUint32(4, f.seq >>> 0, true);
  dv.setFloat64(8, f.timestamp || 0, true);
  dv.setUint16(16, f.width, true);
  dv.setUint16(18, f.height, true);
  dv.setUint8(20, isF32 ? 1 : 0);
  dv.setUint8(21, f.flipY ? 1 : 0);
  dv.setFloat32(24, f.rawValueToMeters, true);
  const mats = new Float32Array(buf, 28, 48);
  mats.set(f.worldFromView, 0);
  mats.set(f.projection, 16);
  mats.set(f.normDepthFromNormView, 32);
  new Uint8Array(buf, HEADER).set(new Uint8Array(f.data.buffer, f.data.byteOffset, bytes));
  return buf;
}

/** aceita ArrayBuffer ou Buffer do Node; copia para memória alinhada */
export function decodeDepthFrame(input) {
  const u8 = input instanceof ArrayBuffer ? new Uint8Array(input) : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  if (u8.byteLength < HEADER) return null;
  const buf = u8.slice().buffer;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== MAGIC_DEPTH) return null;
  const width = dv.getUint16(16, true), height = dv.getUint16(18, true);
  const fmt = dv.getUint8(20);
  const n = width * height;
  const need = HEADER + n * (fmt === 1 ? 4 : 2);
  if (buf.byteLength < need) return null;
  const mats = new Float32Array(buf, 28, 48);
  return {
    seq: dv.getUint32(4, true),
    timestamp: dv.getFloat64(8, true),
    width, height,
    rawValueToMeters: dv.getFloat32(24, true),
    flipY: (dv.getUint8(21) & 1) === 1,
    worldFromView: mats.slice(0, 16),
    projection: mats.slice(16, 32),
    normDepthFromNormView: mats.slice(32, 48),
    data: fmt === 1 ? new Float32Array(buf, HEADER, n) : new Uint16Array(buf, HEADER, n),
  };
}
