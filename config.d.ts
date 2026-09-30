/**
 Type declarations for the station's `config.js`.
 
 `config.js` lives in the repository root, is ignored by git (it holds
 secrets), and must be written by each station operator. It should
 `export default` an object matching the `Config` interface below.
 */

/**
A `[lower, upper)` frequency range, in units of 10 Hz. All station frequencies use this unit.
*/
export type FrequencyRange = [lower: number, upper: number];

/**
License classes recognized by the station (US amateur radio licenses).
*/
export type License = 'extra' | 'general' | 'technician';

/**
Definition of a single amateur band.
*/
export type Band = {
    /**
    The band edges.
    */
    edges: FrequencyRange;
    /**
    The portion of the band where voice (phone) transmissions are permitted.
    */
    voice: FrequencyRange;
    /**
    Sub-ranges of the band each license class may transmit in. Extra-class licensees may use the whole band.
    */
    privileges: {
        general: FrequencyRange[];
        technician?: FrequencyRange[];
    };
    /**
    The FT8 calling frequency for this band, if any.
    */
    ft8?: number;
    /**
    The PSK31 calling frequency for this band, if any.
    */
    psk31?: number;
};

export type Config = {
    /**
    Armored PGP public key used to verify station keys (see `npm run generate-keys`).
    */
    publicKey: string;
    /**
    Armored PGP private key used to sign station keys.
    */
    privateKey: string;
    /**
    XML-RPC port flrig is listening on.
    */
    flrigPort: number;
    /**
    XML-RPC port fldigi is listening on.
    */
    fldigiPort: number;
    /**
    Bands the station may operate on, keyed by an arbitrary name (e.g. `"20m"`).
    */
    bands: Record<string, Band>;
    /**
    Discord user IDs allowed to run administrative commands.
    */
    admins: string[];
    /**
    How long a station key remains valid, in seconds.
    */
    keyExpiry: number;
    /**
    Discord bot token.
    */
    discordToken: string;
    /**
    Discord application ID.
    */
    applicationId: string;
    /**
    Discord guild (server) the slash commands are registered in.
    */
    guildId: string;
    /**
    Discord channel ID station activity is logged to.
    */
    loggingChannel: string;
    /**
    Audio sample rate, in Hz.
    */
    sampleRate: number;
    /**
    Audio frame length, in milliseconds.
    */
    frameSize: number;
    /**
    RtAudio output device ID (audio sent to the radio).
    */
    audioOutput: number;
    /**
    RtAudio input device ID (audio received from the radio).
    */
    audioInput: number;
    /**
    SWR at or above which a voice transmission is aborted.
    */
    swrCutoff: number;
    /**
    Local port the socket.io server listens on.
    */
    port: number;
    /**
    Maximum length of a single PTT, in seconds.
    */
    pttTimeout: number;
    /**
    Club name, shown to clients and used as the PGP key's user ID.
    */
    clubName: string;
    /**
    Club email, shown to clients and used as the PGP key's user ID.
    */
    clubEmail: string;
    /**
    Whether the station has a tuner that clients may trigger.
    */
    tunable: boolean;
    /**
    Ngrok auth token used to expose the server publicly.
    */
    ngrokToken: string;
};

declare const config: Config;
export default config;
