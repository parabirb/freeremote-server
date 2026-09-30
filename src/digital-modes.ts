// Scaffolding for the planned FT8 and PSK31 modes. Nothing uses these yet.
import xmlrpc from "xmlrpc";
import config from "../config.js";

/**
FT8 encoder/decoder, for the planned FT8 mode.
*/
export * as ft8 from "ft8js";

/**
XML-RPC client for fldigi, for the planned PSK31 mode. Use it with `asyncRpc`
from `./rig.js`.
*/
export const fldigiClient = xmlrpc.createClient({
    host: "127.0.0.1",
    port: config.fldigiPort,
});
