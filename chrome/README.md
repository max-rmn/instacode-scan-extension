# Instacode Scan — extension Chrome

Extension Chrome (Manifest V3) qui scanne **tes** abonnés et abonnements Instagram
**depuis ton navigateur** (ta session, ton IP) puis envoie le résultat au panneau
Instacode. Aucune dépendance, JavaScript pur.

> **Pourquoi dans le navigateur ?** Le scan tourne sur `www.instagram.com` avec ta
> propre session connectée : c'est le moyen le plus discret et le plus fiable
> (pas d'IP datacenter, pas de risque de flag serveur).

---

## Fonctionnement

```
┌──────────┐  click « Scanner »   ┌────────────┐  <script src=injected.js>   ┌─────────────┐
│  popup   │ ───────────────────▶ │ content.js │ ──────────────────────────▶ │ injected.js │
│ (chrome) │  messages runtime    │ (isolated) │  postMessage (MAIN world)   │  (MAIN world)│
└──────────┘ ◀─────────────────── └────────────┘ ◀────────────────────────── └─────────────┘
                                      │  POST /api/scan/upload
                                      ▼  (X-Scan-Token, sans cookie)
                              panneau Instacode
```

1. **popup** : champ URL du panneau + jeton de scan (sauvegardés dans
   `chrome.storage.local`), bouton *Scanner mes abonnés*, zone de progression,
   bouton *Arrêter*.
2. **content.js** (monde isolé) : injecté sur l'onglet Instagram actif, injecte
   `injected.js` en **MAIN world**, relaie la progression vers le popup, puis
   **POST** les listes au panneau.
3. **injected.js** (MAIN world) : pagine le GraphQL web Instagram
   (followers puis following) avec pauses humaines et gestion du 429, puis
   renvoie `{id, username}`.

### Confidentialité
- Les cookies Instagram servent **uniquement** aux appels GraphQL même origine
  (dans `injected.js`).
- Le POST au panneau est fait **sans cookies** (`credentials: 'omit'`) : seules
  les listes `{id, username}` sont envoyées, avec le header `X-Scan-Token`.

---

## Installation (mode développeur)

1. Récupère le dossier `scan-extension/`.
2. Ouvre Chrome et va sur `chrome://extensions`.
3. Active le **Mode développeur** (interrupteur en haut à droite).
4. Clique sur **Charger l'extension non empaquetée** et sélectionne le dossier
   `scan-extension/`.
5. Épingle l'icône **Instacode Scan** dans la barre d'outils (icône puzzle).

---

## Utilisation pas à pas

1. Dans un onglet Chrome, ouvre `https://www.instagram.com` et **connecte-toi**
   à ton compte.
2. Connecte-toi au panneau Instacode et récupère ton jeton de scan
   (dashboard → endpoint `GET /api/scan/token`).
3. Ouvre le popup **Instacode Scan** (clic sur l'icône).
4. Vérifie l'**URL du panneau** (défaut `https://instacode-panel.onrender.com`)
   et **colle le jeton** dans le champ prévu.
5. Clique **Scanner mes abonnés**.
   - La progression s'affiche (abonnés / abonnements récupérés).
   - Le scan des abonnés est fait en premier, puis celui des abonnements.
   - Les pauses entre pages (0,8–1,5 s) et la reprise automatique après un 429
     ralentissent volontairement le rythme pour rester discret.
6. À la fin, l'extension envoie les listes au panneau et affiche le résultat.
   Tu peux à tout moment cliquer **Arrêter** (les résultats partiels ne sont
   **pas** envoyés).

> Garde le popup ouvert pour suivre la progression. Si tu le fermes, le scan et
> l'envoi continuent dans l'onglet ; rouvre le popup sur le même onglet pour
> retrouver l'état.

---

## Notes et limites

- **Session Instagram requise** : si tu es déconnecté ou si la session a expiré,
  le scan échoue avec un message clair — reconnecte-toi sur instagram.com.
- **URL de panneau personnalisée** : les `host_permissions` du manifest couvrent
  `https://instacode-panel.onrender.com/*`. Si tu changes l'URL vers un **autre
  hôte**, ajoute cet hôte à `host_permissions` dans `manifest.json` puis
  recharge l'extension.
- **Gros comptes** : rythme plafonné à ~200 pages / 15 min (pause automatique
  au-delà). Le scan d'un très gros compte peut donc prendre du temps.
- **Token stocké en local** : le jeton est conservé dans `chrome.storage.local`
  (propre à cette extension, sur cette machine), jamais transmis ailleurs qu'au
  panneau.

---

## Fichiers

| Fichier       | Rôle                                                            |
|---------------|-----------------------------------------------------------------|
| `manifest.json` | Manifest MV3 : permissions, host_permissions, popup, injected.js en web_accessible_resources. |
| `popup.html`    | Interface (URL, jeton, progression, arrêt).                     |
| `popup.js`      | Logique du popup, sauvegarde config, messages runtime.          |
| `content.js`    | Content script : injection MAIN world, relais, POST au panneau. |
| `injected.js`   | Script MAIN world : pagination GraphQL followers/following.     |
| `icons/`        | Icônes 16/48/128 px.                                            |
