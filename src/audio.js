// Ecos de Valdora — áudio 100% sintetizado (WebAudio). Músicas e efeitos ORIGINAIS.
// Agente D.

export const SONGS = {
  aurora:    { name: 'Canção da Aurora',    notes: [0, 2, 4, 2, 0], desc: 'Alterna entre dia e noite.' },
  santuario: { name: 'Canção do Santuário', notes: [1, 3, 1, 4, 3], desc: 'Desperta portas antigas.' },
};

// Flauta: Ré menor pentatônica — D4 F4 G4 A4 C5
const FLUTE_MIDI = [62, 65, 67, 69, 72];

// ---------------------------------------------------------------- utilidades
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function noteToMidi(name) {
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(name);
  if (!m) throw new Error('nota inválida: ' + name);
  let pc = PC[m[1]];
  if (m[2] === '#') pc++;
  if (m[2] === 'b') pc--;
  return 12 * (parseInt(m[3], 10) + 1) + pc;
}

/** "E5 - - . C5 -" -> Map(step -> [{midi,len}]). '-' sustenta, '.' pausa, '|' ignorado. */
function parseSeq(str) {
  const tokens = str.trim().split(/\s+/).filter((t) => t !== '|');
  const events = new Map();
  let cur = null;
  tokens.forEach((tok, i) => {
    if (tok === '-') { if (cur) cur.len++; return; }
    if (tok === '.') { cur = null; return; }
    cur = { midi: noteToMidi(tok), len: 1 };
    if (!events.has(i)) events.set(i, []);
    events.get(i).push(cur);
  });
  return { events, length: tokens.length };
}

/** "A2|A3 C#4 E4" -> { bass: midi, upper: [midi...] } */
function parseChord(str) {
  const [b, u] = str.split('|');
  return { bass: noteToMidi(b.trim()), upper: u.trim().split(/\s+/).map(noteToMidi) };
}

const rand = (a, b) => a + Math.random() * (b - a);

