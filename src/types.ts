import type { Band, License } from "../config.js";

/**
Operating modes the station can be in. Only voice is fully supported for now.
*/
export type Mode = "voice" | "ft8" | "psk31";

/**
A single QSO in a user's logbook, using ADIF field names.
*/
export type LogbookEntry = {
    FREQ: string;
    QSO_DATE: string;
    TIME_ON: string;
    CALL: string;
    MODE: string;
    RST_RCVD: string;
    RST_SENT: string;
};

/**
A whitelisted user, as stored in the database.
*/
export type User = {
    /**
    Discord user ID.
    */
    id: string;
    callsign: string;
    license: License;
    logbook: LogbookEntry[];
};

/**
The shape of `database.json`.
*/
export type Database = {
    users: User[];
};

/**
The user currently operating the station.
*/
export type Operator = Pick<User, "id" | "callsign" | "license">;

/**
The contents of a signed station key.
*/
export type KeyPayload = Operator & {
    /**
    Public URL of the server at the time the key was issued.
    */
    url: string | undefined;
    /**
    Unix timestamp (ms) after which the key is no longer valid.
    */
    expiration: number;
};

/**
Station state. This whole object is sent to the client on every change.
*/
export type StationState = {
    transmitting: boolean;
    mode: Mode;
    /**
    Current VFO frequency, in units of 10 Hz.
    */
    frequency: number;
    /**
    Maximum power output of the rig, in watts.
    */
    maxpwr: number;
    currentUser?: Operator;
    /**
    Public (ngrok) URL of the server.
    */
    url?: string;
};

/**
 Events the client may send. Payloads come straight from the network, so
 they are typed as `unknown` and validated by each handler.
 */
export type ClientToServerEvents = {
    auth: (key: unknown) => void;
    ptt: () => void;
    unptt: () => void;
    audio: (chunk: unknown) => void;
    frequency: (frequency: unknown) => void;
    tune: () => void;
    getLogbook: () => void;
    newEntry: (entry: unknown) => void;
    updateLogbook: (logbook: unknown) => void;
};

/**
Events the server sends to the client.
*/
export type ServerToClientEvents = {
    login: (info: {
        sampleRate: number;
        bands: Record<string, Band>;
        clubName: string;
        clubEmail: string;
    }) => void;
    state: (state: StationState) => void;
    error: (message: string) => void;
    /**
    Opus-encoded receive audio.
    */
    audio: (chunk: Uint8Array) => void;
    /**
    SWR meter reading, sent while transmitting.
    */
    swr: (swr: number) => void;
    /**
    Power meter reading, sent while transmitting.
    */
    pwr: (pwr: number) => void;
    /**
    S-meter reading in dBm, sent while receiving.
    */
    dbm: (dbm: number) => void;
    logbook: (logbook: LogbookEntry[]) => void;
};

// eslint-disable-next-line @typescript-eslint/no-empty-object-type -- required by socket.io's generics; we have no inter-server events.
export type InterServerEvents = {};

/**
Per-socket data.
*/
export type SocketData = {
    /**
    Whether this socket has authenticated and is the current operator.
    */
    authenticated: boolean;
    /**
    Timer that force-releases PTT after `config.pttTimeout` seconds.
    */
    pttTimeout?: NodeJS.Timeout;
};
