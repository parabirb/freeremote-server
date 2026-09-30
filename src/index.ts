// Freeremote server entry point.
//
// Wires together:
// - flrig (over XML-RPC) to control the radio,
// - RtAudio + Opus to stream audio to and from the radio,
// - a Discord bot for user management and handing out station keys,
// - a socket.io server (exposed publicly through ngrok) that the web client
//   connects to.
//
// Only one user may operate the station at a time. Users authenticate with a
// PGP-signed key issued by the Discord bot's `/requestkey` command.
import {Buffer} from 'node:buffer';
import process from 'node:process';
import audify from 'audify';
import ngrok from '@ngrok/ngrok';
import {Server, type Socket} from 'socket.io';
import {JSONFilePreset} from 'lowdb/node';
import {
    readKey,
    readPrivateKey,
    readCleartextMessage,
    createCleartextMessage,
    sign,
    verify,
} from 'openpgp';
import {
    REST,
    Routes,
    Client,
    AttachmentBuilder,
    GatewayIntentBits,
    MessageFlags,
    type ChatInputCommandInteraction,
} from 'discord.js';
import config, {type License} from '../config.js';
import {commands} from './commands.js';
import {canTransmit, findBand} from './privileges.js';
import {
    getFrequency,
    rigNumber,
    setFrequency,
    setPtt,
    asyncRpc,
    flrigClient,
} from './rig.js';
import {logbookEntrySchema, logbookSchema} from './schemas.js';
import type {
    ClientToServerEvents,
    Database,
    InterServerEvents,
    KeyPayload,
    LogbookEntry,
    ServerToClientEvents,
    SocketData,
    StationState,
} from './types.js';

type StationSocket = Socket<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
User whitelist and logbooks, persisted to `database.json`.
*/
// eslint-disable-next-line new-cap -- lowdb's factory function is PascalCase.
const db = await JSONFilePreset<Database>('database.json', {users: []});

// PGP keys used to sign (Discord bot) and verify (socket auth) station keys.
const publicKey = await readKey({armoredKey: config.publicKey});
const privateKey = await readPrivateKey({armoredKey: config.privateKey});

/**
Station state; the whole object is sent to the client whenever it changes.
*/
const state: StationState = {
    transmitting: false,
    mode: 'voice',
    frequency: await getFrequency(),
    maxpwr: await rigNumber('rig.get_maxpwr'),
};

/**
The socket of the user currently operating the station, if any.
*/
let currentSocket: StationSocket | undefined;

/**
Frequency formatted in kHz for log messages.
*/
function formatFrequency(frequency: number): string {
    return `${frequency / 100} kHz`;
}

/**
Release PTT and exit.
*/
async function shutdown(): Promise<void> {
    console.log('Shutting down...');
    currentSocket?.disconnect();
    await setPtt(false);
    // eslint-disable-next-line unicorn/no-process-exit -- this is an intentional, user-requested shutdown.
    process.exit(0);
}

/**
Look up a whitelisted user's logbook.
*/
function getLogbook(userId: string): LogbookEntry[] {
    return db.data.users.find((user) => user.id === userId)?.logbook ?? [];
}

// ---------------------------------------------------------------------------
// Discord bot
// ---------------------------------------------------------------------------

const discordClient = new Client({
    intents: [GatewayIntentBits.Guilds],
});

/**
Post a message to the configured logging channel.
*/
function log(message: string): void {
    const channel = discordClient.channels.cache.get(config.loggingChannel);
    if (channel?.isSendable()) {
        channel.send(message).catch(console.error);
    }
}

/**
 Handle a slash command. Replies are always ephemeral, so only the invoking
 user sees them.
 */
