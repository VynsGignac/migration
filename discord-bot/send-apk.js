// Envoie l'APK de Migration (voir ../build-apk.ps1) dans un salon Discord via un webhook officiel
// (aucune session/QR nécessaire, contrairement à whatsapp-bot/ -- juste une requête HTTP signée
// par l'URL du webhook, elle-même le secret : voir webhook-url.txt, jamais commité).
//
// Usage : node send-apk.js [chemin-vers-l-apk] [--message-file <chemin-vers-un-.txt>]
// --message-file : contenu (le changelog de cette version) à joindre au message -- passé par
// fichier plutôt qu'en argument direct pour éviter tout souci d'échappement multi-lignes/guillemets
// côté PowerShell (demande utilisateur explicite : associer la description des évolutions à
// chaque envoi, comme le message habituel donné en fin de tâche).

const fs = require('fs');
const path = require('path');

const rawArgs = process.argv.slice(2);
const messageFileIdx = rawArgs.indexOf('--message-file');
const messageFilePath = messageFileIdx !== -1 ? rawArgs[messageFileIdx + 1] : null;
// Retire "--message-file <chemin>" pour ne garder que l'argument positionnel (le chemin de l'APK).
const positionalArgs = messageFileIdx !== -1
  ? [...rawArgs.slice(0, messageFileIdx), ...rawArgs.slice(messageFileIdx + 2)]
  : rawArgs;

const apkPath = path.resolve(__dirname, positionalArgs[0] || '../Migration-debug.apk');
if (!fs.existsSync(apkPath)) {
  console.error(`APK introuvable : ${apkPath}`);
  process.exit(1);
}

const changelog = messageFilePath ? fs.readFileSync(path.resolve(messageFilePath), 'utf8').trim() : '';

const webhookUrl = fs.readFileSync(path.join(__dirname, 'webhook-url.txt'), 'utf8').trim();
if (!webhookUrl) {
  console.error('webhook-url.txt est vide -- colle l\'URL du webhook Discord dedans.');
  process.exit(1);
}

let versionLabel = '';
try {
  const versionJs = fs.readFileSync(path.join(__dirname, '../js/version.js'), 'utf8');
  const m = versionJs.match(/const GameVersion = '([^']*)'/);
  if (m) versionLabel = ` v${m[1]}`;
} catch { /* étiquette de version facultative */ }

(async () => {
  const fileBuffer = fs.readFileSync(apkPath);
  const form = new FormData();
  const content = changelog ? `**Migration${versionLabel}**\n${changelog}` : `Migration${versionLabel}`;
  form.append('content', content);
  form.append(
    'file',
    new Blob([fileBuffer], { type: 'application/vnd.android.package-archive' }),
    path.basename(apkPath)
  );

  console.log(`Envoi de ${path.basename(apkPath)}${versionLabel} (${(fileBuffer.length / 1024 / 1024).toFixed(1)} Mo)...`);
  const res = await fetch(webhookUrl, { method: 'POST', body: form });
  if (!res.ok) {
    const body = await res.text();
    console.error(`Échec de l'envoi (HTTP ${res.status}) :`, body);
    process.exit(1);
  }
  console.log('Envoyé.');
})();
