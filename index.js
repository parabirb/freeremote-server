// deps
import Joi from "joi";
import audify from "audify";
import xmlrpc from "xmlrpc";
import * as ft8 from "ft8js";
import ngrok from "@ngrok/ngrok";
import config from "./config.js";
import { Server } from "socket.io";
import { JSONFilePreset } from "lowdb/node";
import { SlashCommandBuilder } from "@discordjs/builders";
import {
    readKey,
    readPrivateKey,
    readCleartextMessage,
    createCleartextMessage,
    sign,
    verify,
} from "openpgp";
import {
    REST,
    Routes,
    Client,
    AttachmentBuilder,
    GatewayIntentBits,
} from "discord.js";

// get the db
const db = await JSONFilePreset("database.json", { users: [] });

// read the pgp keys
const publicKey = await readKey({ armoredKey: config.publicKey });
const privateKey = await readPrivateKey({ armoredKey: config.privateKey });

// state
let state = {
    transmitting: false,
    mode: "voice",
};
let currentSocket;

// xmlrpc clients
const flrigClient = xmlrpc.createClient({
    host: "127.0.0.1",
    port: config.flrigPort,
});
const fldigiClient = xmlrpc.createClient({
    host: "127.0.0.1",
    port: config.fldigiPort,
});

// shutdown function
async function shutdown() {
    console.log("Shutting down...");
    if (currentSocket) currentSocket.disconnect();
    await asyncRpc(flrigClient, "rig.set_ptt", [0]);
    process.exit(0);
}

// promisify callback
function asyncRpc(client, method, params = []) {
    return new Promise((resolve) => {
        client.methodCall(method, params, (err, val) => {
            if (err) throw err;
            resolve(val);
        });
    });
}

// get the current vfo and max pwr
state.frequency = +(await asyncRpc(flrigClient, "rig.get_vfo")) / 10;
state.maxpwr = +(await asyncRpc(flrigClient, "rig.get_maxpwr"));

// verify operating privileges function
function verifyPrivileges() {
    // find the band the user is in
    const band = Object.values(config.bands).find(
        (band) =>
            band.edges[0] <= state.frequency && band.edges[1] > state.frequency
    );
    if (!band) return false;
    return (
        (state.currentUser.license === "extra" ||
            (state.currentUser.license === "general" &&
                band.privileges.general.find(
                    (privilege) =>
                        privilege[0] <= state.frequency &&
                        privilege[1] > state.frequency
                )) ||
            (state.currentUser.license === "technician" &&
                band.privileges.technician &&
                band.privileges.technician.find(
                    (privilege) =>
                        privilege[0] <= state.frequency &&
                        privilege[1] > state.frequency
                ))) &&
        ((state.mode === "voice" &&
            band.voice[0] <= state.frequency &&
            band.voice[1] > state.frequency) ||
            state.mode !== "voice")
    );
}

// discord client
const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds],
});

const addUserCommand = new SlashCommandBuilder()
    .setName("adduser")
    .setDescription("Add a user to the whitelist.")
    .addUserOption((option) =>
        option
            .setName("user")
            .setDescription("The user to whitelist.")
            .setRequired(true)
    )
    .addStringOption((option) =>
        option
            .setName("license")
            .setDescription("The type of license.")
            .setRequired(true)
            .addChoices(
                {
                    name: "Amateur Extra",
                    value: "extra",
                },
                {
                    name: "General",
                    value: "general",
                },
                {
                    name: "Technician",
                    value: "technician",
                }
            )
    )
    .addStringOption((option) =>
        option
            .setName("callsign")
            .setDescription("The callsign of the licensee.")
            .setRequired(true)
    );

const delUserCommand = new SlashCommandBuilder()
    .setName("deluser")
    .setDescription("Remove a user from the whitelist.")
    .addStringOption((option) =>
        option
            .setName("user")
            .setDescription("The ID of the user to be removed.")
            .setRequired(true)
    );

const requestKeyCommand = new SlashCommandBuilder()
    .setName("requestkey")
    .setDescription("Request a key to the remote station.");

const shutdownCommand = new SlashCommandBuilder()
    .setName("shutdown")
    .setDescription("Shut down the server.");

const inUseCommand = new SlashCommandBuilder()
    .setName("inuse")
    .setDescription(
        "Returns information on whether the station is in use or not."
    );

