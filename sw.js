// ============================================================
// SERVICE WORKER â€” met en cache l'app (fichiers du jeu + Phaser) pour un lancement hors-ligne
// une fois installÃ©e. StratÃ©gie "cache d'abord, rÃ©seau en secours" : les fichiers du jeu changent
// rarement, autant Ã©viter un aller-retour rÃ©seau Ã  chaque lancement.
// ============================================================

// IncrÃ©menter ce numÃ©ro Ã  chaque changement notable du jeu : un appareil ayant dÃ©jÃ  installÃ© la
// PWA ne rÃ©cupÃ¨re PAS automatiquement les nouveaux fichiers tant que ce nom ne change pas (le
// cache "gagne" toujours contre le rÃ©seau avec la stratÃ©gie ci-dessous) â€” vÃ©cu pendant le
// dÃ©veloppement, oÃ¹ un ancien build restait servi malgrÃ© des fichiers sources Ã  jour.
const CACHE_NAME = 'migration-20260820162657';
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
      // Un par un plutÃ´t qu'en parallÃ¨le (Promise.all) : le petit serveur local du jeu
      // (serve.ps1) traite les requÃªtes une Ã  la fois sur une seule connexion et s'Ã©touffe
      // si le navigateur lui envoie d'un coup une dizaine de requÃªtes simultanÃ©es Ã 
      // l'installation. Un peu plus lent, mais fiable sur ce serveur comme sur un vrai
      // hÃ©bergement HTTPS.
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

  // Cache d'abord, sans revalidation rÃ©seau en arriÃ¨re-plan : une requÃªte rÃ©seau EN PLUS par
  // ressource (pour vÃ©rifier une mise Ã  jour) doublait la charge sur le petit serveur local du
  // jeu (une seule connexion traitÃ©e Ã  la fois) et le faisait se bloquer. Une mise Ã  jour des
  // fichiers du jeu se voit au prochain changement de CACHE_NAME (voir activate ci-dessus), pas
  // besoin de revalidation continue pour un jeu qui ne change pas pendant une partie.
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
