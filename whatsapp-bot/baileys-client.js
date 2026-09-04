// Connexion WhatsApp partagée (Baileys : implémentation directe du protocole multi-device par
// WebSocket, pas d'injection dans une page Chrome comme whatsapp-web.js -- remplace cette
// dernière suite à un échec silencieux constaté : sendMessage() renvoyait undefined au lieu
// d'envoyer réellement, la session locale se disait "CONNECTED" mais rien n'arrivait jamais côté
// destinataire, cf. l'historique de ce fichier). Session persistée dans .baileys_auth/ (jamais
// commitée, voir ../.gitignore) : le QR code n'est nécessaire qu'au premier lancement.
//
// connect() résout une fois la connexion réellement établie ('open'), avec le socket ET le JID du
// compte connecté déjà normalisé (sans le suffixe ":<device>" que Baileys ajoute à son propre id).
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const pino = require('pino');
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require('@whiskeysockets/baileys');

// pairingPhoneNumber : numéro international sans "+" -- si fourni ET la session n'est pas encore
// enregistrée, demande un CODE À SAISIR sur le téléphone (WhatsApp > Appareils connectés > Lier
// un appareil > "Lier avec le numéro de téléphone à la place") plutôt qu'un QR à scanner. Ajouté
// après un QR qui restait sans effet une fois scanné (rien ne se déclenche côté WhatsApp) --
// méthode d'appairage indépendante de la caméra/de l'image, donc utile pour isoler le problème.
async function connect(pairingPhoneNumber) {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '.baileys_auth'));
  const { version } = await fetchLatestBaileysVersion();
  // Après un appairage réussi (QR scanné ou code saisi), WhatsApp ferme la connexion une première
  // fois avec le code 515 ("restartRequired") -- comportement normal du protocole, pas un échec :
  // il faut juste se reconnecter une fois (les identifiants viennent d'être sauvegardés via
  // creds.update ci-dessous) pour que la connexion suivante aboutisse à 'open'. Sans ce retry,
  // un appairage par ailleurs réussi remontait comme une erreur (vécu pour de vrai).
  let restarted = false;

  return new Promise((resolve, reject) => {
    const sock = makeWASocket({
      auth: state,
      version,
      logger: pino({ level: 'silent' }),
      // On affiche notre propre QR (voir plus bas, en PNG pour être montré directement) plutôt
      // que celui ASCII imprimé par défaut dans le terminal -- ignoré si pairingPhoneNumber est
      // fourni (code à saisir à la place, voir plus bas).
      printQRInTerminal: false,
    });

    sock.ev.on('creds.update', saveCreds);

    if (pairingPhoneNumber && !state.creds.registered) {
      // Léger délai : demander le code trop tôt (avant l'ouverture effective du WebSocket) peut
      // échouer côté Baileys -- laisse la connexion s'établir d'abord.
      setTimeout(async () => {
        try {
          const code = await sock.requestPairingCode(pairingPhoneNumber);
          console.log(`Code d'appairage : ${code} -- à saisir sur le téléphone (WhatsApp > Appareils connectés > Lier un appareil > "Lier avec le numéro de téléphone à la place").`);
        } catch (err) {
          console.error('Échec de la demande de code d\'appairage :', err.message);
        }
      }, 2000);
    }

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;
      if (qr && !pairingPhoneNumber) {
        const qrPath = path.join(__dirname, 'qr.png');
        const tmpPath = `${qrPath}.tmp`;
        try {
          // width plus grand + correction d'erreur maximale ("H") : le téléphone scanne une PHOTO
          // D'ÉCRAN de ce PNG (affiché dans le chat), pas le fichier en direct -- plus de marge
          // pour rester lisible malgré la recompression/le moiré introduits par ce détour (demande
          // utilisateur explicite : "le QR ne semble pas etre vus par la camera").
          await QRCode.toFile(tmpPath, qr, { width: 800, errorCorrectionLevel: 'H', margin: 3 });
          fs.renameSync(tmpPath, qrPath);
          console.log(`QR code écrit dans ${qrPath} -- scanne-le depuis WhatsApp > Appareils connectés.`);
        } catch (err) {
          console.error('Écriture du QR échouée (nouvelle tentative au prochain QR émis) :', err.message);
        }
      }
      if (connection === 'open') {
        // sock.user.id ressemble à "33622470182:12@s.whatsapp.net" (suffixe d'appareil) -- il faut
        // le retirer pour obtenir le JID de chat "Vous" habituel.
        const rawId = sock.user.id;
        const selfJid = rawId.includes(':') ? `${rawId.split(':')[0]}@s.whatsapp.net` : rawId;
        resolve({ sock, selfJid });
      } else if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const loggedOut = statusCode === DisconnectReason.loggedOut;
        if (loggedOut) {
          reject(new Error('Session révoquée (déconnectée depuis le téléphone) -- il faut rescanner un QR.'));
        } else if (statusCode === DisconnectReason.restartRequired && !restarted) {
          restarted = true;
          console.log('Appairage réussi, reconnexion (redémarrage requis par WhatsApp)...');
          connect(pairingPhoneNumber).then(resolve, reject);
        } else {
          reject(new Error(`Connexion fermée avant d'être prête (code ${statusCode}).`));
        }
      }
    });
  });
}

// Numéro international sans "+" (ex. "33622470182") -> JID de discussion individuelle.
function numberToJid(number) {
  return `${number.replace(/[^0-9]/g, '')}@s.whatsapp.net`;
}

module.exports = { connect, numberToJid };