async function handleCommand(
    interaction: ChatInputCommandInteraction,
): Promise<void> {
    // Defer the reply so Discord doesn't time out on slow operations.
    await interaction.deferReply({flags: MessageFlags.Ephemeral});

    const reply = async (content: string) => {
        await interaction.editReply({content});
    };

    const isAdmin = config.admins.includes(interaction.user.id);

    switch (interaction.commandName) {
        case 'adduser': {
            if (!isAdmin) {
                await reply('You are not authorized to run this command!');
                return;
            }

            const toAdd = interaction.options.getUser('user', true).id;
            if (db.data.users.some((user) => user.id === toAdd)) {
                await reply('This user is already in the whitelist!');
                return;
            }

            await db.update(({users}) => {
                users.push({
                    id: toAdd,
                    callsign: interaction.options.getString('callsign', true),
                    // The command's choices restrict this to a valid license.
                    license: interaction.options.getString(
                        'license',
                        true,
                    ) as License,
                    logbook: [],
                });
            });
            await reply('This user has been added to the whitelist.');
            break;
        }

        case 'deluser': {
            if (!isAdmin) {
                await reply('You are not authorized to run this command!');
                return;
            }

            const toDelete = interaction.options.getString('user', true);
            if (db.data.users.every((user) => user.id !== toDelete)) {
                await reply('User is not in the database.');
                return;
            }

            await db.update((data) => {
                data.users = data.users.filter((user) => user.id !== toDelete);
            });
            await reply('User has been deleted from the whitelist.');
            break;
        }

        case 'requestkey': {
            const user = db.data.users.find(
                (user) => user.id === interaction.user.id,
            );
            if (!user) {
                await reply('You are not in the whitelist.');
                return;
            }

            const keyLifetime = config.keyExpiry * 1000;
            // The key is a cleartext-signed JSON payload; the socket server
            // verifies the signature and expiration on login.
            const payload: KeyPayload = {
                callsign: user.callsign,
                license: user.license,
                id: user.id,
                url: state.url,
                expiration: Date.now() + keyLifetime,
            };
            const message = await createCleartextMessage({
                text: JSON.stringify(payload),
            });
            const signed = await sign({message, signingKeys: privateKey});
            await interaction.editReply({
                content: 'Below is your key.',
                files: [
                    new AttachmentBuilder(Buffer.from(signed)).setName(
                        `${user.callsign}-${Date.now()}.txt`,
                    ),
                ],
            });
            break;
        }

        case 'shutdown': {
            if (!isAdmin) {
                await reply('You are not authorized to run this command!');
                return;
            }

            await reply('Shutting down.');
            await shutdown();
            break;
        }

        case 'inuse': {
            await reply(
                state.currentUser
                    ? `The station is currently being used by <@${state.currentUser.id}> (${state.currentUser.callsign}).`
                    : 'The station is not in use right now.',
            );
            break;
        }

        default: {
            break;
        }
    }
}

discordClient.on('interactionCreate', (interaction) => {
    if (!interaction.isChatInputCommand()) {
        return;
    }

    handleCommand(interaction).catch(console.error);
});

// Register the slash commands with Discord, then log in.
const rest = new REST().setToken(config.discordToken);
await rest.put(
    Routes.applicationGuildCommands(config.applicationId, config.guildId),
    {body: commands},
);
await discordClient.login(config.discordToken);

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

const rtAudio = new audify.RtAudio();

// Mono Opus codec. Receive audio from the radio is encoded and sent to the
// client; transmit audio from the client is decoded and played to the radio.
const opusEncoder = new audify.OpusEncoder(
    config.sampleRate,
    1,
    audify.OpusApplication.OPUS_APPLICATION_AUDIO,
);
const opusDecoder = new audify.OpusDecoder(config.sampleRate, 1);

/**
Samples per audio frame.
*/
const frameSize = (config.frameSize / 1000) * config.sampleRate;

/**
Bytes per decoded frame (mono 32-bit float).
*/
const frameBytes = frameSize * 4;

rtAudio.openStream(
    {deviceId: config.audioOutput, nChannels: 1},
    {deviceId: config.audioInput, nChannels: 1},
    audify.RtAudioFormat.RTAUDIO_FLOAT32,
    config.sampleRate,
    frameSize,
    'freeremote',
    (pcm) => {
        // Stream receive audio to the operator, except while transmitting.
        const encoded = opusEncoder.encodeFloat(pcm, frameSize);
        if (currentSocket && !state.transmitting) {
            currentSocket.emit('audio', encoded);
        }
    },
    null,
);
rtAudio.start();

// ---------------------------------------------------------------------------
// Meters
// ---------------------------------------------------------------------------

/**
The previous SWR reading, used to require two high readings in a row.
*/
let lastSwr: number | undefined;

/**
 Poll the rig's meters and forward them to the client: SWR and power while
 transmitting, signal strength while receiving. A voice transmission is
 aborted if two consecutive SWR readings reach `config.swrCutoff`.
 */
async function pollMeters(): Promise<void> {
    const socket = currentSocket;
    if (!socket) {
        return;
    }

    if (!state.transmitting) {
        socket.emit('dbm', await rigNumber('rig.get_DBM'));
        return;
    }

    const swr = await rigNumber('rig.get_swrmeter');
    if (
        lastSwr !== undefined &&
        state.mode === 'voice' &&
        swr >= config.swrCutoff &&
        lastSwr >= config.swrCutoff
    ) {
        state.transmitting = false;
        await setPtt(false);
        clearTimeout(socket.data.pttTimeout);
        socket.emit('error', 'Transmission was aborted due to high SWR.');
        log(
            `${state.currentUser?.callsign}'s transmission on ${formatFrequency(
                state.frequency,
            )} was aborted due to high SWR. Meter readings were: ${swr}, ${lastSwr}`,
        );
        socket.emit('state', state);
        return;
    }

    lastSwr = swr;
    socket.emit('swr', swr);
    socket.emit('pwr', await rigNumber('rig.get_pwrmeter'));
}

