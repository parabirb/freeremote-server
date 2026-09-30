// Ft8js ships its types at dist/src/, but its package.json points at a
// dist/index.d.ts that doesn't exist, so the declarations are copied here.
declare module "ft8js" {
    /**
    A decoded FT8 message.
    */
    export type Ft8Message = {
        /**
        Signal-to-noise ratio, in dB.
        */
        db: number;
        /**
        Time offset, in seconds.
        */
        dt: number;
        /**
        Audio frequency offset, in Hz.
        */
        df: number;
        text: string;
    };

    /**
    Encode a message as FT8 audio at the given audio frequency (Hz).
    */
    export function encode(
        input: string,
        frequency: number,
    ): Promise<Float32Array | undefined>;

    /**
    Decode all FT8 messages in a 15-second slot of audio.
    */
    export function decode(input: Float32Array): Promise<Ft8Message[]>;
}
