# Instacode Scan — Extension navigateur

Extension qui scanne tes followers et tes abonnements **directement dans ton navigateur** (ta session, ton IP), puis envoie le résultat au panneau Instacode. Aucun scan depuis le serveur → plus de risque de vérification Instagram lié au scan.

## Versions

- **`chrome/`** — extension Google Chrome / Edge / Brave (Manifest V3, mode développeur).
- **`firefox/`** — extension Mozilla Firefox (Manifest V3 + Gecko).

## Installation

### Chrome / Edge / Brave
1. Ouvre `chrome://extensions` (ou `edge://extensions`).
2. Active **Mode développeur**.
3. **Charger l'extension non empaquetée** → sélectionne le dossier `chrome/`.

### Firefox
Voir `firefox/README.md` (trois voies : module temporaire `about:debugging`, Developer Edition, ou signature AMO pour un install permanent).

## Utilisation
1. Connecte-toi au panneau Instacode et copie ton **token** (bloc « Scan navigateur »).
2. Connecte-toi à instagram.com dans ce même navigateur.
3. Clique l'icône Instacode Scan → colle le token (une seule fois) → **Scanner mes abonnés**.
4. Le résultat apparaît dans le dashboard.

## Notes
- L'extension n'envoie **jamais** tes cookies Instagram au panneau — uniquement les listes `{id, username}`.
- Rythme de scan « humain » (pauses aléatoires + gestion du rate-limit).