setInterval(() => {
    pollMeters().catch(console.error);
}, 100);

// ---------------------------------------------------------------------------
// Socket.io server
// ---------------------------------------------------------------------------

const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
>(config.port);

/**
 Verify a station key and return its payload, or `undefined` if the key is
 invalid or has expired.
 */
async function verifyKey(key: unknown): Promise<KeyPayload | undefined> {
    if (typeof key !== 'string') {
        return undefined;
    }

    const message = await readCleartextMessage({cleartextMessage: key});
    const {signatures} = await verify({message, verificationKeys: publicKey});
    const [signature] = signatures;
    if (!signature) {
        return undefined;
    }

    // `verified` rejects if the signature is invalid.
    await signature.verified;
    return JSON.parse(message.getText()) as KeyPayload;
}

io.on('connection', (socket) => {
    socket.data.authenticated = false;

    /**
     Register a handler for an event that requires the socket to be
     authenticated. Handler errors are logged instead of crashing the server.
     */
    function onAuthenticated(
        event: Exclude<keyof ClientToServerEvents, 'auth' | 'audio'>,
        handler: (payload: unknown) => void | Promise<void>,
    ): void {
        socket.on(event, (payload?: unknown) => {
            if (!socket.data.authenticated) {
                socket.emit(
                    'error',
                    'You are not authorized to use this function.',
                );
                return;
            }

            Promise.resolve(handler(payload)).catch(console.error);
        });
    }

    // Log in with a station key. Only one user may be logged in at a time.
    socket.on('auth', (key) => {
        handleAuth(key).catch(console.error);
    });

    async function handleAuth(key: unknown): Promise<void> {
        if (state.currentUser) {
            socket.emit('error', 'A user is already logged in.');
            return;
        }

        let payload: KeyPayload | undefined;
        try {
            payload = await verifyKey(key);
        } catch {
            payload = undefined;
        }

        if (!payload) {
            socket.emit('error', 'Key could not be verified.');
            return;
        }

        const {id, callsign, license} = payload;
        // Reject keys that have expired or belong to users since removed from the whitelist.
        if (
            payload.expiration < Date.now() ||
            db.data.users.every((user) => user.id !== id)
        ) {
            socket.emit('error', 'Key is expired.');
            return;
        }

        state.currentUser = {callsign, license, id};
        currentSocket = socket;
        socket.data.authenticated = true;
        socket.emit('login', {
            sampleRate: config.sampleRate,
            bands: config.bands,
            clubName: config.clubName,
            clubEmail: config.clubEmail,
        });
        socket.emit('state', state);
        log(`${callsign} (<@${id}>) has logged into the remote station.`);
    }

    /**
    Force-release PTT once `config.pttTimeout` has elapsed.
    */
    async function releasePtt(): Promise<void> {
        await setPtt(false);
        state.transmitting = false;
        socket.emit('state', state);
        log(`${state.currentUser?.callsign}'s PTT timed out.`);
    }

    // Engage PTT (voice mode only). PTT is released automatically after
    // `config.pttTimeout` seconds.
    onAuthenticated('ptt', async () => {
        if (state.mode !== 'voice') {
            socket.emit(
                'error',
                'You cannot use the PTT command outside of voice mode.',
            );
            return;
        }

        if (
            !state.currentUser ||
            !canTransmit(
                config.bands,
                state.currentUser,
                state.frequency,
                state.mode,
            )
        ) {
            socket.emit(
                'error',
                'You are attempting to transmit outside of your privileges.',
            );
            return;
        }

        clearTimeout(socket.data.pttTimeout);
        socket.data.pttTimeout = setTimeout(() => {
            releasePtt().catch(console.error);
        }, config.pttTimeout * 1000);

        state.transmitting = true;
        await setPtt(true);
        socket.emit('state', state);
        log(
            `${state.currentUser.callsign} PTTed on ${formatFrequency(state.frequency)}.`,
        );
    });

    // Release PTT (voice mode only).
    onAuthenticated('unptt', async () => {
        if (!state.transmitting) {
            socket.emit('error', 'PTT is already disengaged.');
            socket.emit('state', state);
            return;
        }

        if (state.mode !== 'voice') {
            socket.emit(
                'error',
                'You cannot use the PTT command outside of voice mode.',
            );
            return;
        }

        clearTimeout(socket.data.pttTimeout);
        await setPtt(false);
        state.transmitting = false;
        socket.emit('state', state);
        log(
            `${state.currentUser?.callsign} unPTTed on ${formatFrequency(state.frequency)}.`,
        );
    });

    // Transmit audio from the client. Silently ignored unless the socket is
    // the operator and is transmitting in voice mode.
    socket.on('audio', (chunk) => {
        if (
            !socket.data.authenticated ||
            !state.transmitting ||
            state.mode !== 'voice' ||
            !Buffer.isBuffer(chunk)
        ) {
            return;
        }

        try {
            const decoded = opusDecoder.decodeFloat(chunk, frameSize);
            // Drop malformed frames rather than glitching the output stream.
            if (decoded.length === frameBytes) {
                rtAudio.write(decoded);
            }
        } catch {
            // Ignore packets that fail to decode.
        }
    });

    // Change the VFO frequency (given in units of 10 Hz). The frequency must be
    // inside a configured band, and in digital modes must be that mode's
    // calling frequency for some band.
    onAuthenticated('frequency', async (frequency) => {
        if (state.transmitting) {
            socket.emit(
                'error',
                'You cannot change the VFO while transmitting.',
            );
            return;
        }

        if (typeof frequency !== 'number') {
            socket.emit('error', 'Frequency must be a number.');
            return;
        }

        const bands = Object.values(config.bands);
        if (
            !findBand(config.bands, frequency) ||
            (state.mode === 'ft8' &&
                bands.every((band) => band.ft8 !== frequency)) ||
            (state.mode === 'psk31' &&
                bands.every((band) => band.psk31 !== frequency))
        ) {
            socket.emit('error', 'The frequency provided is out of band.');
            return;
        }

        await setFrequency(frequency);
        // Read the frequency back, since the rig may have adjusted it.
        state.frequency = await getFrequency();
        socket.emit('state', state);
    });

    // Trigger the station's antenna tuner.
    onAuthenticated('tune', async () => {
        if (!config.tunable) {
            socket.emit('error', 'This station cannot be tuned.');
            return;
        }

        await asyncRpc(flrigClient, 'rig.tune');
    });

    // Send the operator their logbook.
    onAuthenticated('getLogbook', () => {
        if (state.currentUser) {
            socket.emit('logbook', getLogbook(state.currentUser.id));
        }
    });

    // Add an entry to the top of the operator's logbook.
    onAuthenticated('newEntry', async (entry) => {
        const result = logbookEntrySchema.validate(entry);
        const operator = state.currentUser;
        if (!operator || result.error !== undefined) {
            socket.emit('error', 'Invalid logbook entry.');
            return;
        }

        await db.update(({users}) => {
            users
                .find((user) => user.id === operator.id)
                ?.logbook.unshift(result.value);
        });
        socket.emit('logbook', getLogbook(operator.id));
    });

    // Replace the operator's whole logbook (e.g. after an edit or ADIF import).
    onAuthenticated('updateLogbook', async (logbook) => {
        const result = logbookSchema.validate(logbook);
        const operator = state.currentUser;
        if (!operator || result.error !== undefined) {
            socket.emit('error', 'Invalid logbook.');
            return;
        }

        await db.update(({users}) => {
            const user = users.find((user) => user.id === operator.id);
            if (user) {
                user.logbook = result.value;
            }
        });
        socket.emit('logbook', getLogbook(operator.id));
    });

    // Free up the station when the operator disconnects, releasing PTT if needed.
    socket.on('disconnect', () => {
        handleDisconnect().catch(console.error);
    });

    async function handleDisconnect(): Promise<void> {
        if (!socket.data.authenticated) {
            return;
        }

        if (state.transmitting) {
            clearTimeout(socket.data.pttTimeout);
            state.transmitting = false;
            await setPtt(false);
        }

        log(`${state.currentUser?.callsign} logged out.`);
        currentSocket = undefined;
        state.currentUser = undefined;
        socket.data.authenticated = false;
    }
});

// ---------------------------------------------------------------------------
// Public access
// ---------------------------------------------------------------------------

// Expose the socket.io server publicly through ngrok. The URL is embedded in
// station keys so the client knows where to connect.
const listener = await ngrok.forward({
    authtoken: config.ngrokToken,
    addr: config.port,
    // eslint-disable-next-line @typescript-eslint/naming-convention -- ngrok option name.
    response_header_add: ['Access-Control-Allow-Origin: *'],
});

state.url = listener.url() ?? undefined;

console.log('freeremote is now up.');
