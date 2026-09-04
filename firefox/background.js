'use strict';

// Script d'arrière-plan : effectue l'envoi au panneau hors CORS
// (fetch depuis le background + host_permissions = accès cross-origin complet,
// contrairement au content script qui est soumis au CORS de la page dans Firefox).
const browser = globalThis.browser ?? globalThis.chrome;

async function doUpload(msg) {
  const base = (msg.panelUrl || '').replace(/\/+$/, '');
  const res = await fetch(base + '/api/scan/upload', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Scan-Token': msg.token || '',
    },
    body: JSON.stringify({ followers: msg.followers, following: msg.following }),
    credentials: 'omit', // jamais de cookies vers le panneau
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* réponse non JSON */ }
  return { ok: res.ok, status: res.status, data: data || {}, text: text.slice(0, 300) };
}

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== 'upload') return;
  const p = doUpload(msg).catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  if (typeof sendResponse === 'function') {
    p.then(sendResponse);
    return true; // Chrome : garde le canal ouvert pour la réponse asynchrone
  }
  return p; // Firefox : réponse via la Promise retournée
});
