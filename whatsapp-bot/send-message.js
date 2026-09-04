// Envoie un simple message texte WhatsApp à un numéro donné (Baileys, voir baileys-client.js) --
// utile pour tester l'envoi indépendamment de l'APK.
// Usage : node send-message.js <numero-international-sans-plus> <message> [--pair]
// Exemple    : node send-message.js 33622470182 "test claude"
// --pair : appairage par CODE À SAISIR (compte = <numero>) plutôt que par QR à scanner -- utile
// quand le QR est bien lu par la caméra mais ne déclenche rien côté WhatsApp (voir baileys-client.js).

const { connect, numberToJid } = require('./baileys-client');

const rawNumber = process.argv[2];
const message = process.argv[3];
const usePairing = process.argv.includes('--pair');
if (!rawNumber || !message) {
  console.error('Usage : node send-message.js <numero-international-sans-plus> <message> [--pair]');
  process.exit(1);
}
const jid = numberToJid(rawNumber);

(async () => {
  let sock;
  try {
    ({ sock } = await connect(usePairing ? rawNumber.replace(/[^0-9]/g, '') : undefined));
    // onWhatsApp() vérifie que le numéro a bien un compte WhatsApp AVANT d'envoyer (évite un
    // envoi silencieusement perdu vers un JID invalide).
    const [result] = await sock.onWhatsApp(jid);
    if (!result?.exists) {
      console.error(`Aucun compte WhatsApp trouvé pour le numéro ${rawNumber}.`);
      process.exitCode = 1;
      return;
    }
    console.log(`Envoi à ${result.jid}...`);
    const sent = await sock.sendMessage(result.jid, { text: message });
    if (!sent || !sent.key) {
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
