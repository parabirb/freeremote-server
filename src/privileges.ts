import type {Band, FrequencyRange} from '../config.js';
import type {Mode, Operator} from './types.js';

/**
Whether `frequency` lies within the half-open range `[lower, upper)`.
*/
export function isInRange(
    frequency: number,
    [lower, upper]: FrequencyRange,
): boolean {
    return lower <= frequency && upper > frequency;
}

/**
Find the band containing `frequency`, if any.
*/
export function findBand(
    bands: Record<string, Band>,
    frequency: number,
): Band | undefined {
    return Object.values(bands).find((band) =>
        isInRange(frequency, band.edges),
    );
}

/**
 Check whether `operator` may transmit on `frequency` in `mode`.
 
 The frequency must be inside a configured band, inside the operator's
 license privileges for that band, and (for voice) inside the band's
 voice segment.
 */
export function canTransmit(
    bands: Record<string, Band>,
    operator: Operator,
    frequency: number,
    mode: Mode,
): boolean {
    const band = findBand(bands, frequency);
    if (!band) {
        return false;
    }

    const inPrivileges = (ranges: FrequencyRange[] | undefined) =>
        ranges?.some((range) => isInRange(frequency, range)) ?? false;

    const isLicensed =
        operator.license === 'extra' ||
        (operator.license === 'general' &&
            inPrivileges(band.privileges.general)) ||
        (operator.license === 'technician' &&
            inPrivileges(band.privileges.technician));

    const isModeAllowed = mode !== 'voice' || isInRange(frequency, band.voice);

    return isLicensed && isModeAllowed;
}
