// Gera dist/ — versão estática do app (AR + simulador + avatar) para hospedar em HTTPS (ex.: Vercel).
// O backend de nuvem de pontos (server/) continua sendo local: rode `npm start` no PC.
//   npm run build
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const copies = [
  ['web', ''],
  ['shared', 'shared'],
  ['node_modules/three/build/three.module.js', 'vendor/three/build/three.module.js'],
  ['node_modules/three/build/three.core.js', 'vendor/three/build/three.core.js'],
  ['node_modules/three/examples/jsm/controls/OrbitControls.js', 'vendor/three/examples/jsm/controls/OrbitControls.js'],
  ['node_modules/@dimforge/rapier3d-compat/rapier.mjs', 'vendor/rapier/rapier.mjs'],
];

fs.rmSync(DIST, { recursive: true, force: true });
for (const [from, to] of copies) {
  const src = path.join(ROOT, from), dst = path.join(DIST, to);
  if (!fs.existsSync(src)) { console.error('faltando:', from, '(rode npm install / npm run avatar)'); process.exit(1); }
  fs.cpSync(src, dst, { recursive: true });
}
const avatar = path.join(DIST, 'assets/avatar.json');
if (!fs.existsSync(avatar)) { console.error('faltando web/assets/avatar.json — rode: npm run avatar'); process.exit(1); }
let n = 0, bytes = 0;
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } })(DIST);
console.log(`dist/ pronto: ${n} arquivos, ${(bytes / 1048576).toFixed(1)} MB`);
