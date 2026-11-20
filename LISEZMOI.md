# Vente Mobile v2.2 — mise à jour et mise en service

## Passer de la v2.1 à la v2.2
1. GitHub : remplacez **tous** les fichiers sauf `config.js` (dont `index.html`, `sw.js`, `firestore.rules`).
2. Firestore → **Règles** : recollez le contenu de `firestore.rules` → **Publier** (nécessaire pour l'archivage et la restauration).
3. Sur chaque téléphone : fermez et rouvrez l'application **deux fois**. À partir de cette version, les mises à jour suivantes
   s'annonceront d'elles-mêmes par un bandeau « Nouvelle version disponible — Recharger ».

## A. Mettre à jour depuis la version 1 (votre cas)

1. **GitHub** : remplacez tous les fichiers du dépôt par ceux de ce dossier
   (*Add file → Upload files*), **sauf `config.js`** : gardez le vôtre, déjà rempli.
   Nouveaux fichiers à ne pas oublier : `fb.js`, `util.js`, `ui.js`, `print.js`, `export.js`.
2. **Devenir administrateur** (une seule fois, avant l'étape 3) :
   Console Firebase → Firestore Database → collection **users** → ouvrez **votre** document
   (celui qui contient votre e-mail) → **Ajouter un champ** :
   - `active` — type **boolean** — valeur **true**
   - `role` — type **string** — valeur **admin**
3. **Nouvelles règles de sécurité** : Firestore Database → onglet **Règles** →
   remplacez tout par le contenu du fichier `firestore.rules` → **Publier**.
4. Sur chaque téléphone : ouvrez l'application, fermez-la complètement, rouvrez-la (pour charger la nouvelle version).
5. Les autres vendeurs verront « Compte en attente » : activez-les dans **Plus → Utilisateurs**
   (et donnez à chacun un **préfixe différent** : K, M, Y…).

## B. Nouvelle installation (projet Firebase vide)
Même procédure que la v1 (Authentication e-mail/mot de passe, Firestore, `config.js`, GitHub Pages,
domaine autorisé), puis publiez `firestore.rules`.
**Le tout premier compte qui se connecte devient automatiquement administrateur.**
Les suivants sont « en attente » jusqu'à activation par l'administrateur.

## C. Imprimante POS L58 en Bluetooth direct (sans RawBT)
1. **Fermez RawBT** et, dans les réglages Bluetooth d'Android, **dissociez** la L58 si elle y est appairée
   (une imprimante ne peut être connectée qu'à une seule application à la fois).
2. Bluetooth et **Localisation** du téléphone activés.
3. Application → **Plus → Configuration → Imprimante** → « Bluetooth direct » → **Choisir l'imprimante**
   → sélectionnez la L58 dans la liste.
4. **Ticket de test**. Si le ticket est coupé : « Taille des paquets » = 20. Accents illisibles : « Sans accents ».
5. Chrome peut redemander le choix de l'imprimante après un redémarrage du téléphone : c'est normal, un appui suffit.
RawBT reste disponible en secours (Configuration → Mode d'impression).

## D. Rôles
| | Vendeur | Administrateur |
|---|---|---|
| Bons, versements, achats, clients, produits | ✓ | ✓ |
| Modifier un bon / un achat | les siens | tous |
| Annuler bon, versement, achat | — | ✓ |
| Changer un solde de départ, supprimer un produit | — | ✓ |
| Configuration entreprise, utilisateurs, journal, vérification, sauvegarde | — | ✓ |

Ces droits sont **contrôlés par le serveur** (règles Firestore), pas seulement par l'écran.

## E. Bonnes pratiques
- **Sauvegarde chaque semaine** : Plus → Sauvegarde → Excel + sauvegarde complète. Gardez les fichiers sur Google Drive.
- **Vérifier les soldes** de temps en temps (Plus → Vérifier les soldes), avec Internet.
- Indicateur en haut à droite : ✓ tout est envoyé · ⏳ n en cours · ⚠ hors ligne (les opérations sont gardées sur le téléphone).
  Ne désinstallez pas l'application et ne videz pas les données de Chrome tant qu'il reste des opérations en attente.
- **Téléphone perdu** : Console Firebase → Authentication → utilisateur → **Désactiver le compte**,
  et dans l'application Plus → Utilisateurs → décochez « Compte actif ».
- **Code PIN** (Configuration) : conseillé sur chaque téléphone.

## F. Mettre à jour l'application plus tard
Remplacez les fichiers sur GitHub, puis dans `sw.js` augmentez le numéro de version (ex. `ventemobile-v4` → `ventemobile-v5`).
⚠ **Indispensable** : sans ce changement, les téléphones gardent l'ancienne version (elle est conservée pour fonctionner hors ligne).
