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

async function doConnect(msg) {
  const base = (msg.panelUrl || '').replace(/\/+$/, '');
  // Lit les cookies Instagram (y compris HttpOnly : sessionid, csrftoken) via
  // l'API cookies — le content script n'y a PAS accès (document.cookie masque
  // les HttpOnly). On récupère exactement ce que le navigateur envoie à
  // instagram.com : c'est la session fiable, pas de login programmatique flaggé.
  let cookies;
  try {
    cookies = await browser.cookies.getAll({ url: 'https://www.instagram.com/' });
  } catch (e) {
    return { ok: false, error: 'Impossible de lire les cookies Instagram : ' + ((e && e.message) || e) };
  }
  const cookieMap = {};
  for (const c of cookies || []) {
    if (c && c.name) cookieMap[c.name] = c.value;
  }
  if (!cookieMap.sessionid) {
    return { ok: false, error: "Aucune session Instagram trouvée dans ce navigateur. Connecte-toi d'abord sur instagram.com puis réessaie." };
  }
  const res = await fetch(base + '/api/extension/connect', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Scan-Token': msg.token || '',
    },
    body: JSON.stringify({ cookies: cookieMap }),
    credentials: 'omit',
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { /* réponse non JSON */ }
  return { ok: res.ok, status: res.status, data: data || {}, text: text.slice(0, 300) };
}

browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg) return;
  let p;
  if (msg.type === 'upload') {
    p = doUpload(msg);
  } else if (msg.type === 'connect') {
    p = doConnect(msg);
  } else {
    return;
  }
  p = p.catch((e) => ({ ok: false, error: String((e && e.message) || e) }));
  if (typeof sendResponse === 'function') {
    p.then(sendResponse);
    return true; // Chrome : garde le canal ouvert pour la réponse asynchrone
  }
  return p; // Firefox : réponse via la Promise retournée
});
