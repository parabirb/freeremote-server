import config from "./config.js";
import { generateKey } from "openpgp";

const { publicKey, privateKey } = await generateKey({
    curve: "ed25519",
    userIDs: [
        {
            name: config.clubName,
            email: config.clubEmail
        }
    ],
    format: "armored"
});

console.log(`Public key: ${JSON.stringify(publicKey)}

Private key: ${JSON.stringify(privateKey)}`);