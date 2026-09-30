/**
 List the audio devices RtAudio can see.
 
 Run with `npm run audio-devices` to find the device IDs to use for
 `audioInput` and `audioOutput` in `config.js`.
 */
import audify from "audify";

const rtAudio = new audify.RtAudio();

console.log(rtAudio.getDevices());