// ---------------------------------------------------------------- trilhas
// Cada trilha: bpm, sub (passos por tempo), barSteps, chords (1 por compasso), melody, lead(), layers()
const TRACKS = {
  title: {
    bpm: 76, sub: 2, barSteps: 8,
    chords: ['A2|A3 C#4 E4', 'F#2|F#3 A3 C#4', 'D2|D3 F#3 A3', 'E2|E3 G#3 B3',
             'A2|A3 C#4 E4', 'C#2|C#3 E3 G#3', 'D2|D3 F#3 A3', 'E2|E3 G#3 B3 D4'],
    melody: `| E5 - - - C#5 - E5 - | F#5 - - - - - E5 D5 | C#5 - D5 - E5 - A4 - | B4 - - - - - - . |
             | E5 - - - C#5 - A5 - | G#5 - - - E5 - F#5 G#5 | A5 - F#5 - D5 - F#5 - | E5 - - - - - - . |`,
    lead: (a, o, t, f, d, v) => a._iFlute(o, t, f, d, v * 0.85),
    layers(a, c) {
      const { out, t, sd, inBar, chord, loop } = c;
      if (inBar === 0) {
        a._iPad(out, t, chord.upper.map(mtof), sd * 8.4, 0.07);
        a._iBass(out, t, mtof(chord.bass), sd * 4, 0.22);
      }
      if (inBar === 4) a._iBass(out, t, mtof(chord.bass + 12), sd * 3.6, 0.14);
      const arp = [...chord.upper, chord.upper[0] + 12, chord.upper[1] + 12];
      const order = [0, 1, 2, 3, 4, 3, 2, 1];
      a._iHarp(out, t, mtof(arp[order[inBar] % arp.length] + 12), sd * 3, loop === 0 && c.bar < 2 ? 0.05 : 0.08);
      if (inBar === 0 && c.bar % 4 === 0) a._dTimpani(out, t, mtof(chord.bass), 0.25);
    },
  },

  village: {
    bpm: 112, sub: 2, barSteps: 6, // 3/4 — valsinha aconchegante
    chords: ['G2|G3 B3 D4', 'C3|G3 C4 E4', 'D3|F#3 A3 D4', 'G2|G3 B3 D4',
             'E2|G3 B3 E4', 'C3|G3 C4 E4', 'A2|G3 C#4 E4', 'D3|F#3 A3 D4',
             'G2|G3 B3 D4', 'B2|A3 D#4 F#4', 'E2|G3 B3 E4', 'C3|G3 C4 E4',
             'D3|G3 B3 D4', 'D3|F#3 A3 C4', 'G2|G3 B3 D4', 'G2|G3 B3 D4'],
    melody: `| B4 - D5 - G5 - | E5 - - - C5 D5 | F#5 - E5 - D5 - | B4 - - - - . |
             | G4 - B4 - E5 - | E5 - D5 - C5 - | C#5 - D5 - E5 - | D5 - - - - . |
             | D5 - G5 - - F#5 | F#5 - D#5 - B4 - | E5 - G5 - B5 - | A5 - G5 - E5 - |
             | D5 - B4 - G4 - | A4 - C5 - F#5 - | G5 - - - D5 - | G5 - - - - . |`,
    lead(a, o, t, f, d, v, c) {
      // bandolim: re-palhetadas em notas longas
      const sd = c.sd;
      const strikes = d > sd * 2.5 ? Math.floor(d / sd) : 1;
      for (let k = 0; k < strikes; k++) a._iPluck(o, t + k * sd, f, strikes > 1 ? sd * 1.1 : d, v * (k ? 0.55 : 0.95), 1.4);
      if (c.loop % 2 === 1) a._iFlute(o, t, f / 2, d, v * 0.35);
    },
    layers(a, c) {
      const { out, t, sd, inBar, chord, bar } = c;
      if (inBar === 0) a._iBass(out, t, mtof(chord.bass + (bar % 2 ? 7 : 0) - (bar % 2 && chord.bass + 7 > 50 ? 12 : 0)), sd * 1.8, 0.3);
      if (inBar === 2 || inBar === 4) chord.upper.forEach((m, k) => a._iPluck(out, t + k * 0.012, mtof(m), sd * 1.2, 0.07, 0.9));
      a._dShaker(out, t, inBar % 2 ? 0.025 : 0.045);
    },
  },

  field: {
    bpm: 132, sub: 2, barSteps: 8, // aventura em Ré mixolídio
    chords: ['D2|D3 F#3 A3', 'C2|C3 E3 G3', 'G1|D3 G3 B3', 'D2|D3 F#3 A3',
             'D2|D3 F#3 A3', 'C2|C3 E3 G3', 'B1|D3 F#3 B3', 'A1|C#3 E3 A3',
             'B1|D3 F#3 B3', 'G1|D3 G3 B3', 'D2|D3 F#3 A3', 'A1|C#3 E3 A3',
             'B1|D3 F#3 B3', 'G1|D3 G3 B3', 'E2|E3 G3 B3', 'A1|C#3 E3 A3'],
    melody: `| A4 - D5 - - - E5 F#5 | G5 - - - E5 - C5 - | D5 - - - B4 - G4 B4 | A4 - - - - - . . |
             | A4 - D5 - - - F#5 A5 | G5 - E5 - G5 - C6 - | B5 - A5 - F#5 - D5 - | E5 - - - - - . . |
             | F#5 - - D5 B4 - D5 - | G5 - - F#5 E5 - D5 - | F#5 - - E5 D5 - A4 - | E5 - - - C#5 - E5 - |
             | F#5 - - D5 B4 - F#5 - | G5 - - A5 B5 - G5 - | E5 - - F#5 G5 - B5 - | A5 - - - - - . . |`,
    lead(a, o, t, f, d, v, c) {
      if (c.bar < 8) a._iBrass(o, t, f, d, v * 0.8);
      else a._iStrings(o, t, f, d, v * 0.75);
    },
    layers(a, c) {
      const { out, t, sd, inBar, chord, bar, loop } = c;
      const bassPat = [0, null, 0, 12, 0, null, 0, 7];
      const bp = bassPat[inBar];
      if (bp !== null) a._iBass(out, t, mtof(chord.bass + 12 + bp), sd * 0.9, 0.24);
      if (inBar === 0) a._iPad(out, t, chord.upper.map((m) => mtof(m + 12)), sd * 8.2, 0.045);
      if (inBar === 0 && bar % 2 === 0) chord.upper.forEach((m) => a._iBrass(out, t, mtof(m + 12), sd * 0.8, 0.05));
      if (inBar === 0 || inBar === 4 || (loop > 0 && inBar === 7)) a._dKick(out, t, 0.55);
      if (inBar === 2 || inBar === 6) a._dSnare(out, t, 0.25);
      a._dHat(out, t, inBar % 2 ? 0.035 : 0.06);
      if (bar === 0 && inBar === 0) a._dCrash(out, t, 0.12);
    },
  },

  forest: {
    bpm: 92, sub: 2, barSteps: 8, // Mi dórico misterioso
    chords: ['E2|E3 G3 B3 D4', 'A2|A3 C#4 E4', 'E2|E3 G3 B3 D4', 'A2|A3 C#4 E4',
             'G2|G3 B3 D4', 'D2|D3 F#3 A3', 'E2|E3 G3 B3 D4', 'A2|B3 D4 F#4'],
    melody: `| . . . . B4 - - - | C#5 - D5 - E5 - - - | - - - - . . G5 F#5 | E5 - - - C#5 - - - |
             | D5 - - - B4 - D5 - | F#5 - - - A5 - - - | G5 - F#5 - E5 - D5 - | E5 - - - - - - . |`,
    lead: (a, o, t, f, d, v) => a._iFlute(o, t, f, d, v * 0.8, 0.5),
    layers(a, c) {
      const { out, t, sd, inBar, chord } = c;
      const pat = [0, 2, 1, 3, 2, 1, 3, 2];
      const up = chord.upper;
      a._iMarimba(out, t, mtof(up[pat[inBar] % up.length] + 12), inBar % 2 ? 0.07 : 0.11);
      if (inBar === 0) {
        a._iBass(out, t, mtof(chord.bass), sd * 7.5, 0.2, true);
        a._iPad(out, t, up.map(mtof), sd * 8.5, 0.03);
      }
      if (inBar === 3 || inBar === 6) a._dWood(out, t, 0.06);
      if (inBar % 2 === 1) a._dShaker(out, t, 0.02);
    },
  },

  temple: {
    bpm: 70, sub: 2, barSteps: 8, // Ré frígio sombrio
    chords: ['D2|D3 F3 A3', 'Eb2|Eb3 G3 Bb3', 'D2|D3 F3 A3', 'C2|C3 Eb3 G3',
             'D2|D3 F3 A3', 'Eb2|Eb3 G3 Bb3', 'Bb1|Bb2 D3 F3', 'A1|A2 C#3 E3'],
    melody: `| D5 - - - - - Eb5 - | - - - - . . . . | C5 - - - Bb4 - A4 - | - - - - - - . . |
             | F5 - - - Eb5 - D5 - | - - - - . . . . | A4 - - - Bb4 - - - | A4 - - - - - - . |`,
    lead: (a, o, t, f, d, v) => a._iBell(o, t, f, v * 0.55),
    layers(a, c) {
      const { out, t, sd, inBar, chord, bar } = c;
      if (inBar === 0 && bar % 2 === 0) a._iDrone(out, t, mtof(38), sd * 17, 0.16);
      if (inBar === 0) a._iPad(out, t, chord.upper.map(mtof), sd * 8.4, 0.05, 500);
      if (inBar === 0) a._dTaiko(out, t, 0.55);
      if (inBar === 3) a._dTaiko(out, t, 0.22);
      if (inBar === 6) a._dTaiko(out, t, 0.35);
      if (bar % 4 === 3 && (inBar === 5 || inBar === 7)) a._dTaiko(out, t, 0.2);
      if (inBar === 4 && bar % 2 === 1) a._dChing(out, t, 0.05);
    },
  },

  boss: {
    bpm: 168, sub: 2, barSteps: 8, // Dó menor, intenso
    chords: ['C2|C3 Eb3 G3', 'Ab1|Ab2 C3 Eb3', 'Bb1|Bb2 D3 F3', 'G1|G2 B2 D3 F3',
             'C2|C3 Eb3 G3', 'Ab1|Ab2 C3 Eb3', 'F1|F2 Ab2 C3', 'G1|G2 B2 D3 F3'],
    melody: `| C5 - - G4 C5 - Eb5 - | D5 - C5 - Ab4 - - - | Bb4 - D5 - F5 - Bb5 - | B4 - - - D5 - F5 - |
             | G5 - - Eb5 C5 - G5 - | Ab5 - G5 - F5 - Eb5 - | F5 - Ab5 - C6 - Ab5 - | G5 - - - B4 - D5 - |`,
    lead(a, o, t, f, d, v, c) {
      a._iStrings(o, t, f, d, v * 0.7);
      if (c.loop % 2 === 1) a._iBrass(o, t, f / 2, d, v * 0.5);
    },
    layers(a, c) {
      const { out, t, sd, inBar, chord, bar } = c;
      const pat = [0, 0, 12, 0, 0, 12, 0, 10];
      a._iBass(out, t, mtof(chord.bass + 12 + pat[inBar]), sd * 0.85, 0.26, false, true);
      if (inBar === 0 || inBar === 3) chord.upper.forEach((m) => a._iBrass(out, t, mtof(m + 12), sd * 0.7, 0.055));
      if (inBar === 0 || inBar === 3 || inBar === 4) a._dKick(out, t, 0.6);
      if (inBar === 2 || inBar === 6) a._dSnare(out, t, 0.32);
      if (bar % 4 === 3 && inBar === 7) a._dSnare(out, t, 0.2);
      a._dHat(out, t, inBar % 2 ? 0.04 : 0.07);
      if (bar % 4 === 0 && inBar === 0) a._dCrash(out, t, 0.14);
      if (inBar % 2 === 0) a._iStrings(out, t, mtof(chord.upper[(inBar / 2) % chord.upper.length] + 24), sd * 0.9, 0.03);
    },
  },

  night: {
    bpm: 66, sub: 2, barSteps: 6, // Lá menor, quieto
    chords: ['A2|A3 C4 E4', 'F2|F3 A3 C4', 'C3|G3 C4 E4', 'E2|E3 G#3 B3',
             'A2|A3 C4 E4', 'D3|F3 A3 D4', 'E2|E3 G#3 B3', 'A2|A3 C4 E4'],
    melody: `| E5 - - - A5 - | G5 - F5 - - - | E5 - - - C5 - | B4 - - - - . |
             | C5 - E5 - A5 - | F5 - - - D5 - | G#5 - - - E5 - | A4 - - - - . |`,
    lead: (a, o, t, f, d, v) => a._iBell(o, t, f, v * 0.45, true),
    layers(a, c) {
      const { out, t, sd, inBar, chord } = c;
      if (inBar === 0) {
        a._iPad(out, t, chord.upper.map(mtof), sd * 6.5, 0.04, 700);
        a._iBass(out, t, mtof(chord.bass), sd * 5.5, 0.14, true);
      }
      if (inBar % 2 === 0) a._iHarp(out, t, mtof(chord.upper[(inBar / 2) % chord.upper.length] + 12), sd * 2, 0.045);
      if (Math.random() < 0.08) a._cricket(out, t + rand(0, sd));
    },
  },
};

