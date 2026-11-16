# VenteMobile — mise en service

## 1. Créer le projet Firebase (gratuit)
1. Aller sur https://console.firebase.google.com → **Ajouter un projet** (Google Analytics : inutile).
2. **Authentication** → Commencer → activer **E-mail/Mot de passe**.
3. **Authentication → Utilisateurs → Ajouter un utilisateur** : créer un compte (e-mail + mot de passe) pour chacun des 5 vendeurs.
4. **Firestore Database** → Créer une base de données (mode production, région `europe-west`).
5. Onglet **Règles** de Firestore : remplacer le contenu par celui du fichier `firestore.rules`, puis **Publier**.
6. **Paramètres du projet** (roue dentée) → **Vos applications** → icône **</>** (Web) → donner un nom → copier le bloc `firebaseConfig`.
7. Coller ces valeurs dans le fichier **config.js**.

## 2. Mettre l'application en ligne (gratuit) — GitHub Pages
1. Créer un compte sur https://github.com, puis **New repository** (public), nom par ex. `ventemobile`.
2. **Add file → Upload files** : envoyer tous les fichiers du dossier (y compris le dossier `icons`).
3. **Settings → Pages** → Source : *Deploy from a branch*, branche `main`, dossier `/ (root)` → Save.
4. Après 1-2 minutes, l'adresse s'affiche, par ex. `https://votrenom.github.io/ventemobile/`.
5. Dans Firebase : **Authentication → Paramètres → Domaines autorisés** → ajouter `votrenom.github.io`.

## 3. Installer sur chaque téléphone Android
1. Ouvrir l'adresse dans **Chrome** → se connecter.
2. Menu ⋮ → **Ajouter à l'écran d'accueil / Installer l'application**.
3. Chaque vendeur va dans **Plus → Configuration → Mon profil** : son nom et un **préfixe différent** (ex. K, M, Y…) pour la numérotation des bons.

## 4. Imprimante POS L58
1. Appairer l'imprimante en Bluetooth dans les réglages Android.
2. Installer **RawBT** (Play Store), choisir l'imprimante dans RawBT.
3. Dans l'application : **Plus → Configuration → Ticket de test**.
   - Si les accents s'impriment mal, laisser « Sans accents ».

## À savoir
- **Hors ligne** : tout continue de fonctionner ; les données partent dès le retour d'Internet (badge orange « Hors ligne » en haut).
- **Première connexion** d'un téléphone : Internet obligatoire.
- **Mise à jour** de l'application : remplacer les fichiers sur GitHub, puis changer `ventemobile-v1` en `v2` dans `sw.js`.
- **Traçabilité** : rien n'est supprimé. Un bon, un achat ou un versement modifié/annulé reste visible avec la mention et l'ancienne version.