discordClient.on("interactionCreate", async (interaction) => {
    try {
        // return if not command
        if (!interaction.isCommand()) return;

        // defer the reply so discord doesn't time out on us
        await interaction.deferReply({ ephemeral: true });

        // get the command name
        const command = interaction.commandName;

        // add user command
        if (command === "adduser") {
            // return if the user isn't an admin
            if (!config.admins.includes(interaction.user.id)) {
                await interaction.editReply({
                    content: "You are not authorized to run this command!",
                });
                return;
            }
            // get the user to be added :3
            const toAdd = interaction.options.getUser("user").id;
            // return if the user to be added is already in the db
            if (
                db.data.users.filter((user) => user.id === toAdd).length !== 0
            ) {
                await interaction.editReply({
                    content: "This user is already in the whitelist!",
                });
                return;
            }
            await db.update(({ users }) =>
                users.push({
                    id: toAdd,
                    callsign: interaction.options.getString("callsign"),
                    license: interaction.options.getString("license"),
                    logbook: [],
                })
            );
            await interaction.editReply({
                content: "This user has been added to the whitelist.",
            });
        }
        // del user command
        else if (command === "deluser") {
            // return if the user isn't an admin
            if (!config.admins.includes(interaction.user.id)) {
                await interaction.editReply({
                    content: "You are not authorized to run this command!",
                });
                return;
            }
            // get the id of the user to be deleted
            const toDelete = db.data.users.find(
                (user) => user.id === interaction.options.getString("user")
            );
            if (!toDelete) {
                await interaction.editReply({
                    content: "User is not in the database.",
                });
                return;
            }
            await db.update(({ users }) =>
                users.splice(users.indexOf(toDelete), 1)
            );
            await interaction.editReply({
                content: "User has been deleted from the whitelist.",
            });
        }
        // request key command
        else if (command === "requestkey") {
            // get the user requesting the thingy
            const user = db.data.users.find(
                (user) => user.id === interaction.user.id
            );
            // return if user isn't in the db
            if (!user) {
                await interaction.editReply({
                    content: "You are not in the whitelist.",
                });
                return;
            }
            const message = await createCleartextMessage({
                text: JSON.stringify({
                    callsign: user.callsign,
                    license: user.license,
                    id: user.id,
                    url: state.url,
                    expiration: Date.now() + config.keyExpiry * 1000,
                }),
            });
            const signed = await sign({
                message,
                signingKeys: privateKey,
            });
            await interaction.editReply({
                content: "Below is your key.",
                files: [
                    new AttachmentBuilder(Buffer.from(signed)).setName(
                        `${user.callsign}-${Date.now()}.txt`
                    ),
                ],
            });
        }
        // shutdown command
        else if (command === "shutdown") {
            // return if the user isn't an admin
            if (!config.admins.includes(interaction.user.id)) {
                await interaction.editReply({
                    content: "You are not authorized to run this command!",
                });
                return;
            }
            await interaction.editReply({
                content: "Shutting down.",
            });
            shutdown();
        }
        // in use command
        else if (command === "inuse") {
            if (!state.currentUser) {
                await interaction.editReply({
                    content: "The station is not in use right now.",
                });
            } else {
                await interaction.editReply({
                    content: `The station is currently being used by <@${state.currentUser.id}> (${state.currentUser.callsign}).`,
                });
            }
        }
    } catch (e) {
        console.log(e);
    }
});

const rest = new REST().setToken(config.discordToken);

await rest.put(
    Routes.applicationGuildCommands(config.applicationId, config.guildId),
    {
        body: [
            addUserCommand,
            delUserCommand,
            requestKeyCommand,
            shutdownCommand,
            inUseCommand,
        ],
    }
);

async function log(message) {
    discordClient.channels.cache.get(config.loggingChannel).send(message);
}

await discordClient.login(config.discordToken);

// rtAudio
const rtAudio = new audify.RtAudio();

// socket.io server
const io = new Server(config.port);

// create opus encoder
const opusEncoder = new audify.OpusEncoder(
    config.sampleRate,
    1,
    audify.OpusApplication.OPUS_APPLICATION_AUDIO
);
const opusDecoder = new audify.OpusDecoder(
    config.sampleRate,
    1,
    audify.OpusApplication.OPUS_APPLICATION_AUDIO
);

// create audio stream
const frameSize = (config.frameSize / 1000) * config.sampleRate;
rtAudio.openStream(
    {
        deviceId: config.audioOutput,
        nChannels: 1,
    },
    {
        deviceId: config.audioInput,
        nChannels: 1,
    },
    audify.RtAudioFormat.RTAUDIO_FLOAT32,
    config.sampleRate,
    frameSize,
    "freeremote",
    (pcm) => {
        const encoded = opusEncoder.encodeFloat(pcm, frameSize);
        if (currentSocket) currentSocket.emit("audio", encoded);
    }
);

