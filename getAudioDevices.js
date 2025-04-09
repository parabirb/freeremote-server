import audify from "audify";

const rtAudio = new audify.RtAudio();

console.log(rtAudio.getDevices())