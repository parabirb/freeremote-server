/**
 Generate the PGP key pair used to sign and verify station keys.
 
 Run with `npm run generate-keys`, then copy the printed keys into the
 `publicKey` and `privateKey` fields of `config.js`.
 */
import {generateKey} from 'openpgp';
import config from '../config.js';

const {publicKey, privateKey} = await generateKey({
    curve: 'ed25519Legacy',
    // eslint-disable-next-line @typescript-eslint/naming-convention -- openpgp option name.
    userIDs: [{name: config.clubName, email: config.clubEmail}],
    format: 'armored',
});

// Printed as JSON strings so they can be pasted straight into `config.js`.
console.log(`Public key: ${JSON.stringify(publicKey)}

Private key: ${JSON.stringify(privateKey)}`);