// stream
rtAudio.start();

// set an interval to check the meters and occasionally send stuff to the client
setInterval(async () => {
    if (!currentSocket) return;
    else if (state.transmitting) {
        let swr = +(await asyncRpc(flrigClient, "rig.get_swrmeter"));
        console.log(swr);
        if (swr >= config.swrCutoff) {
            await asyncRpc(flrigClient, "rig.set_ptt", [0]);
            clearTimeout(currentSocket.pttTimeout);
            state.transmitting = false;
            currentSocket.emit("error", "Transmission was aborted due to high SWR.");
            currentSocket.emit("state", state);
            return;
        }
        currentSocket.emit("swr", swr);
        currentSocket.emit(
            "pwr",
            +(await asyncRpc(flrigClient, "rig.get_pwrmeter"))
        );
    } else {
        currentSocket.emit(
            "dbm",
            +(await asyncRpc(flrigClient, "rig.get_DBM"))
        );
    }
}, 100);

// schemas
const logbookEntry = Joi.object({
    FREQ: Joi.string()
        .custom((value, helpers) => {
            if (isNaN(+value)) return helpers.error("any.invalid");
            else return value;
        })
        .required(),
    QSO_DATE: Joi.string()
        .pattern(/^[0-9]{8}$/)
        .required(),
    TIME_ON: Joi.string()
        .pattern(/^[0-9]{6}$/)
        .required(),
    CALL: Joi.string()
        .pattern(/^[A-Z0-9]{3,15}$/)
        .required(),
    MODE: Joi.string().min(2).max(8).required(),
    RST_RCVD: Joi.string().min(1).max(8).required(),
    RST_SENT: Joi.string().min(1).max(8).required(),
});
const logbookSchema = Joi.array().items(logbookEntry, Joi.any().strip());

