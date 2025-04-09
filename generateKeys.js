import { generateKey } from "openpgp";
import config from "./config.json" with { type: "json" };

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