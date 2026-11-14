// Gera um certificado autoassinado (certs/key.pem + certs/cert.pem) com os IPs da rede local,
// para servir o app em HTTPS (o WebXR exige "contexto seguro").
// Precisa do openssl no PATH (o Git for Windows já traz um).   Uso: npm run cert
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(ROOT, 'certs');
fs.mkdirSync(dir, { recursive: true });
const ips = Object.values(os.networkInterfaces()).flat().filter((i) => i && i.family === 'IPv4').map((i) => i.address);
const san = ['DNS:localhost', ...ips.map((ip) => 'IP:' + ip)].join(',');
const candidates = ['openssl', 'C:/Program Files/Git/usr/bin/openssl.exe', 'C:/Program Files/Git/mingw64/bin/openssl.exe'];
let ok = false;
for (const bin of candidates) {
  try {
    execFileSync(bin, ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
      '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem'),
      '-subj', '/CN=RastaME MR', '-addext', 'subjectAltName=' + san], { stdio: 'inherit' });
    ok = true; break;
  } catch { /* tenta o próximo */ }
}
if (!ok) { console.error('openssl não encontrado. Instale o Git for Windows ou use a flag do Chrome (README).'); process.exit(1); }
console.log('certificado criado em certs/ para', san);
