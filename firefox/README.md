# Instacode Scan — extension Firefox

Extension Firefox (Manifest V3, compatible Gecko) qui scanne **tes** abonnés et
abonnements Instagram **depuis ton navigateur** (ta session, ton IP) puis envoie
le résultat au panneau Instacode. Aucune dépendance, JavaScript pur.

> **Pourquoi dans le navigateur ?** Le scan tourne sur `www.instagram.com` avec ta
> propre session connectée : c'est le moyen le plus discret et le plus fiable
> (pas d'IP datacenter, pas de risque de flag serveur).

## Différences avec la version Chrome

Le code applicatif (`popup.js`, `content.js`, `injected.js`) est identique à la
version Chrome, à une exception près : un **shim cross-navigateur** en tête de
`popup.js` et `content.js` :

```js
const browser = globalThis.browser ?? globalThis.chrome;
```

Firefox expose le namespace `browser` (WebExtensions, basé Promises) **et** un
alias `chrome` (avec callbacks) ; Chrome n'expose que `chrome`. Tous les appels
d'API sont écrits en style Promise (`await` / `.catch`), donc ils fonctionnent
avec les deux namespaces sans modification.

Le manifest diffère sur les points propres à Gecko :

| Élément | Chrome | Firefox |
|---|---|---|
| `browser_specific_settings.gecko.id` | — | `instacode-scan@instacode.local` |
| `browser_specific_settings.gecko.strict_min_version` | — | `115.0` |
| `permissions` | `storage`, `scripting` | `storage`, `scripting`, `activeTab` |
| `web_accessible_resources.matches` | présent | **exigé** (déjà présent) |
| `background` | absent | absent (pas de `service_worker` en MV3 Gecko) |

Le reste (popup, `host_permissions` Instagram + panneau, `web_accessible_resources`
avec `matches: ["*://*.instagram.com/*"]`) est identique.

## Fonctionnement

```
┌──────────┐  click « Scanner »   ┌────────────┐  <script src=injected.js>   ┌─────────────┐
│  popup   │ ───────────────────▶ │ content.js │ ──────────────────────────▶ │ injected.js │
│ (browser)│  messages runtime    │ (isolated) │  postMessage (MAIN world)   │  (MAIN world)│
└──────────┘ ◀─────────────────── └────────────┘ ◀────────────────────────── └─────────────┘
                                     │  POST /api/scan/upload
                                     ▼  (X-Scan-Token, sans cookie)
                             panneau Instacode
```

1. **popup** : champ URL du panneau + jeton de scan (sauvegardés dans
   `browser.storage.local`), bouton *Scanner mes abonnés*, zone de progression,
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

## Installation (Firefox)

L'extension n'est **pas signée** (pas de soumission AMO) : Firefox refuse
d'installer de façon permanente un `.xpi` non signé en version stable. Trois
options :

### Option A — Load Temporary Add-on (la plus simple, pour tester)

1. Récupère le dossier `scan-extension-firefox/` (ou l'archive
   `instacode-scan-firefox.xpi` décompressée).
2. Ouvre Firefox et va sur `about:debugging#/runtime/this-firefox`.
3. Clique **Charger un module temporaire** (Load Temporary Add-on).
4. Sélectionne le fichier `manifest.json` du dossier (ou de l'archive
   décompressée).
5. L'extension est active **jusqu'à la fermeture de Firefox** (il faudra la
   recharger à chaque session).

> Le module temporaire reste chargé tant que Firefox tourne. Pour un usage
> quotidien, préfère l'option B.

### Option B — Firefox Developer Edition / Nightly (permanent, non signé)

1. Installe **Firefox Developer Edition** (ou Nightly).
2. Va sur `about:config` et passe `xpinstall.signatures.required` à `false`.
3. Installe l'`.xpi` (`instacode-scan-firefox.xpi`) : Firefox l'accepte alors de
   façon permanente.

### Option C — Signature AMO (installation permanente en version stable)

Soumets l'extension sur [addons.mozilla.org](https://addons.mozilla.org/) pour
obtenir une signature, puis distribue l'`.xpi` signé. C'est la seule voie pour
une installation permanente sur Firefox stable sans désactiver la vérification
de signature.

## Utilisation pas à pas

1. Dans un onglet Firefox, ouvre `https://www.instagram.com` et **connecte-toi**
   à ton compte.
2. Connecte-toi au panneau Instacode et récupère ton jeton de scan
   (dashboard → endpoint `GET /api/scan/token`).
3. Ouvre le popup **Instacode Scan** (clic sur l'icône).
4. Vérifie l'**URL du panneau** (défaut `https://instacode-panel.onrender.com`)
   et **colle le jeton** dans le champ prévu.
5. Clique **Scanner mes abonnés**.
6. À la fin, l'extension envoie les listes au panneau et affiche le résultat.
   Tu peux à tout moment cliquer **Arrêter** (les résultats partiels ne sont
   **pas** envoyés).

> Garde le popup ouvert pour suivre la progression. Si tu le fermes, le scan et
> l'envoi continuent dans l'onglet ; rouvre le popup sur le même onglet pour
> retrouver l'état.

## Notes et limites

- **Session Instagram requise** : si tu es déconnecté ou si la session a expiré,
  le scan échoue avec un message clair — reconnecte-toi sur instagram.com.
- **URL de panneau personnalisée** : les `host_permissions` du manifest couvrent
  `https://instacode-panel.onrender.com/*`. Si tu changes l'URL vers un **autre
  hôte**, ajoute cet hôte à `host_permissions` dans `manifest.json` puis
  recharge l'extension.
- **Gros comptes** : rythme plafonné à ~200 pages / 15 min (pause automatique
  au-delà). Le scan d'un très gros compte peut donc prendre du temps.
- **Token stocké en local** : le jeton est conservé dans `browser.storage.local`
  (propre à cette extension, sur cette machine), jamais transmis ailleurs qu'au
  panneau.

## Fichiers

| Fichier       | Rôle                                                            |
|---------------|-----------------------------------------------------------------|
| `manifest.json` | Manifest MV3 Gecko : `browser_specific_settings.gecko`, permissions, popup, injected.js en web_accessible_resources. |
| `popup.html`    | Interface (URL, jeton, progression, arrêt).                     |
| `popup.js`      | Logique du popup (shim `browser`), sauvegarde config, messages runtime. |
| `content.js`    | Content script (shim `browser`) : injection MAIN world, relais, POST au panneau. |
| `injected.js`   | Script MAIN world : pagination GraphQL followers/following.     |
| `icons/`        | Icônes 16/48/128 px.                                            |
