'use strict';

// Shim cross-navigateur : Firefox expose `browser` (WebExtensions, Promises) et
// alias `chrome` ; Chrome n'expose que `chrome`. Tous les appels runtime sont en
// style Promise (.catch), donc compatibles avec les deux namespaces.
const browser = globalThis.browser ?? globalThis.chrome;

// Content script (monde isolé). Injecté à la demande via browser.scripting.executeScript
// sur l'onglet Instagram actif. Rôles :
//   1. injecter injected.js en MAIN world (même origine Instagram → session/cookies auto) ;
//   2. relayer la progression (postMessage ← MAIN world) vers le popup (browser.runtime) ;
//   3. recevoir {type:'done', followers, following} et POSTER le résultat au panneau
//      (fetch cross-origin autorisé par host_permissions, SANS jamais envoyer de cookies).
//
// PRIVACITÉ : le fetch vers le panneau utilise credentials:'omit' — aucun cookie
// Instagram (ni aucun autre cookie) n'est transmis au panneau. Seules les listes
// {id, username} sont envoyées.

(() => {
  // Garde anti double-injection : les exécutions répétées du même content script
  // partagent le même monde isolé, donc ce drapeau persiste.
  if (window.__instacodeScanLoaded) return;
  window.__instacodeScanLoaded = true;

  const state = {
    running: false,
    followers: 0,
    following: 0,
    config: null,
  };

  const send = (msg) => {
    try {
      browser.runtime.sendMessage(msg).catch(() => {});
    } catch (e) {
      /* popup fermé : on ignore */
    }
  };

  // ── Messages venant de injected.js (MAIN world) via window.postMessage ──
  window.addEventListener('message', (ev) => {
    if (ev.source !== window) return;
    const d = ev.data;
    if (!d || d.source !== 'instacode-scan') return;

    switch (d.type) {
      case 'progress':
        state.followers = d.followers || 0;
        state.following = d.following || 0;
        send({ type: 'progress', followers: state.followers, following: state.following });
        break;
      case 'log':
        send({ type: 'log', message: d.message });
        break;
      case 'done':
        state.running = false;
        upload(d.followers || [], d.following || []);
        break;
      case 'stopped':
        state.running = false;
        state.followers = d.followers || 0;
        state.following = d.following || 0;
        send({ type: 'stopped', followers: state.followers, following: state.following });
        break;
      case 'error':
        state.running = false;
        send({ type: 'error', message: d.message });
        break;
    }
  });

  // ── Envoi final au panneau via le background (hors CORS, cross-navigateur) ──
  async function upload(followers, following) {
    const cfg = state.config;
    if (!cfg) {
      send({ type: 'error', message: 'Configuration manquante pour l’envoi.' });
      return;
    }
    send({ type: 'uploading' });
    const base = (cfg.panelUrl || '').replace(/\/+$/, '');
    try {
      const res = await browser.runtime.sendMessage({
        type: 'upload',
        panelUrl: base,
        token: cfg.token,
        followers,
        following,
      });
      if (res && res.ok) {
        send({ type: 'uploaded', data: res.data || {} });
      } else {
        const msg = (res && res.data && res.data.error) || (res && res.error) || ('Erreur HTTP ' + (res && res.status) + (res && res.text ? ' : ' + res.text : ''));
        send({ type: 'error', message: msg });
      }
    } catch (e) {
      send({ type: 'error', message: 'Échec de l’envoi au panneau : ' + ((e && e.message) || e) });
    }
  }

  // ── Injection en MAIN world via balise <script src=browser.runtime.getURL('injected.js')> ──
  function injectMainWorld() {
    const s = document.createElement('script');
    s.src = browser.runtime.getURL('injected.js');
    s.onload = () => s.remove();
    s.onerror = () => {
      s.remove();
      state.running = false;
      send({
        type: 'error',
        message:
          'Impossible de charger le script de scan dans la page (blocage CSP ?). Recharge l’onglet et réessaie.',
      });
    };
    (document.head || document.documentElement).appendChild(s);
  }

  function sendStopToMainWorld() {
    window.postMessage({ source: 'instacode-scan-control', type: 'stop' }, '*');
  }

  // ── Messages venant du popup ──
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'start') {
      if (state.running) {
        sendResponse({ ok: false });
        return;
      }
      state.config = { panelUrl: msg.panelUrl, token: msg.token };
      state.running = true;
      state.followers = 0;
      state.following = 0;
      send({ type: 'started' });
      injectMainWorld();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'stop') {
      sendStopToMainWorld();
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'status') {
      sendResponse({
        running: state.running,
        followers: state.followers,
        following: state.following,
      });
      return;
    }
  });
})();