// pré-processa
for (const tr of Object.values(TRACKS)) {
  tr._chords = tr.chords.map(parseChord);
  const mel = parseSeq(tr.melody);
  tr._mel = mel.events;
  tr.length = tr._chords.length * tr.barSteps;
  if (mel.length !== tr.length) console.warn('[audio] melodia com tamanho diferente', mel.length, tr.length);
}

// ---------------------------------------------------------------- sistema
export class AudioSys {
  constructor() {
    this.ctx = null;
    this.volume = 0.8;
    this._wantMusic = null;
    this._current = null;   // id da trilha
    this._tracks = [];      // trilhas tocando (inclui as em fade-out)
    this._fluteVoice = null;
    this._timer = null;
    this.tracks = TRACKS;
  }

  get ready() { return !!this.ctx; }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let ctx;
    try { ctx = new AC({ latencyHint: 'interactive' }); } catch { return; }
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.2;
    comp.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp);

    // reverb
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.8, 2.4);
    this.revIn = ctx.createGain(); this.revIn.gain.value = 1;
    const revOut = ctx.createGain(); revOut.gain.value = 0.38;
    this.revIn.connect(this.reverb); this.reverb.connect(revOut); revOut.connect(this.master);

    // barramentos
    this.musicDuck = ctx.createGain(); this.musicDuck.connect(this.master);
    this.musicBus = ctx.createGain(); this.musicBus.gain.value = 0.5;
    this.musicBus.connect(this.musicDuck);
    const mSend = ctx.createGain(); mSend.gain.value = 0.32;
    this.musicBus.connect(mSend); mSend.connect(this.revIn);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0.9; this.sfxBus.connect(this.master);
    this.sfxVerb = ctx.createGain(); this.sfxVerb.gain.value = 0.5; this.sfxVerb.connect(this.revIn);
    this.sfxVerb.connect(this.sfxBus);

    this.fluteBus = ctx.createGain(); this.fluteBus.gain.value = 0.85; this.fluteBus.connect(this.master);
    const fSend = ctx.createGain(); fSend.gain.value = 0.55;
    this.fluteBus.connect(fSend); fSend.connect(this.revIn);

    // ruído branco compartilhado
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    this._distCurve = (() => {
      const n = 1024, c = new Float32Array(n), k = 18;
      for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
      return c;
    })();

    this._timer = setInterval(() => this._tick(), 25);

    // retoma o contexto em gestos (políticas de autoplay)
    const resume = () => { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); };
    window.addEventListener('pointerdown', resume);
    window.addEventListener('keydown', resume);
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});

    if (this._wantMusic) { const w = this._wantMusic; this._wantMusic = null; this._current = null; this.setMusic(w); }
  }

  setMasterVolume(v) {
    this.volume = Math.max(0, Math.min(1, +v || 0));
    if (this.master) this.master.gain.setTargetAtTime(this.volume, this.ctx.currentTime, 0.05);
  }

  // ------------------------------------------------------------ helpers de síntese
  _impulse(seconds, decay) {
    const ctx = this.ctx, rate = ctx.sampleRate, len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const tt = i / len;
        let v = (Math.random() * 2 - 1) * Math.pow(1 - tt, decay);
        // reflexões iniciais esparsas
        if (i < rate * 0.08 && Math.random() < 0.004) v += (Math.random() * 2 - 1) * 0.8;
        data[i] = v * (i < 64 ? i / 64 : 1);
      }
    }
    return buf;
  }

  _gain(v, dest) { const g = this.ctx.createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }

  _osc(type, f, t, dest) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(f, t);
    if (dest) o.connect(dest);
    o.start(t);
    return o;
  }

  _filter(type, f, q = 1, dest) {
    const fl = this.ctx.createBiquadFilter();
    fl.type = type; fl.frequency.value = f; fl.Q.value = q;
    if (dest) fl.connect(dest);
    return fl;
  }

  _noiseSrc(t, dur, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noiseBuf; s.loop = true;
    if (dest) s.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
    return s;
  }

  /** envelope ADSR-ish num GainNode: ataque linear, decaimento exponencial */
  _env(g, t, attack, peak, dur, release = 0.1, sustain = 1) {
    const p = g.gain;
    p.cancelScheduledValues(t);
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + attack);
    if (sustain < 1) p.setTargetAtTime(peak * sustain, t + attack, Math.max(0.01, (dur - attack) / 3));
    p.setValueAtTime(Math.max(0.0001, peak * sustain), t + Math.max(attack, dur));
    p.exponentialRampToValueAtTime(0.0001, t + Math.max(attack, dur) + release);
    return t + Math.max(attack, dur) + release;
  }

  _perc(g, t, attack, peak, decay) {
    const p = g.gain;
    p.setValueAtTime(0.0001, t);
    p.linearRampToValueAtTime(peak, t + attack);
    p.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return t + attack + decay;
  }

  /** tom simples com glide */
  _tone({ type = 'sine', f0, f1 = f0, t, dur, vol = 0.2, attack = 0.005, dest, filter, q = 1, curve = 'exp' }) {
    const ctx = this.ctx;
    const g = this._gain(0, dest || this.sfxBus);
    let node = g;
    if (filter) node = this._filter('lowpass', filter, q, g);
    const o = this._osc(type, f0, t, node);
    if (f1 !== f0) {
      if (curve === 'exp') o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
      else o.frequency.linearRampToValueAtTime(f1, t + dur);
    }
    const end = this._perc(g, t, attack, vol, dur);
    o.stop(end + 0.02);
    void ctx;
    return o;
  }

  /** ruído filtrado com varredura */
  _noise({ t, dur, vol = 0.3, type = 'bandpass', f0 = 1000, f1 = f0, q = 1, attack = 0.005, dest }) {
    const g = this._gain(0, dest || this.sfxBus);
    const fl = this._filter(type, f0, q, g);
    if (f1 !== f0) fl.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    this._noiseSrc(t, dur + attack, fl);
    this._perc(g, t, attack, vol, dur);
    return fl;
  }

  _shaper(dest) {
    const s = this.ctx.createWaveShaper();
    s.curve = this._distCurve; s.oversample = '2x';
    if (dest) s.connect(dest);
    return s;
  }

  // ------------------------------------------------------------ instrumentos
  _iFlute(out, t, f, dur, vol, breath = 1) {
    const ctx = this.ctx;
    const g = this._gain(0, out);
    const lp = this._filter('lowpass', Math.min(f * 6, 9000), 0.7, g);
    const o1 = this._osc('sine', f, t, lp);
    const o2 = this._osc('triangle', f, t);
    const g2 = this._gain(0.28, lp); o2.connect(g2);
    const o3 = this._osc('sine', f * 2, t);
    const g3 = this._gain(0.06, lp); o3.connect(g3);
    // vibrato com entrada atrasada
    const lfo = this._osc('sine', 5.2 + Math.random() * 0.6, t);
    const vd = this._gain(0, null);
    lfo.connect(vd); vd.connect(o1.frequency); vd.connect(o2.frequency);
    vd.gain.setValueAtTime(0, t);
    vd.gain.linearRampToValueAtTime(f * 0.0065, t + Math.min(dur, 0.35) + 0.15);
    // sopro
    const nb = this._gain(0, g);
    const bp = this._filter('bandpass', f * 2.2, 1.6, nb);
    this._noiseSrc(t, dur + 0.3, bp);
    nb.gain.setValueAtTime(0.0001, t);
    nb.gain.linearRampToValueAtTime(0.35 * breath, t + 0.03);
    nb.gain.setTargetAtTime(0.06 * breath, t + 0.05, 0.08);
    nb.gain.setTargetAtTime(0.0001, t + dur, 0.06);
    const end = this._env(g, t, 0.07, vol, dur, 0.18, 0.85);
    // ligeiro "scoop" de afinação no ataque
    o1.frequency.setValueAtTime(f * 0.985, t); o1.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    [o1, o2, o3, lfo].forEach((o) => o.stop(end + 0.05));
    void ctx;
    return { g, end, oscs: [o1, o2, o3, lfo] };
  }

  _iPluck(out, t, f, dur, vol, bright = 1) {
    const g = this._gain(0, out);
    const lp = this._filter('lowpass', f * 8 * bright, 2.5, g);
    lp.frequency.setValueAtTime(Math.min(f * 10 * bright, 12000), t);
    lp.frequency.exponentialRampToValueAtTime(f * 1.4, t + 0.25);
    const o1 = this._osc('triangle', f, t, lp);
    const o2 = this._osc('sawtooth', f * 1.004, t);
    const g2 = this._gain(0.35, lp); o2.connect(g2);
    const end = this._perc(g, t, 0.003, vol, Math.min(dur + 0.35, 1.4));
    o1.stop(end); o2.stop(end);
  }

  _iHarp(out, t, f, dur, vol) {
    const g = this._gain(0, out);
    const o1 = this._osc('sine', f, t, g);
    const o2 = this._osc('triangle', f * 2, t);
    const g2 = this._gain(0.18, g); o2.connect(g2);
    const end = this._perc(g, t, 0.004, vol, Math.max(1.2, dur));
    o1.stop(end); o2.stop(end);
  }

  _iMarimba(out, t, f, vol) {
    const g = this._gain(0, out);
    const o1 = this._osc('sine', f, t, g);
    const end = this._perc(g, t, 0.002, vol, 0.55);
    const g2 = this._gain(0, out);
    const o2 = this._osc('sine', f * 3.99, t, g2);
    this._perc(g2, t, 0.001, vol * 0.4, 0.07);
    o1.stop(end); o2.stop(t + 0.15);
  }

  _iBell(out, t, f, vol, soft = false) {
    const parts = soft ? [[1, 1, 2.2], [2, 0.25, 0.9]] : [[1, 1, 3.0], [2.76, 0.35, 1.0], [5.4, 0.15, 0.35], [0.5, 0.25, 2.5]];
    let end = t;
    for (const [mul, a, dec] of parts) {
      const g = this._gain(0, out);
      const o = this._osc('sine', f * mul, t, g);
      const e = this._perc(g, t, 0.002, vol * a, dec);
      o.stop(e); end = Math.max(end, e);
    }
    return end;
  }

  _iPad(out, t, freqs, dur, vol, cutoff = 1100) {
    const g = this._gain(0, out);
    const lp = this._filter('lowpass', cutoff, 0.6, g);
    const oscs = [];
    for (const f of freqs) {
      for (const det of [-7, 6]) {
        const o = this._osc('sawtooth', f, t, lp);
        o.detune.value = det + Math.random() * 3;
        oscs.push(o);
      }
    }
    const end = this._env(g, t, Math.min(0.6, dur * 0.3), vol / Math.sqrt(freqs.length), dur, 0.7);
    oscs.forEach((o) => o.stop(end + 0.05));
  }

  _iStrings(out, t, f, dur, vol) {
    const g = this._gain(0, out);
    const lp = this._filter('lowpass', Math.min(f * 5, 5000), 0.8, g);
    const lfo = this._osc('sine', 5.5, t);
    const vd = this._gain(f * 0.004, null); lfo.connect(vd);
    const os = [-8, 7].map((det) => { const o = this._osc('sawtooth', f, t, lp); o.detune.value = det; vd.connect(o.frequency); return o; });
    const end = this._env(g, t, 0.05, vol, dur * 0.95, 0.12, 0.85);
    [...os, lfo].forEach((o) => o.stop(end + 0.05));
  }

  _iBrass(out, t, f, dur, vol) {
    const g = this._gain(0, out);
    const lp = this._filter('lowpass', f * 1.2, 1.2, g);
    lp.frequency.setValueAtTime(f * 1.2, t);
    lp.frequency.linearRampToValueAtTime(Math.min(f * 7, 6000), t + 0.05);
    lp.frequency.setTargetAtTime(f * 3.5, t + 0.06, 0.15);
    const o1 = this._osc('sawtooth', f, t, lp);
    const o2 = this._osc('square', f * 0.5, t);
    const g2 = this._gain(0.25, lp); o2.connect(g2);
    o1.detune.value = 4;
    const end = this._env(g, t, 0.025, vol, dur * 0.92, 0.1, 0.8);
    o1.stop(end + 0.05); o2.stop(end + 0.05);
  }

  _iBass(out, t, f, dur, vol, soft = false, gritty = false) {
    const g = this._gain(0, out);
    const lp = this._filter('lowpass', gritty ? 900 : soft ? 300 : 600, 1, g);
    const o1 = this._osc(gritty ? 'sawtooth' : 'triangle', f, t, lp);
    const o2 = this._osc('sine', f / 2, t);
    const g2 = this._gain(soft ? 0.6 : 0.4, lp); o2.connect(g2);
    const end = this._env(g, t, soft ? 0.08 : 0.008, vol, dur, soft ? 0.4 : 0.08, 0.75);
    o1.stop(end + 0.05); o2.stop(end + 0.05);
  }

  _iDrone(out, t, f, dur, vol) {
    const g = this._gain(0, out);
    const lp = this._filter('lowpass', 220, 3, g);
    const lfo = this._osc('sine', 0.13, t);
    const ld = this._gain(140, lp.frequency); lfo.connect(ld);
    const os = [[f, 0], [f * 1.002, 0], [f * 1.5, 0], [f / 2, 0]].map(([fr]) => this._osc('sawtooth', fr, t, lp));
    const end = this._env(g, t, 1.5, vol, dur, 1.5);
    [...os, lfo].forEach((o) => o.stop(end + 0.05));
  }

  _cricket(out, t) {
    const f = rand(4200, 5200);
    for (let k = 0; k < 3; k++) {
      const tt = t + k * 0.06;
      const g = this._gain(0, out);
      const o = this._osc('sine', f, tt, g);
      o.stop(this._perc(g, tt, 0.004, 0.012, 0.035) + 0.01);
    }
  }

  // ------------------------------------------------------------ percussão
  _dKick(out, t, vol) {
    const g = this._gain(0, out);
    const o = this._osc('sine', 150, t, g);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    o.stop(this._perc(g, t, 0.002, vol, 0.28));
  }
  _dSnare(out, t, vol) {
    this._noise({ t, dur: 0.16, vol, type: 'bandpass', f0: 1900, f1: 1400, q: 0.8, dest: out });
    const g = this._gain(0, out);
    const o = this._osc('triangle', 210, t, g);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.06);
    o.stop(this._perc(g, t, 0.001, vol * 0.6, 0.09));
  }
  _dHat(out, t, vol) { this._noise({ t, dur: 0.04, vol, type: 'highpass', f0: 7500, q: 0.7, dest: out }); }
  _dShaker(out, t, vol) { this._noise({ t, dur: 0.06, vol, type: 'bandpass', f0: 6000, q: 1.5, attack: 0.012, dest: out }); }
  _dCrash(out, t, vol) { this._noise({ t, dur: 1.4, vol, type: 'highpass', f0: 5000, f1: 3000, q: 0.5, dest: out }); }
  _dWood(out, t, vol) {
    const g = this._gain(0, out);
    const o = this._osc('sine', 820, t, g);
    o.stop(this._perc(g, t, 0.001, vol, 0.06));
  }
  _dTaiko(out, t, vol) {
    const g = this._gain(0, out);
    const o = this._osc('sine', 95, t, g);
    o.frequency.exponentialRampToValueAtTime(52, t + 0.3);
    o.stop(this._perc(g, t, 0.003, vol, 0.6));
    this._noise({ t, dur: 0.12, vol: vol * 0.35, type: 'lowpass', f0: 500, q: 0.7, dest: out });
  }
  _dTimpani(out, t, f, vol) {
    while (f > 110) f /= 2;
    const g = this._gain(0, out);
    const o = this._osc('sine', f * 1.03, t, g);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.1);
    o.stop(this._perc(g, t, 0.004, vol, 1.3));
  }
  _dChing(out, t, vol) {
    for (const m of [1, 1.47, 2.09, 2.83]) {
      const g = this._gain(0, out);
      const o = this._osc('sine', 1900 * m, t, g);
      o.stop(this._perc(g, t, 0.002, vol / 2, 1.2 / m));
    }
  }

  // ------------------------------------------------------------ música
  setMusic(track) {
    if (track && !TRACKS[track]) { console.warn('[audio] trilha desconhecida', track); track = null; }
    if (!this.ctx) { this._wantMusic = track; this._current = track; return; }
    if (track === this._current && (track === null || this._tracks.some((tr) => tr.id === track && !tr.stopAt))) return;
    this._current = track;
    const now = this.ctx.currentTime;
    const FADE = 1.5;
    for (const tr of this._tracks) {
      if (tr.stopAt) continue;
      tr.gain.gain.cancelScheduledValues(now);
      tr.gain.gain.setValueAtTime(tr.gain.gain.value, now);
      tr.gain.gain.linearRampToValueAtTime(0.0001, now + FADE);
      tr.stopAt = now + FADE + 0.1;
    }
    if (!track) return;
    const def = TRACKS[track];
    const gain = this._gain(0, this.musicBus);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(1, now + FADE);
    this._tracks.push({ id: track, def, gain, step: 0, loop: 0, nextTime: now + 0.08, stopAt: 0 });
  }

  _tick() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const now = ctx.currentTime, ahead = now + 0.12;
    for (let i = this._tracks.length - 1; i >= 0; i--) {
      const tr = this._tracks[i];
      if (tr.stopAt && now > tr.stopAt) {
        setTimeout(() => { try { tr.gain.disconnect(); } catch { /* */ } }, 3000);
        this._tracks.splice(i, 1);
        continue;
      }
      const def = tr.def, sd = 60 / def.bpm / def.sub;
      // aba em segundo plano / travamento: ressincroniza em vez de despejar notas atrasadas
      if (tr.nextTime < now - 0.25) tr.nextTime = now + 0.05;
      while (tr.nextTime < ahead) {
        if (!tr.stopAt || tr.nextTime < tr.stopAt) this._scheduleStep(tr, tr.step, tr.nextTime, sd);
        tr.step++;
        if (tr.step >= def.length) { tr.step = 0; tr.loop++; }
        tr.nextTime += sd;
      }
    }
  }

  _scheduleStep(tr, s, t, sd) {
    const def = tr.def;
    const bar = Math.floor(s / def.barSteps), inBar = s % def.barSteps;
    const chord = def._chords[bar];
    const c = { out: tr.gain, t, sd, s, bar, inBar, chord, loop: tr.loop };
    try {
      const evs = def._mel.get(s);
      if (evs) for (const ev of evs) def.lead(this, tr.gain, t + rand(0, 0.006), mtof(ev.midi), ev.len * sd, rand(0.82, 0.95), c);
      def.layers(this, c);
    } catch (e) { console.warn('[audio] erro ao agendar', e); }
  }

  // ------------------------------------------------------------ flauta
  _noteFreq(i) { return mtof(FLUTE_MIDI[Math.max(0, Math.min(4, i | 0))]); }

  _duck(t, hold) {
    const p = this.musicDuck.gain;
    p.cancelScheduledValues(t);
    p.setTargetAtTime(0.3, t, 0.06);
    p.setTargetAtTime(1, t + hold, 0.45);
  }

  playNote(i, when = 0, dur = 1.1) {
    if (!this.ctx) return;
    const t = Math.max(this.ctx.currentTime + 0.005, when || 0);
    // monofônica: corta a nota anterior suavemente
    const prev = this._fluteVoice;
    if (prev && prev.end > t) {
      prev.g.gain.cancelScheduledValues(t);
      prev.g.gain.setTargetAtTime(0.0001, t, 0.03);
      prev.oscs.forEach((o) => { try { o.stop(t + 0.2); } catch { /* */ } });
    }
    this._fluteVoice = this._iFlute(this.fluteBus, t, this._noteFreq(i), dur, 0.42);
    this._duck(t, dur + 0.2);
  }

  playMelody(notes) {
    if (!this.ctx || !notes || !notes.length) return Promise.resolve();
    const gap = 0.42;
    const t0 = this.ctx.currentTime + 0.05;
    notes.forEach((n, k) => {
      const last = k === notes.length - 1;
      this.playNote(n, t0 + k * gap, last ? 1.4 : gap * 0.95);
    });
    // a chamada sequencial cancela notas anteriores corretamente porque cada uma é agendada no futuro;
    // o voice "anterior" só é cortado a partir do início da seguinte.
    const total = (notes.length - 1) * gap + 1.6;
    return new Promise((res) => setTimeout(res, total * 1000));
  }

  // ------------------------------------------------------------ efeitos
  sfx(name) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + 0.005;
    const fn = this['_sfx_' + name];
    if (!fn) { console.warn('[audio] sfx desconhecido', name); return; }
    try { fn.call(this, t); } catch (e) { console.warn('[audio] sfx falhou', name, e); }
  }

  _sfx_swing(t) {
    this._noise({ t, dur: 0.17, vol: 0.45, type: 'bandpass', f0: 600, f1: 2800, q: 1.4, attack: 0.03 });
    this._tone({ type: 'sine', f0: 320, f1: 170, t, dur: 0.12, vol: 0.06 });
  }
  _sfx_swing2(t) {
    this._noise({ t, dur: 0.15, vol: 0.45, type: 'bandpass', f0: 900, f1: 4000, q: 1.6, attack: 0.02 });
    this._tone({ type: 'sine', f0: 420, f1: 220, t, dur: 0.1, vol: 0.06 });
  }
  _sfx_spin(t) {
    this._noise({ t, dur: 0.25, vol: 0.4, type: 'bandpass', f0: 400, f1: 3200, q: 1.2, attack: 0.05 });
    this._noise({ t: t + 0.2, dur: 0.3, vol: 0.38, type: 'bandpass', f0: 3200, f1: 700, q: 1.2, attack: 0.02 });
    this._tone({ type: 'triangle', f0: 220, f1: 880, t, dur: 0.45, vol: 0.12, attack: 0.08, dest: this.sfxVerb });
  }
  _crunch(t, vol, f0 = 220, f1 = 55) {
    const sh = this._shaper(this.sfxBus);
    const g = this._gain(0, sh);
    const o = this._osc('square', f0, t, g);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.12);
    o.stop(this._perc(g, t, 0.001, vol * 0.5, 0.13));
    this._noise({ t, dur: 0.09, vol: vol * 0.7, type: 'lowpass', f0: 3200, f1: 600, q: 0.8 });
    this._noise({ t, dur: 0.015, vol: vol * 0.5, type: 'highpass', f0: 3000, q: 0.5 });
  }
  _sfx_hit(t) { this._crunch(t, 0.6); }
  _sfx_enemyHit(t) {
    this._crunch(t, 0.55, 260, 70);
    this._tone({ type: 'square', f0: 900, f1: 450, t: t + 0.01, dur: 0.07, vol: 0.06, filter: 3000 });
  }
  _sfx_enemyDie(t) {
    const sh = this._shaper(this.sfxBus);
    const g = this._gain(0, sh);
    const o = this._osc('square', 720, t, g);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.38);
    o.stop(this._perc(g, t, 0.003, 0.18, 0.4));
    this._noise({ t, dur: 0.45, vol: 0.4, type: 'lowpass', f0: 1600, f1: 150, q: 0.7 });
    [96, 100, 103].forEach((m, k) => this._tone({ type: 'triangle', f0: mtof(m), t: t + 0.22 + k * 0.05, dur: 0.25, vol: 0.05, dest: this.sfxVerb }));
  }
  _sfx_hurt(t) {
    const g = this._gain(0, this.sfxBus);
    const lp = this._filter('lowpass', 1800, 1, g);
    const o = this._osc('sawtooth', 540, t, lp);
    o.frequency.exponentialRampToValueAtTime(170, t + 0.25);
    const lfo = this._osc('sine', 28, t); const ld = this._gain(40, o.frequency); lfo.connect(ld);
    const end = this._perc(g, t, 0.004, 0.28, 0.27);
    o.stop(end); lfo.stop(end);
    this._noise({ t, dur: 0.06, vol: 0.3, type: 'lowpass', f0: 2000, q: 0.7 });
  }
  _sfx_block(t) {
    [1320, 1993, 2711, 3590, 4870].forEach((f, k) => {
      this._tone({ type: 'sine', f0: f * rand(0.99, 1.01), t, dur: 0.5 - k * 0.07, vol: 0.13 - k * 0.018, attack: 0.001, dest: this.sfxVerb });
    });
    this._noise({ t, dur: 0.03, vol: 0.4, type: 'highpass', f0: 4000, q: 0.7 });
    this._tone({ type: 'triangle', f0: 260, f1: 180, t, dur: 0.06, vol: 0.12 });
  }
  _sfx_roll(t) {
    this._noise({ t, dur: 0.22, vol: 0.4, type: 'lowpass', f0: 250, f1: 900, q: 1.5, attack: 0.03 });
    this._noise({ t: t + 0.18, dur: 0.18, vol: 0.25, type: 'lowpass', f0: 900, f1: 250, q: 1.5, attack: 0.01 });
  }
  _arp(t, midis, gap, opts = {}) {
    midis.forEach((m, k) => this._tone({ type: opts.type || 'triangle', f0: mtof(m), t: t + k * gap, dur: opts.dur || 0.2, vol: opts.vol || 0.12, attack: 0.003, dest: this.sfxVerb }));
  }
  _sfx_pickupGem(t) { this._arp(t, [88, 92, 95, 100], 0.055, { vol: 0.11, dur: 0.22 }); }
  _sfx_pickupHeart(t) { this._arp(t, [72, 76, 79, 84, 88], 0.06, { type: 'sine', vol: 0.16, dur: 0.35 }); }
  _sfx_chest(t) {
    // rangido da tampa
    const g = this._gain(0, this.sfxBus);
    const bp = this._filter('bandpass', 700, 7, g);
    const o = this._osc('sawtooth', 85, t, bp);
    o.frequency.linearRampToValueAtTime(140, t + 0.35);
    o.frequency.linearRampToValueAtTime(95, t + 0.7);
    const lfo = this._osc('square', 23, t); const ld = this._gain(18, o.frequency); lfo.connect(ld);
    const end = this._env(g, t, 0.05, 0.35, 0.65, 0.1);
    o.stop(end); lfo.stop(end);
    this._tone({ type: 'sine', f0: 110, f1: 60, t: t + 0.72, dur: 0.25, vol: 0.4 });
    this._arp(t + 0.85, [79, 83, 86, 91, 95, 98], 0.06, { type: 'sine', vol: 0.09, dur: 0.6 });
  }
  _sfx_itemGet(t) {
    const out = this.sfxVerb;
    [[67, 0, 0.13], [69, 0.13, 0.13], [72, 0.26, 0.13], [76, 0.4, 1.0]].forEach(([m, dt, d]) => {
      this._iBrass(out, t + dt, mtof(m), d, 0.16);
      this._iBrass(out, t + dt, mtof(m - 12), d, 0.06);
    });
    this._iPad(out, t + 0.4, [60, 64, 67, 72].map(mtof), 1.1, 0.12, 2200);
    this._dTimpani(out, t + 0.4, mtof(48), 0.35);
    this._arp(t + 0.45, [84, 88, 91, 96, 100], 0.07, { type: 'sine', vol: 0.06, dur: 0.6 });
  }
  _sfx_door(t) {
    const g = this._gain(0, this.sfxBus);
    const lp = this._filter('lowpass', 180, 1.2, g);
    this._noiseSrc(t, 2.3, lp);
    const lfo = this._osc('sine', 7, t); const ld = this._gain(0.12, g.gain); lfo.connect(ld);
    const end = this._env(g, t, 0.2, 0.7, 1.8, 0.4);
    lfo.stop(end);
    this._tone({ type: 'sine', f0: 48, f1: 40, t, dur: 2.2, vol: 0.35, attack: 0.25 });
    this._noise({ t: t + 0.1, dur: 1.8, vol: 0.12, type: 'bandpass', f0: 420, f1: 300, q: 3, attack: 0.3 });
    this._tone({ type: 'sine', f0: 90, f1: 40, t: t + 2.0, dur: 0.4, vol: 0.5 });
  }
  _sfx_secret(t) {
    this._arp(t, [74, 77, 81, 84, 86, 89, 93, 98], 0.085, { type: 'sine', vol: 0.12, dur: 0.7 });
    this._iPad(this.sfxVerb, t + 0.2, [62, 69, 74, 77].map(mtof), 1.3, 0.08, 2600);
  }
  _sfx_lock(t) {
    this._tone({ type: 'sine', f0: 130, f1: 60, t, dur: 0.16, vol: 0.45 });
    this._noise({ t, dur: 0.025, vol: 0.35, type: 'highpass', f0: 3000, q: 0.7 });
    this._iBell(this.sfxVerb, t + 0.02, 620, 0.08);
  }
  _sfx_unlock(t) {
    this._noise({ t, dur: 0.02, vol: 0.35, type: 'highpass', f0: 3500, q: 0.7 });
    this._noise({ t: t + 0.09, dur: 0.02, vol: 0.3, type: 'highpass', f0: 2600, q: 0.7 });
    this._iBell(this.sfxVerb, t + 0.15, mtof(84), 0.12);
    this._iBell(this.sfxVerb, t + 0.29, mtof(91), 0.12);
  }
  _sfx_talk(t) {
    this._tone({ type: 'square', f0: rand(560, 820), t, dur: 0.035, vol: 0.035, filter: 2200 });
  }
  _sfx_menu(t) {
    this._tone({ type: 'sine', f0: 1180, f1: 1500, t, dur: 0.06, vol: 0.12 });
    this._noise({ t, dur: 0.01, vol: 0.08, type: 'highpass', f0: 5000 });
  }
  _sfx_bossRoar(t) {
    const sh = this._shaper(this.sfxVerb);
    const g = this._gain(0, sh);
    const lp = this._filter('lowpass', 900, 2, g);
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.linearRampToValueAtTime(1200, t + 0.4);
    lp.frequency.linearRampToValueAtTime(300, t + 1.8);
    const o1 = this._osc('sawtooth', 110, t, lp);
    const o2 = this._osc('sawtooth', 83, t, lp);
    o1.frequency.linearRampToValueAtTime(70, t + 1.8);
    o2.frequency.linearRampToValueAtTime(48, t + 1.8);
    const lfo = this._osc('sine', 9, t); const ld = this._gain(14, null); lfo.connect(ld);
    ld.connect(o1.frequency); ld.connect(o2.frequency);
    const end = this._env(g, t, 0.15, 0.22, 1.6, 0.4);
    [o1, o2, lfo].forEach((o) => o.stop(end));
    this._noise({ t, dur: 1.9, vol: 0.35, type: 'lowpass', f0: 700, f1: 200, q: 1, attack: 0.2 });
  }
  _sfx_bossHit(t) {
    this._tone({ type: 'sine', f0: 95, f1: 35, t, dur: 0.45, vol: 0.7 });
    this._crunch(t, 0.6, 180, 40);
    [310, 527, 801].forEach((f) => this._tone({ type: 'sine', f0: f, t, dur: 0.6, vol: 0.06, dest: this.sfxVerb }));
  }
  _sfx_victory(t) {
    const out = this.sfxVerb;
    const seq = [[72, 0, 0.18], [76, 0.18, 0.18], [79, 0.36, 0.18], [84, 0.54, 0.5],
                 [81, 1.08, 0.2], [83, 1.3, 0.2], [84, 1.52, 1.4]];
    seq.forEach(([m, dt, d]) => { this._iBrass(out, t + dt, mtof(m), d, 0.15); this._iBrass(out, t + dt, mtof(m - 12), d, 0.06); });
    this._iPad(out, t, [60, 64, 67].map(mtof), 1.0, 0.1, 2000);
    this._iPad(out, t + 1.08, [65, 69, 72].map(mtof), 0.42, 0.1, 2000);
    this._iPad(out, t + 1.52, [60, 64, 67, 72].map(mtof), 1.6, 0.13, 2400);
    [0, 0.54, 1.08, 1.52].forEach((dt) => this._dTimpani(out, t + dt, mtof(48), 0.35));
    this._dCrash(out, t + 1.52, 0.12);
    this._arp(t + 1.6, [84, 88, 91, 96, 100, 103], 0.08, { type: 'sine', vol: 0.05, dur: 0.8 });
  }
  _sfx_lowHealth(t) {
    this._tone({ type: 'sine', f0: 988, t, dur: 0.09, vol: 0.1 });
    this._tone({ type: 'sine', f0: 988, t: t + 0.15, dur: 0.09, vol: 0.1 });
  }
  _sfx_step(t) {
    this._noise({ t, dur: 0.05, vol: rand(0.06, 0.1), type: 'lowpass', f0: rand(450, 750), q: 0.8, attack: 0.004 });
  }
  _sfx_grassCut(t) {
    this._noise({ t, dur: 0.12, vol: 0.28, type: 'bandpass', f0: 5000, f1: 2500, q: 0.9, attack: 0.004 });
    this._noise({ t: t + 0.03, dur: 0.08, vol: 0.12, type: 'highpass', f0: 3000, q: 0.7 });
  }
  _sfx_error(t) {
    this._tone({ type: 'square', f0: 220, t, dur: 0.1, vol: 0.12, filter: 1400 });
    this._tone({ type: 'square', f0: 165, t: t + 0.12, dur: 0.18, vol: 0.12, filter: 1200 });
  }
}
