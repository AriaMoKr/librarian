// @ts-check
// The librarian's voice (docs/LIBRARIAN.md, experiment 1 step 4; SPEC §5.10): his answers said
// aloud with the browser's speech synthesis, once the visitor has chosen it ("The librarian speaks
// his answers", off at first: librarian.js). A new question stops the last answer (card.js).
// - Only a voice of the device's own (`localService`): a network voice (Chrome's "Google …", Edge's
//   "… Online") would send the answer's words, and so the question's, to its service.
// - English first: an English voice, a man's where one is known by name (the Librarian is a
//   silver-haired man), else the browser's default, else American or British English.
// - The voices come after the page in Chrome (`voiceschanged`): until then there is none.

/**
 * Voices known by name to be men's (Windows, macOS, iOS, Chrome's): his, when the device has one.
 * Not the novelty voices (macOS's Fred, Albert, Ralph, …).
 */
const MEN = /\b(david|mark|guy|daniel|arthur|oliver|aaron|alex|tom|rishi|george|james|ryan|thomas|male)\b/i;

/** Speech settings: a little slower than the default, as someone who means each word. */
const RATE = 0.95;

/**
 * The voice he speaks with: of the device's own and English; a man's known by name first, then the
 * browser's default, then American or British English, else the first; null for none.
 * @param {ArrayLike<SpeechSynthesisVoice>} voices
 * @returns {SpeechSynthesisVoice | null}
 */
export function chooseVoice(voices) {
  let best = null;
  let bestScore = -1;
  for (const v of Array.from(voices)) {
    if (v.localService === false || !/^en(?:[-_]|$)/i.test(v.lang || '')) continue;
    const score = (MEN.test(v.name) ? 4 : 0) + (v.default ? 2 : 0) + (/^en[-_](?:us|gb)\b/i.test(v.lang) ? 1 : 0);
    if (score > bestScore) {
      best = v;
      bestScore = score;
    }
  }
  return best;
}

/**
 * An answer as he says it: a library's "·" a pause, its class code ("(P)") left out.
 * @param {string} text
 */
export function spoken(text) {
  return text.replace(/\s*·\s*/g, ', ').replace(/\s*\([A-Z]{1,3}\)/g, '');
}

export class Voice {
  /**
   * @param {object} [o]
   * @param {SpeechSynthesis | null} [o.synth] the browser's speech synthesis (none: null)
   * @param {typeof SpeechSynthesisUtterance} [o.Utterance]
   */
  constructor({ synth = globalThis.speechSynthesis ?? null, Utterance = globalThis.SpeechSynthesisUtterance } = {}) {
    /** @type {SpeechSynthesis | null} */
    this.synth = synth && Utterance ? synth : null;
    this.Utterance = Utterance;
    /** The voice he speaks with, or null. @type {SpeechSynthesisVoice | null} */
    this.voice = null;
    /** Told when the voices change (Chrome's come after the page): available may have changed. @type {(() => void) | null} */
    this.onChange = null;
    if (!this.synth) return;
    this._pick();
    this.synth.addEventListener?.('voiceschanged', () => {
      this._pick();
      this.onChange?.();
    });
  }

  _pick() {
    try {
      this.voice = chooseVoice(this.synth?.getVoices() ?? []);
    } catch {
      this.voice = null;
    }
  }

  /** Whether he has a voice here. */
  get available() {
    return !!this.voice;
  }

  /**
   * Says it, after stopping what he was saying.
   * @param {string} text
   */
  say(text) {
    const synth = this.synth;
    if (!synth || !this.voice || !text) return;
    synth.cancel();
    const u = new this.Utterance(spoken(text));
    u.voice = this.voice;
    u.lang = this.voice.lang;
    u.rate = RATE;
    synth.speak(u);
  }

  /** Stops what he is saying, and what he was about to. */
  stop() {
    const synth = this.synth;
    if (synth && (synth.speaking || synth.pending)) synth.cancel();
  }
}
