// ============================================================
// SERVICE WORKER — met en cache l'app (fichiers du jeu + Phaser) pour un lancement hors-ligne
// une fois installée. Stratégie "cache d'abord, réseau en secours" : les fichiers du jeu changent
// rarement, autant éviter un aller-retour réseau à chaque lancement.
// ============================================================

// Ce numéro est désormais généré automatiquement à chaque publication (voir publish-web.ps1,
// horodatage) plutôt que changé à la main : un appareil ayant déjà installé la PWA ne récupère
// PAS automatiquement les nouveaux fichiers tant que ce nom ne change pas (le cache "gagne"
// toujours contre le réseau avec la stratégie ci-dessous) — vécu pour de vrai en développement,
// où plusieurs mises à jour de suite sont restées invisibles sur le site tant que ce n'était pas
// automatisé.
const CACHE_NAME = 'migration-20260829231827';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './js/vendor/phaser.min.js',
  './js/config.js',
  './js/HexUtils.js',
  './js/GameState.js',
  './js/Monsters.js',
  './js/GameScene.js',
  './js/main.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Un par un plutôt qu'en parallèle (Promise.all) : le petit serveur local du jeu
      // (serve.ps1) traite les requêtes une à la fois sur une seule connexion et s'étouffe
      // si le navigateur lui envoie d'un coup une dizaine de requêtes simultanées à
      // l'installation. Un peu plus lent, mais fiable sur ce serveur comme sur un vrai
      // hébergement HTTPS.
      for (const url of ASSETS) {
        await cache.add(url).catch(() => {});
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Cache d'abord, sans revalidation réseau en arrière-plan : une requête réseau EN PLUS par
  // ressource (pour vérifier une mise à jour) doublait la charge sur le petit serveur local du
  // jeu (une seule connexion traitée à la fois) et le faisait se bloquer. Une mise à jour des
  // fichiers du jeu se voit au prochain changement de CACHE_NAME (voir activate ci-dessus), pas
  // besoin de revalidation continue pour un jeu qui ne change pas pendant une partie.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
