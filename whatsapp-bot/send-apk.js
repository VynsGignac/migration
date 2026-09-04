// Envoie l'APK de Migration (voir ../build-apk.ps1) sur WhatsApp via une session perso (Baileys,
// pas l'API officielle) -- premier lancement : un QR code est écrit dans qr.png à scanner depuis
// le téléphone (WhatsApp > Appareils connectés). La session est ensuite conservée dans
// .baileys_auth/ (jamais commitée, voir ../.gitignore).
//
// Usage : node send-apk.js [chemin-vers-l-apk]  (par défaut : ../Migration-debug.apk)
// Cible : envoie dans la conversation "Vous" (le propre numéro WhatsApp du compte connecté).

const fs = require('fs');
const path = require('path');
const { connect } = require('./baileys-client');

const apkPath = path.resolve(__dirname, process.argv[2] || '../Migration-debug.apk');
if (!fs.existsSync(apkPath)) {
  console.error(`APK introuvable : ${apkPath}`);
  process.exit(1);
}

let versionLabel = '';
try {
  const versionJs = fs.readFileSync(path.join(__dirname, '../js/version.js'), 'utf8');
  const m = versionJs.match(/const GameVersion = '([^']*)'/);
  if (m) versionLabel = ` v${m[1]}`;
} catch { /* étiquette de version facultative, l'envoi ne dépend pas d'elle */ }

(async () => {
  let sock;
  try {
    ({ sock } = await connect());
    const selfJid = sock.user.id.includes(':') ? `${sock.user.id.split(':')[0]}@s.whatsapp.net` : sock.user.id;
    console.log(`Envoi de ${path.basename(apkPath)}${versionLabel} à ${selfJid}...`);
    const sent = await sock.sendMessage(selfJid, {
      document: fs.readFileSync(apkPath),
      fileName: path.basename(apkPath),
      mimetype: 'application/vnd.android.package-archive',
      caption: `Migration${versionLabel}`,
    });
    if (!sent || !sent.key) {
      // sock.sendMessage() résout normalement toujours avec le message envoyé -- un retour vide
      // signalerait un échec silencieux (déjà vécu avec whatsapp-web.js, voir baileys-client.js) :
      // on préfère planter bruyamment plutôt que d'afficher "Envoyé." à tort.
      throw new Error('sendMessage a résolu sans retourner de message (échec probable, rien envoyé).');
    }
    console.log('Envoyé (id message :', sent.key.id, ').');
  } catch (err) {
    console.error('Échec de l\'envoi :', err);
    process.exitCode = 1;
  } finally {
    if (sock) sock.end();
    process.exit(process.exitCode || 0);
  }
})();
