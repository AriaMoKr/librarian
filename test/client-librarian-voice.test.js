// The librarian's voice (public/js/librarian/voice.js; SPEC §5.10): which voice he speaks with (the
// device's own, English, a man's by name first), his answers as he says them, and the Voice over a
// stand-in for the browser's speech synthesis.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { chooseVoice, spoken, Voice } from '../public/js/librarian/voice.js';

/** A voice as getVoices() lists it: the device's own unless said. */
const v = (name, lang, o = {}) => ({ name, lang, voiceURI: name, localService: true, default: false, ...o });

/** A stand-in for speechSynthesis: what it was given to say, and how often it was stopped. */
function fakeSynth(voices = []) {
  return Object.assign(new EventTarget(), {
    voices, said: [], cancels: 0, speaking: false, pending: false,
    getVoices() { return this.voices; },
    speak(u) {
      this.said.push(u);
      this.speaking = true;
    },
    cancel() {
      this.cancels++;
      this.speaking = false;
      this.pending = false;
    },
  });
}
class Utterance {
  constructor(text) {
    this.text = text;
  }
}

describe('the librarian: his voice', () => {
  it('is one of the device\'s own and English, a man\'s first, else the default, else American or British', () => {
    const chrome = [
      v('Microsoft Zira - English (United States)', 'en-US', { default: true }),
      v('Microsoft David - English (United States)', 'en-US'),
      v('Google US English', 'en-US', { localService: false }),
      v('Google UK English Male', 'en-GB', { localService: false }),
      v('Microsoft Hedda - German (Germany)', 'de-DE'),
    ];
    assert.equal(chooseVoice(chrome)?.name, 'Microsoft David - English (United States)');
    assert.equal(chooseVoice([v('English Female', 'en-US'), v('English Male', 'en-US')])?.name, 'English Male');
    assert.equal(chooseVoice([v('Fred', 'en-US'), v('Daniel', 'en-GB')])?.name, 'Daniel', 'not the novelty voices');
    assert.equal(chooseVoice([v('Karen', 'en-AU'), v('Samantha', 'en-US', { default: true }), v('Moira', 'en-IE')])?.name, 'Samantha');
    assert.equal(chooseVoice([v('Karen', 'en-AU'), v('Tessa', 'en-ZA'), v('Kate', 'en_GB')])?.name, 'Kate', 'as Android writes it');
    assert.equal(chooseVoice([v('Karen', 'en-AU'), v('Tessa', 'en-ZA')])?.name, 'Karen');
  });

  it('is none where the device has only network voices or none in English', () => {
    assert.equal(chooseVoice([v('Google US English', 'en-US', { localService: false }), v('Microsoft Guy Online (Natural)', 'en-US', { localService: false })]), null);
    assert.equal(chooseVoice([v('Thomas', 'fr-FR'), v('Anna', 'de-DE'), v('Eng', 'eng')]), null);
    assert.equal(chooseVoice([]), null);
  });

  it('says a library\'s name as words', () => {
    assert.equal(spoken('I have Emma, by Jane Austen, in Gutenberg · Language and literature (P).'), 'I have Emma, by Jane Austen, in Gutenberg, Language and literature.');
    assert.equal(spoken('I have 2 articles for “x”, in WikiMed Medical Encyclopedia (introductions).'), 'I have 2 articles for “x”, in WikiMed Medical Encyclopedia (introductions).');
  });

  it('speaks with that voice, stopping what it was saying, and stops', () => {
    const synth = fakeSynth([v('Samantha', 'en-US'), v('Microsoft David', 'en-GB')]);
    const voice = new Voice({ synth, Utterance });
    assert.equal(voice.available, true);
    voice.say('I have Emma, in Gutenberg · English literature (PR).');
    assert.equal(synth.said.length, 1);
    const u = synth.said[0];
    assert.deepEqual({ text: u.text, voice: u.voice.name, lang: u.lang }, { text: 'I have Emma, in Gutenberg, English literature.', voice: 'Microsoft David', lang: 'en-GB' });
    assert.ok(u.rate > 0.8 && u.rate <= 1);
    voice.say('Again.');
    assert.equal(synth.cancels, 2, 'each answer stops the last');
    assert.equal(synth.said.length, 2);
    voice.stop();
    assert.equal(synth.cancels, 3);
    voice.stop();
    assert.equal(synth.cancels, 3, 'nothing to stop');
    voice.say('');
    assert.equal(synth.said.length, 2, 'nothing to say');
  });

  it('has a voice once the browser\'s come, and says so', () => {
    const synth = fakeSynth([]);
    const voice = new Voice({ synth, Utterance });
    let told = 0;
    voice.onChange = () => told++;
    assert.equal(voice.available, false);
    voice.say('Hello.');
    assert.equal(synth.said.length, 0);
    synth.voices = [v('Daniel', 'en-GB')];
    synth.dispatchEvent(new Event('voiceschanged'));
    assert.equal(told, 1);
    assert.equal(voice.available, true);
    voice.say('Hello.');
    assert.equal(synth.said[0].voice.name, 'Daniel');
  });

  it('is silent where the browser has no speech synthesis', () => {
    for (const o of [{ synth: null, Utterance }, { synth: fakeSynth([v('Daniel', 'en-GB')]), Utterance: undefined }]) {
      const voice = new Voice(o);
      assert.equal(voice.available, false);
      voice.say('Hello.');
      voice.stop();
    }
  });
});
