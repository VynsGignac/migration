// Diagnostic : vérifie que le PNG du QR généré correspond BIEN, une fois redécodé, à la chaîne
// brute émise par Baileys -- pour écarter un bug dans la génération de l'image elle-même (la
// caméra du téléphone "voit" le QR mais ça ne déclenche rien dans WhatsApp : soit l'image encode
// autre chose que prévu, soit le format du payload lui-même pose problème).
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const jsQR = require('jsqr');
const { PNG } = require('pngjs');
const { useMultiFileAuthState, fetchLatestBaileysVersion, default: makeWASocket } = require('@whiskeysockets/baileys');
const pino = require('pino');

(async () => {
  const { state, saveCreds } = await useMultiFileAuthState(path.join(__dirname, '.baileys_auth'));
  const { version, isLatest } = await fetchLatestBaileysVersion();
  console.log('Version WA utilisée par Baileys :', version, 'isLatest:', isLatest);

  const sock = makeWASocket({ auth: state, version, logger: pino({ level: 'silent' }), printQRInTerminal: false });
  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    if (update.qr) {
      const qr = update.qr;
      console.log('--- QR brut (longueur', qr.length, ') ---');
      console.log(qr);
      console.log('--- segments (séparateur ",") ---');
      console.log(qr.split(',').map((s, i) => `[${i}] len=${s.length}`));

      const pngPath = path.join(__dirname, 'diag-qr.png');
      await QRCode.toFile(pngPath, qr, { width: 800, errorCorrectionLevel: 'H', margin: 3 });

      const png = PNG.sync.read(fs.readFileSync(pngPath));
      const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
      if (!decoded) {
        console.log('DÉCODAGE ÉCHOUÉ : jsQR ne parvient pas à relire le PNG généré (bug de génération confirmé).');
      } else {
        const matches = decoded.data === qr;
        console.log('Décodage réussi. Correspond exactement à la chaîne brute :', matches);
        if (!matches) {
          console.log('Décodé :', decoded.data);
        }
      }
      process.exit(0);
    }
    if (update.connection === 'close') {
      console.log('Connexion fermée avant réception d\'un QR.');
      process.exit(1);
    }
  });
})();
