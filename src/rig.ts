import xmlrpc from "xmlrpc";
import config from "../config.js";

/**
XML-RPC client for flrig, which controls the radio.
*/
export const flrigClient = xmlrpc.createClient({
    host: "127.0.0.1",
    port: config.flrigPort,
});

/**
Call an XML-RPC method and return its result as a promise.
*/
export async function asyncRpc(
    client: xmlrpc.Client,
    method: string,
    parameters: unknown[] = [],
): Promise<unknown> {
    return new Promise((resolve, reject) => {
        client.methodCall(
            method,
            parameters,
            (error: unknown, value: unknown) => {
                if (error !== null && error !== undefined) {
                    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- xmlrpc passes through whatever error it got.
                    reject(error);
                    return;
                }

                resolve(value);
            },
        );
    });
}

/**
Call an flrig method that returns a number.
*/
export async function rigNumber(method: string): Promise<number> {
    return Number(await asyncRpc(flrigClient, method));
}

/**
Engage (`true`) or release (`false`) the rig's PTT.
*/
export async function setPtt(isEngaged: boolean): Promise<void> {
    await asyncRpc(flrigClient, "rig.set_ptt", [isEngaged ? 1 : 0]);
}

/**
Read the rig's VFO frequency, in units of 10 Hz.
*/
export async function getFrequency(): Promise<number> {
    return (await rigNumber("rig.get_vfo")) / 10;
}

/**
Set the rig's VFO frequency, given in units of 10 Hz.
*/
export async function setFrequency(frequency: number): Promise<void> {
    // Add 0.1 Hz so the xmlrpc library serializes this as a double rather
    // than an int, which flrig requires.
    const hertz = frequency * 10;
    await asyncRpc(flrigClient, "rig.set_vfo", [hertz + 0.1]);
}
