/* eslint-disable @typescript-eslint/naming-convention -- logbook fields use ADIF names. */
import Joi from "joi";
import type { LogbookEntry } from "./types.js";

/**
Validates a single logbook entry sent by the client.
*/
export const logbookEntrySchema = Joi.object<LogbookEntry>({
    FREQ: Joi.string()
        .custom((value: string, helpers) =>
            Number.isNaN(Number(value)) ? helpers.error("any.invalid") : value,
        )
        .required(),
    QSO_DATE: Joi.string()
        .pattern(/^\d{8}$/v)
        .required(),
    TIME_ON: Joi.string()
        .pattern(/^\d{6}$/v)
        .required(),
    CALL: Joi.string()
        .pattern(/^[\dA-Z]{3,15}$/v)
        .required(),
    MODE: Joi.string().min(2).max(8).required(),
    RST_RCVD: Joi.string().min(1).max(8).required(),
    RST_SENT: Joi.string().min(1).max(8).required(),
});

/**
Validates a whole logbook. Invalid entries are silently dropped.
*/
export const logbookSchema = Joi.array<LogbookEntry[]>().items(
    logbookEntrySchema,
    Joi.any().strip(),
);
