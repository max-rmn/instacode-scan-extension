'use strict';

// Content script (monde isolé). Injecté à la demande via chrome.scripting.executeScript
// sur l'onglet Instagram actif. Rôles :
//   1. injecter injected.js en MAIN world (même origine Instagram → session/cookies auto) ;
//   2. relayer la progression (postMessage ← MAIN world) vers le popup (chrome.runtime) ;
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
      chrome.runtime.sendMessage(msg).catch(() => {});
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

  // ── POST final au panneau (depuis le content script : pas de CORS grâce aux host_permissions) ──
  async function upload(followers, following) {
    const cfg = state.config;
    if (!cfg) {
      send({ type: 'error', message: 'Configuration manquante pour l’envoi.' });
      return;
    }
    send({ type: 'uploading' });
    const base = (cfg.panelUrl || '').replace(/\/+$/, '');
    try {
      const res = await fetch(base + '/api/scan/upload', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Scan-Token': cfg.token,
        },
        body: JSON.stringify({ followers, following }),
        credentials: 'omit', // jamais de cookies vers le panneau
      });
      let data = null;
      const text = await res.text();
      try {
        data = JSON.parse(text);
      } catch (e) {
        /* réponse non JSON */
      }
      if (res.ok) {
        send({ type: 'uploaded', data: data || {} });
      } else {
        const msg = (data && data.error) || ('Erreur HTTP ' + res.status + (text ? ' : ' + text.slice(0, 300) : ''));
        send({ type: 'error', message: msg });
      }
    } catch (e) {
      send({ type: 'error', message: 'Échec de l’envoi au panneau : ' + ((e && e.message) || e) });
    }
  }

  // ── Injection en MAIN world via balise <script src=chrome.runtime.getURL('injected.js')> ──
  function injectMainWorld() {
    const s = document.createElement('script');
    s.src = chrome.runtime.getURL('injected.js');
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
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
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