// on connection
io.on("connection", (socket) => {
    // on authentication
    socket.on("auth", async (key) => {
        // return if there is a user currently logged in
        if (state.currentUser) {
            socket.emit("error", "A user is already logged in.");
            return;
        }
        // otherwise, read the key
        try {
            let json = await readCleartextMessage({ cleartextMessage: key });
            const verificationResult = await verify({
                message: json,
                verificationKeys: publicKey,
            });
            await verificationResult.signatures[0].verified;
            json = JSON.parse(json.text);
            if (
                json.expiration < Date.now() ||
                !db.data.users.find((user) => user.id === json.id)
            ) {
                socket.emit("error", "Key is expired.");
                return;
            }
            state.currentUser = {
                callsign: json.callsign,
                license: json.license,
                id: json.id,
            };
            currentSocket = socket;
            socket.currentUser = true;
            socket.emit("login", {
                sampleRate: config.sampleRate,
                bands: config.bands,
                clubName: config.clubName,
                clubEmail: config.clubEmail,
            });
            socket.emit("state", state);
            log(
                `${json.callsign} (<@${json.id}>) has logged into the remote station.`
            );
        } catch {
            socket.emit("error", "Key could not be verified.");
            return;
        }
    });
    // on ptt
    socket.on("ptt", async () => {
        if (!socket.currentUser) {
            socket.emit(
                "error",
                "You are not authorized to use this function."
            );
            return;
        } else if (state.mode !== "voice") {
            socket.emit(
                "error",
                "You cannot use the PTT command outside of voice mode."
            );
            return;
        } else if (!verifyPrivileges()) {
            socket.emit("error");
            return;
        }
        socket.pttTimeout = setTimeout(async () => {
            await asyncRpc(flrigClient, "rig.set_ptt", [0]);
            state.transmitting = false;
            socket.emit("state", state);
            log(`${state.currentUser.callsign}'s PTT timed out.`);
        }, config.pttTimeout * 1000);
        state.transmitting = true;
        await asyncRpc(flrigClient, "rig.set_ptt", [1]);
        socket.emit("state", state);
        log(
            `${state.currentUser.callsign} PTTed on ${
                state.frequency / 100
            } kHz.`
        );
    });
    // on unptt
    socket.on("unptt", async () => {
        if (!socket.currentUser) {
            socket.emit(
                "error",
                "You are not authorized to use this function."
            );
            return;
        } else if (!state.transmitting) {
            socket.emit("error", "PTT is already disengaged.");
            socket.emit("state", state);
            return;
        }
        if (socket.pttTimeout) clearTimeout(socket.pttTimeout);
        await asyncRpc(flrigClient, "rig.set_ptt", [0]);
        state.transmitting = false;
        socket.emit("state", state);
        log(
            `${state.currentUser.callsign} unPTTed on ${
                state.frequency / 100
            } kHz.`
        );
    });
    // on audio
    socket.on("audio", async (chunk) => {
        if (
            !socket.currentUser ||
            !state.transmitting ||
            state.mode !== "voice"
        )
            return;
        try {
            const decoded = opusDecoder.decodeFloat(chunk, frameSize);
            if (decoded.length !== frameSize * 4) return;
            rtAudio.write(decoded);
        } catch (e) {
            return;
        }
    });
    // on frequency change
    socket.on("frequency", async (frequency) => {
        if (!socket.currentUser) {
            socket.emit(
                "error",
                "You are not authorized to use this function."
            );
            return;
        } else if (state.transmitting) {
            socket.emit(
                "error",
                "You cannot change the VFO while transmitting."
            );
            return;
        } else if (typeof frequency !== "number") {
            socket.emit("error", "Frequency must be a number.");
            return;
        } else if (
            !Object.values(config.bands).find(
                (band) =>
                    band.edges[0] <= frequency && band.edges[1] > frequency
            ) ||
            (state.mode === "ft8" &&
                !Object.values(config.bands).find(
                    (band) => band.ft8 === frequency
                )) ||
            (state.mode === "psk31" &&
                !Object.values(config.bands).find(
                    (band) => band.psk31 === frequency
                ))
        ) {
            socket.emit("error", "The frequency provided is out of band.");
            return;
        }
        // note that we add 0.1hz to the frequency being sent bc of xmlrpc fuckery--we need the lib to parse this as a double, not an int
        await asyncRpc(flrigClient, "rig.set_vfo", [frequency * 10 + 0.1]);
        state.frequency = +(await asyncRpc(flrigClient, "rig.get_vfo")) / 10;
        socket.emit("state", state);
        log(
            `${state.currentUser.callsign} changed the frequency to ${
                state.frequency / 100
            } kHz.`
        );
    });
    // on tune
    socket.on("tune", async () => {
        if (!socket.currentUser) {
            socket.emit(
                "error",
                "You are not authorized to use this function."
            );
            return;
        } else if (!config.tunable) {
            socket.emit("error", "This station cannot be tuned.");
            return;
        }
        await asyncRpc(flrigClient, "rig.tune");
    });
    // on logbook request
    socket.on("getLogbook", () => {
        if (!socket.currentUser) {
            socket.emit(
                "error",
                "You are not authorized to use this function."
            );
            return;
        }
        return db.data.users.find((user) => user.id === state.currentUser.id)
            .logbook;
    });
    // on new logbook entry
    socket.on("newEntry", async (entry) => {
        if (!socket.currentUser) {
            socket.emit(
                "error",
                "You are not authorized to use this function."
            );
            return;
        }
        let result = logbookEntry.validate(entry);
        if (result.error) {
            socket.emit("error", "Invalid logbook entry.");
            return;
        }
        await db.update(({ users }) =>
            users
                .find((user) => user.id === state.currentUser.id)
                .logbook.unshift(result.value)
        );
        socket.emit(
            "logbook",
            db.data.users.find((user) => user.id === state.currentUser.id)
                .logbook
        );
    });
    // on logbook update
    socket.on("updateLogbook", async (logbook) => {
        if (!socket.currentUser) {
            socket.emit(
                "error",
                "You are not authorized to use this function."
            );
            return;
        }
        let result = logbookSchema.validate(logbook);
        if (result.error) {
            socket.emit("error", "Invalid logbook.");
            return;
        }
        await db.update(
            ({ users }) =>
                (users.find(
                    (user) => user.id === state.currentUser.id
                ).logbook = result.value)
        );
        socket.emit(
            "logbook",
            db.data.users.find((user) => user.id === state.currentUser.id)
                .logbook
        );
    });
    // on disconnect
    socket.on("disconnect", async () => {
        if (!socket.currentUser) return;
        else if (state.transmitting) {
            await asyncRpc(flrigClient, "rig.set_ptt", [0]);
            state.transmitting = false;
            clearTimeout(socket.pttTimeout);
        }
        log(`${state.currentUser.callsign} logged out.`);
        currentSocket = undefined;
        state.currentUser = undefined;
        socket.currentUser = false;
    });
});

// connect ngrok!
const listener = await ngrok.forward({
    authtoken: config.ngrokToken,
    addr: config.port,
    response_header_add: ["Access-Control-Allow-Origin: *"],
});

state.url = listener.url();

console.log("freeremote is now up.");
