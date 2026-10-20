"use strict";

const fs = require("fs");
const path = require("path");

const SR = 16000;
const CEILING = SR * 0.45;
const OUT = path.join(__dirname, "..", "miniprogram", "audio");

const PLUCK = { ratios: [1, 2, 3, 4, 5, 6], amps: [1, 0.55, 0.32, 0.2, 0.12, 0.07], decay: [3.2, 4.5, 6, 8, 10, 13] };
const BELL = { ratios: [1, 2.76, 5.4, 8.93], amps: [1, 0.45, 0.2, 0.1], decay: [2.4, 4, 7, 11] };
const GONG = { ratios: [1, 1.51, 2.02, 2.74, 3.9], amps: [1, 0.7, 0.5, 0.3, 0.15], decay: [1.6, 2.2, 3, 4.5, 7] };

const HZ = { G3: 196, A3: 220, C4: 262, E4: 330, A4: 440, B4: 494, D5: 587, E5: 659, G5: 784, A5: 880, C6: 1047, D6: 1175, E6: 1319, G6: 1568 };

function voice(timbre, freq, at, dur, vol) {
  return { timbre, freq, at, dur, vol };
}

function knock(freq, at, dur, vol) {
  return { knock: true, freq, at, dur, vol };
}

function renderNote(buf, n) {
  const start = Math.floor(n.at * SR);
  const len = Math.floor(n.dur * SR);
  let seed = 7;
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / SR;
    let s;
    if (n.knock) {
      const f = n.freq * (1 - 0.35 * Math.min(1, t / 0.05));
      seed = (seed * 16807) % 2147483647;
      const noise = (seed / 2147483647 - 0.5) * Math.exp(-t * 90);
      s = Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 55) + noise * 0.6;
    } else {
      const tb = n.timbre;
      s = 0;
      for (let k = 0; k < tb.ratios.length; k++) {
        if (n.freq * tb.ratios[k] > CEILING) continue;
        s += tb.amps[k] * Math.sin(2 * Math.PI * n.freq * tb.ratios[k] * t) * Math.exp(-t * tb.decay[k]);
      }
    }
    const attack = Math.min(1, t / 0.003);
    const release = Math.min(1, (n.dur - t) / 0.02);
    buf[start + i] += s * attack * release * n.vol;
  }
}

function render(notes) {
  const total = Math.max.apply(null, notes.map((n) => n.at + n.dur));
  const buf = new Float32Array(Math.ceil(total * SR));
  notes.forEach((n) => renderNote(buf, n));
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]));
  const gain = peak > 0 ? 0.85 / peak : 1;
  return buf.map((v) => v * gain);
}

function wav(samples) {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const head = Buffer.alloc(44);
  head.write("RIFF", 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write("WAVEfmt ", 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(SR, 24);
  head.writeUInt32LE(SR * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write("data", 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

const SOUNDS = {
  tap: [knock(900, 0, 0.09, 1)],
  tick: [knock(1500, 0, 0.06, 1)],
  ok: [voice(PLUCK, HZ.G5, 0, 0.4, 1), voice(PLUCK, HZ.C6, 0.09, 0.45, 1), voice(BELL, HZ.C6, 0.09, 0.45, 0.25)],
  good: [
    voice(PLUCK, HZ.E5, 0, 0.45, 1),
    voice(PLUCK, HZ.G5, 0.08, 0.45, 1),
    voice(PLUCK, HZ.C6, 0.16, 0.5, 1),
    voice(BELL, HZ.C6, 0.16, 0.5, 0.3)
  ],
  fuzzy: [knock(700, 0, 0.1, 0.5), voice(PLUCK, HZ.B4, 0.02, 0.4, 0.9), voice(PLUCK, HZ.A4, 0.16, 0.4, 0.7)],
  no: [voice(PLUCK, HZ.E4, 0, 0.4, 1), voice(PLUCK, HZ.C4, 0.12, 0.5, 1)],
  bad: [voice(PLUCK, HZ.A3, 0, 0.55, 1), voice(PLUCK, HZ.G3, 0.16, 0.6, 1), knock(300, 0, 0.1, 0.5)],
  combo: [voice(PLUCK, HZ.C6, 0, 0.3, 0.9), voice(PLUCK, HZ.E6, 0.06, 0.3, 0.9), voice(PLUCK, HZ.G6, 0.12, 0.4, 0.9)],
  pass: [
    voice(PLUCK, HZ.C4 * 2, 0, 0.4, 1),
    voice(PLUCK, HZ.D5, 0.09, 0.4, 1),
    voice(PLUCK, HZ.E5, 0.18, 0.4, 1),
    voice(PLUCK, HZ.G5, 0.27, 0.4, 1),
    voice(PLUCK, HZ.C6, 0.36, 0.6, 1),
    voice(BELL, HZ.C6, 0.36, 0.6, 0.35)
  ],
  rank: [
    voice(BELL, HZ.C6 / 2, 0, 0.9, 1),
    voice(BELL, HZ.G5, 0.04, 0.9, 0.8),
    voice(BELL, HZ.C6, 0.08, 0.9, 0.7),
    voice(PLUCK, HZ.E6, 0.3, 0.5, 0.6)
  ],
  gong: [voice(GONG, HZ.G3, 0, 0.9, 1), knock(180, 0, 0.12, 0.6)]
};

fs.mkdirSync(OUT, { recursive: true });
Object.keys(SOUNDS).forEach((name) => {
  const bytes = wav(render(SOUNDS[name]));
  fs.writeFileSync(path.join(OUT, name + ".wav"), bytes);
  console.log(name + ".wav", bytes.length);
});
