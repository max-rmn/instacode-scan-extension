'use strict';

// Script exécuté en MAIN world (injecté via <script src=…> depuis le content script).
// Il hérite de l'origine www.instagram.com : la session (cookies sessionid/csrftoken)
// est envoyée automatiquement sur les appels GraphQL même origine → pas de CORS/401.
//
// Il pagine les abonnés (followers) PUIS les abonnements (following), avec pauses
// humaines et gestion du rate-limit (429), puis renvoie les listes {id, username}
// au content script via window.postMessage. Il ne contacte JAMAIS le panneau.

(() => {
  const QUERY_HASH = {
    followers: 'c76146de99bb02f6415203be841dd25a',
    following: '58712303d941c6855d4e888c5f0cd22f',
  };

  const FIRST = 50; // taille de page demandée
  const PAUSE_MIN = 800; // ms — pause humaine entre pages
  const PAUSE_MAX = 1500; // ms
  const RATE_LIMIT_WAIT = 30000; // 30 s après un 429
  const MAX_BACKOFF = 3; // nombre max de tentatives de reprise après 429
  const MAX_PAGES = 200; // pages max par fenêtre glissante
  const WINDOW_MS = 15 * 60 * 1000; // fenêtre de 15 minutes

  let stopRequested = false;

  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (d && d.source === 'instacode-scan-control' && d.type === 'stop') {
      stopRequested = true;
    }
  });

  const post = (msg) => {
    try {
      window.postMessage({ source: 'instacode-scan', ...msg }, '*');
    } catch (e) {
      /* ignore */
    }
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const rand = (min, max) => min + Math.random() * (max - min);

  // ── Identifiant du compte connecté ──
  function getUserId() {
    const m = document.cookie.match(/(?:^|;\s*)ds_user_id=([^;]+)/);
    if (m && m[1]) return m[1].trim();

    try {
      const viewer = window._sharedData && window._sharedData.config && window._sharedData.config.viewer;
      if (viewer && viewer.id) return String(viewer.id);
    } catch (e) {
      /* ignore */
    }

    // Fallback : préfixe numérique du sessionid (souvent HttpOnly → rarement lisible ici).
    const s = document.cookie.match(/(?:^|;\s*)sessionid=([^;]+)/);
    if (s && s[1]) {
      const n = s[1].match(/^\d+/);
      if (n) return n[0];
    }
    return null;
  }

  // ── Appel GraphQL page par page ──
  async function fetchPage(queryHash, userId, cursor) {
    const variables = {
      id: userId,
      include_reel: true,
      fetch_mutual: false,
      first: FIRST,
      after: cursor,
    };
    const url =
      'https://www.instagram.com/graphql/query/?query_hash=' +
      queryHash +
      '&variables=' +
      encodeURIComponent(JSON.stringify(variables));

    let res = await fetch(url, {
      method: 'GET',
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'XMLHttpRequest',
        'X-IG-App-ID': '936619743392459',
      },
    });

    // Si 400/401, réessayer sans les headers (certains comptes/sessions les rejettent).
    if (res.status === 400 || res.status === 401) {
      res = await fetch(url, { method: 'GET', credentials: 'same-origin' });
    }
    return res;
  }

  function parseList(json, kind) {
    const user = json && json.data && json.data.user;
    if (!user) return null;
    const edge = kind === 'followers' ? user.edge_followed_by : user.edge_follow;
    if (!edge) return null;

    const users = [];
    const edges = edge.edges || [];
    for (const e of edges) {
      const n = e && e.node;
      if (n && n.id != null && typeof n.username === 'string') {
        users.push({ id: String(n.id), username: n.username });
      }
    }
    const pi = edge.page_info || {};
    return {
      users,
      hasNext: !!pi.has_next_page,
      cursor: pi.end_cursor || null,
    };
  }

  // ── Boucle de pagination d'un type (followers ou following) ──
  async function paginate(queryHash, kind, userId, onProgress) {
    const collected = new Map(); // id -> username (déduplication)
    let cursor = null;
    let backoffs = 0;
    let pageCount = 0;
    let windowStart = Date.now();

    while (!stopRequested) {
      // Budget : max MAX_PAGES pages par fenêtre de 15 min.
      if (pageCount >= MAX_PAGES) {
        const elapsed = Date.now() - windowStart;
        if (elapsed < WINDOW_MS) {
          const wait = WINDOW_MS - elapsed;
          post({
            type: 'log',
            message: 'Rythme maximum atteint — pause anti-limite (' + Math.round(wait / 1000) + ' s)…',
          });
          const t0 = Date.now();
          while (Date.now() - t0 < wait && !stopRequested) await sleep(2000);
          windowStart = Date.now();
          pageCount = 0;
          continue;
        }
        windowStart = Date.now();
        pageCount = 0;
      }

      let res;
      try {
        res = await fetchPage(queryHash, userId, cursor);
      } catch (e) {
        post({ type: 'error', message: 'Erreur réseau vers Instagram : ' + ((e && e.message) || e) });
        return { collected, ok: false };
      }

      // Rate-limit / temporairement bloqué : pause puis reprise au MÊME cursor.
      if (res.status === 429 || res.status === 403) {
        if (backoffs >= MAX_BACKOFF) {
          post({
            type: 'error',
            message: 'Instagram limite toujours les requêtes. Réessaie dans quelques minutes.',
          });
          return { collected, ok: false };
        }
        backoffs++;
        post({
          type: 'log',
          message: 'Limite de débit Instagram (429) — pause ' + RATE_LIMIT_WAIT / 1000 + ' s (essai ' + backoffs + '/' + MAX_BACKOFF + ')…',
        });
        const t0 = Date.now();
        while (Date.now() - t0 < RATE_LIMIT_WAIT && !stopRequested) await sleep(2000);
        continue; // même cursor
      }

      if (!res.ok) {
        post({
          type: 'error',
          message: 'Instagram a répondu HTTP ' + res.status + ' (session expirée ? Reconnecte-toi sur instagram.com).',
        });
        return { collected, ok: false };
      }

      let json;
      try {
        json = await res.json();
      } catch (e) {
        post({ type: 'error', message: 'Réponse Instagram illisible (JSON invalide).' });
        return { collected, ok: false };
      }

      const parsed = parseList(json, kind);
      if (!parsed) {
        post({
          type: 'error',
          message: 'Structure GraphQL inattendue (session expirée ? Reconnecte-toi sur instagram.com).',
        });
        return { collected, ok: false };
      }

      backoffs = 0; // succès → reset du compteur de backoff
      for (const u of parsed.users) {
        if (!collected.has(u.id)) collected.set(u.id, u.username);
      }
      pageCount++;
      onProgress(collected.size);

      if (!parsed.hasNext || !parsed.cursor) {
        return { collected, ok: true }; // pagination terminée
      }
      cursor = parsed.cursor;

      await sleep(rand(PAUSE_MIN, PAUSE_MAX)); // pause humaine
    }

    return { collected, ok: false, stopped: true };
  }

  // ── Flux principal : followers puis following ──
  async function main() {
    const userId = getUserId();
    if (!userId) {
      post({
        type: 'error',
        message: 'Impossible de lire ton identifiant Instagram. Vérifie que tu es bien connecté sur instagram.com.',
      });
      return;
    }
    post({ type: 'log', message: 'Identifiant détecté — scan des abonnés…' });

    const followersList = [];
    const followingList = [];

    const fr = await paginate(QUERY_HASH.followers, 'followers', userId, (n) => {
      post({ type: 'progress', followers: n, following: 0 });
    });
    if (stopRequested) {
      post({ type: 'stopped', followers: fr.collected.size, following: 0 });
      return;
    }
    if (!fr.ok) return; // l'erreur a déjà été postée

    for (const [id, username] of fr.collected) followersList.push({ id, username });
    post({ type: 'log', message: 'Abonnés récupérés : ' + followersList.length + '. Scan des abonnements…' });

    const fg = await paginate(QUERY_HASH.following, 'following', userId, (n) => {
      post({ type: 'progress', followers: followersList.length, following: n });
    });
    if (stopRequested) {
      post({ type: 'stopped', followers: followersList.length, following: fg.collected.size });
      return;
    }
    if (!fg.ok) return;

    for (const [id, username] of fg.collected) followingList.push({ id, username });
    post({ type: 'log', message: 'Abonnements récupérés : ' + followingList.length + '.' });

    post({ type: 'done', followers: followersList, following: followingList });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
