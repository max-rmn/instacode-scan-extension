'use strict';

const DEFAULT_URL = 'https://instacode-panel.onrender.com';
const $ = (id) => document.getElementById(id);

const state = { tabId: null };

function setStatus(text, cls) {
  const el = $('progress');
  el.textContent = text || '';
  el.className = cls || '';
}

function setCounts(followers, following) {
  const el = $('counts');
  if (followers == null && following == null) {
    el.textContent = '';
    return;
  }
  el.textContent = 'Abonnés : ' + (followers ?? 0) + '  ·  Abonnements : ' + (following ?? 0);
}

function setScanning(running) {
  $('scan').disabled = running;
  $('stop').style.display = running ? 'block' : 'none';
  $('panelUrl').disabled = running;
  $('token').disabled = running;
}

async function loadConfig() {
  const cfg = await chrome.storage.local.get({ panelUrl: DEFAULT_URL, token: '' });
  $('panelUrl').value = cfg.panelUrl || DEFAULT_URL;
  $('token').value = cfg.token || '';
}

async function saveConfig() {
  await chrome.storage.local.set({
    panelUrl: ($('panelUrl').value || '').trim() || DEFAULT_URL,
    token: ($('token').value || '').trim(),
  });
}

async function activeInstagramTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || tab.id == null) {
    return { tab: null, error: 'Aucun onglet actif trouvé.' };
  }
  // `tab.url` n'est visible que si l'extension a l'autorisation host sur cet onglet
  // (host_permissions instagram.com). Sur un onglet non-Instagram, url sera undefined.
  const url = tab.url || '';
  if (!/^https:\/\/(www\.)?instagram\.com\//.test(url)) {
    return {
      tab: null,
      error: 'Ouvre d’abord https://www.instagram.com dans cet onglet et connecte-toi à ton compte.',
    };
  }
  return { tab, error: null };
}

$('scan').addEventListener('click', async () => {
  const token = ($('token').value || '').trim();
  if (!token) {
    setStatus('Colle d’abord ton jeton de scan (dashboard → /api/scan/token).', 'err');
    return;
  }
  await saveConfig();

  const { tab, error } = await activeInstagramTab();
  if (error) {
    setStatus(error, 'err');
    return;
  }

  // Injecte le content script dans l'onglet Instagram actif.
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
  } catch (e) {
    setStatus('Impossible d’injecter le script : ' + ((e && e.message) || e), 'err');
    return;
  }

  state.tabId = tab.id;
  const panelUrl = ($('panelUrl').value || '').trim() || DEFAULT_URL;

  try {
    const resp = await chrome.tabs.sendMessage(tab.id, {
      type: 'start',
      panelUrl,
      token,
    });
    if (resp && resp.ok === false) {
      setStatus('Un scan est déjà en cours dans cet onglet.', '');
      return;
    }
  } catch (e) {
    setStatus('Le script de scan n’a pas répondu. Recharge l’onglet Instagram puis réessaie.', 'err');
    return;
  }

  setScanning(true);
  setCounts(0, 0);
  setStatus('Démarrage du scan…', '');
});

$('stop').addEventListener('click', () => {
  if (state.tabId != null) {
    chrome.tabs.sendMessage(state.tabId, { type: 'stop' }).catch(() => {});
  }
  setStatus('Arrêt demandé…', '');
});

chrome.runtime.onMessage.addListener((msg) => {
  if (!msg) return;
  switch (msg.type) {
    case 'started':
      setScanning(true);
      break;
    case 'progress':
      setCounts(msg.followers, msg.following);
      break;
    case 'log':
      setStatus(msg.message || '', '');
      break;
    case 'uploading':
      setStatus('Envoi au panneau…', '');
      break;
    case 'uploaded':
      setScanning(false);
      setStatus(
        '✅ Scan envoyé au panneau : ' +
          (msg.data && msg.data.followers != null
            ? msg.data.followers + ' abonnés, ' + msg.data.following + ' abonnements, ' + msg.data.mutuals.length + ' mutuals.'
            : 'OK'),
        'ok'
      );
      break;
    case 'stopped':
      setScanning(false);
      setCounts(msg.followers, msg.following);
      setStatus('Scan arrêté (les résultats partiels n’ont pas été envoyés).', '');
      break;
    case 'error':
      setScanning(false);
      setStatus('❌ ' + (msg.message || 'Erreur inconnue'), 'err');
      break;
  }
});

// Rétablit l'état si le popup est rouvert pendant un scan en cours.
async function restore() {
  const { tab, error } = await activeInstagramTab();
  if (error || !tab) return;
  try {
    chrome.tabs.sendMessage(tab.id, { type: 'status' }, (resp) => {
      if (chrome.runtime.lastError || !resp) return;
      state.tabId = tab.id;
      if (resp.running) {
        setScanning(true);
        setCounts(resp.followers, resp.following);
        setStatus('Scan en cours…', '');
      }
    });
  } catch (e) {
    /* pas de content script injecté : rien à restaurer */
  }
}

loadConfig();
setScanning(false);
restore();
