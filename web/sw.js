// Service worker mínimo: deixa o RastaME instalável (PWA / app da Play Store via TWA).
// De propósito NÃO guarda o app em cache: cada deploy na Vercel chega na hora para todos.
// Só a navegação passa por aqui, e só para mostrar um aviso se o celular estiver sem internet.
const OFFLINE = `<!doctype html><html lang="pt-BR"><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>RastaME — sem conexão</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#05060a;color:#f7f9f0;font:16px system-ui;text-align:center;padding:24px">
<div><div style="width:96px;height:6px;margin:0 auto 20px;background:linear-gradient(90deg,#ff2d55 0 33%,#ffd60a 33% 66%,#00ff85 66%)"></div>
<h1 style="margin:0 0 8px;font-size:24px">Sem conexão</h1>
<p style="margin:0 0 20px;color:#c3c9bb">O RastaME precisa de internet para abrir.</p>
<button onclick="location.reload()" style="font:600 16px system-ui;padding:14px 24px;border:0;border-radius:10px;background:#c8ff2e;color:#0a0c05">Tentar de novo</button></div>`;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (e) => {
  if (e.request.mode !== 'navigate') return; // resto (js, modelos, música) vai direto para a rede
  e.respondWith(fetch(e.request).catch(() => new Response(OFFLINE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
