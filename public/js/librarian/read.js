// @ts-check
// The Librarian reading (docs/LIBRARIAN.md, experiment 2; SPEC §5.10): a question, a model and
// the library as its tools (tools.js). The model searches, reads and answers, turn by turn, and
// the answer keeps only what a source it was shown says (cite.js): each sentence with its sources,
// a book and a place {c, b} in it, which open the book at that paragraph.
// - It must search before it answers: an answer before any search is sent back.
// - At most MAX_ROUNDS turns; the last offers no tools and asks for the answer.
// Pure but for the model and the library it is given: the page's (librarian.js, through the
// server's /api/librarian/chat: model.js) and tools/librarian-eval.mjs's. answerOf turns a reading
// into the card's answer (card.js), its sources numbered as the sentences cite them.

import { checkAnswer, NOTHING } from './cite.js';
import { MAX_CALLS, SYSTEM } from './tools.js';

/** The most turns a question takes: searches and readings, then the answer. */
export const MAX_ROUNDS = 6;

/** What the model is told when it answers before it has searched. */
const SEARCH_FIRST = 'You have not searched the library yet. Search it first, then answer only with what the passages say.';
/** What the model is told on its last turn, which offers no tools. */
const ANSWER_NOW = 'Answer now, only with what the passages you read say, or say exactly: "I found nothing that says so."';

/**
 * A tool's call, as Ollama gives it.
 * @typedef {{ function: { name: string, arguments: any } }} ToolCall
 */

/**
 * The model's reply to one turn (server/librarian.js chat).
 * @typedef {object} Turn
 * @property {{ role: string, content: string, tool_calls?: ToolCall[] }} message
 * @property {{ load?: number, prompt?: number, reply?: number, promptTokens?: number, tokens?: number }} [timings]
 */

/**
 * One turn of a conversation: the messages so far and the tools offered; the model's reply.
 * @typedef {(messages: object[], tools: object[], o?: { signal?: AbortSignal }) => Promise<Turn>} Chat
 */

/**
 * @typedef {object} Reading what the Librarian found to say
 * @property {string} question
 * @property {boolean} nothing whether nothing he read says it (he says NOTHING)
 * @property {string} text what he says: the sentences kept, or NOTHING
 * @property {Array<{ text: string, cites: number[] }>} statements each sentence and the numbers
 *   (from 1) of its sources
 * @property {import('./tools.js').Source[]} sources what the sentences cite, in the order first cited
 * @property {Array<{ text: string, ids: string[], why: string }>} dropped the sentences struck out, and why
 * @property {string[]} madeUp ids the model cited that no tool gave it
 * @property {string} raw the model's answer as it gave it ('' when it gave none)
 * @property {Array<{ name: string, args: any }>} calls the tools it used
 * @property {number} rounds turns taken
 * @property {{ load: number, prompt: number, reply: number, tokens: number }} timings seconds (load,
 *   reading the prompt, writing) and tokens written, over all turns
 */

/** Tool calls a model wrote as text instead ({"name": …, "arguments": …}), when they name a tool. @param {string} content @param {Set<string>} names */
function callsInText(content, names) {
  const s = content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  if (!/^[[{]/.test(s)) return [];
  try {
    const v = JSON.parse(s);
    const list = Array.isArray(v) ? v : [v];
    /** @type {ToolCall[]} */
    const calls = [];
    for (const c of list) {
      const name = c?.name ?? c?.function?.name;
      if (typeof name !== 'string' || !names.has(name)) return [];
      calls.push({ function: { name, arguments: c.arguments ?? c.parameters ?? c.function?.arguments ?? {} } });
    }
    return calls;
  } catch {
    return [];
  }
}

/** A turn's arguments as an object (some models give JSON text). @param {any} v */
function argsOf(v) {
  if (v && typeof v === 'object') return v;
  try {
    const o = JSON.parse(String(v ?? '{}'));
    return o && typeof o === 'object' ? o : {};
  } catch {
    return {};
  }
}

/** A sentence as he says it: its own full stop. @param {string} s */
const sentence = (s) => (/[.!?…]["”’')\]]*$/.test(s) ? s : `${s}.`);

/**
 * The conversation a warm-up sends (server/librarian.js: one token): the instructions and the
 * tools read, so the first question finds them read.
 * @param {import('./tools.js').LibraryTools} tools
 */
export function warmTurn(tools) {
  return { messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: 'Hello.' }], tools: tools.defs };
}

/**
 * Reads for a question: the model searches and reads through the tools, turn by turn, and answers;
 * the answer is held to the citation rule.
 * @param {string} question
 * @param {object} o
 * @param {Chat} o.chat
 * @param {import('./tools.js').LibraryTools} o.tools a new one per question (it keeps what it showed)
 * @param {number} [o.rounds]
 * @param {(step: { name: string, args: any, round: number }) => void} [o.onStep] each tool as it is used
 * @param {AbortSignal} [o.signal] stops it (a newer question): rejects with an AbortError
 * @returns {Promise<Reading>}
 */
export async function readFor(question, { chat, tools, rounds = MAX_ROUNDS, onStep, signal }) {
  /** @type {object[]} */
  const messages = [{ role: 'system', content: SYSTEM }, { role: 'user', content: String(question ?? '').trim() }];
  const timings = { load: 0, prompt: 0, reply: 0, tokens: 0 };
  const names = new Set(tools.defs.map((d) => d.function.name));
  let raw = '';
  let round = 0;
  while (round < rounds) {
    signal?.throwIfAborted();
    const last = round === rounds - 1;
    if (last) messages.push({ role: 'user', content: ANSWER_NOW });
    const turn = await chat(messages, last ? [] : tools.defs, { signal });
    round++;
    const t = turn.timings ?? {};
    timings.load += t.load ?? 0;
    timings.prompt += t.prompt ?? 0;
    timings.reply += t.reply ?? 0;
    timings.tokens += t.tokens ?? 0;
    const content = String(turn.message?.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    let calls = turn.message?.tool_calls ?? [];
    if (!calls.length && !last) calls = callsInText(content, names);
    if (calls.length && !last) {
      messages.push({ role: 'assistant', content: turn.message?.tool_calls?.length ? content : '', tool_calls: calls.slice(0, MAX_CALLS) });
      for (const [i, call] of calls.entries()) {
        const name = String(call.function?.name ?? '');
        const args = argsOf(call.function?.arguments);
        if (i >= MAX_CALLS) continue; // the model is told only of those run
        signal?.throwIfAborted();
        onStep?.({ name, args, round });
        messages.push({ role: 'tool', tool_name: name, content: await tools.run(name, args) });
      }
      continue;
    }
    if (!tools.searched && !last) {
      // An answer before any search: from its own knowledge, or "nothing" without looking.
      messages.push({ role: 'assistant', content }, { role: 'user', content: SEARCH_FIRST });
      continue;
    }
    raw = content;
    break;
  }
  return finish(question, raw, tools, { calls: tools.calls, rounds: round, timings });
}

/**
 * The answer as he gives it: the sentences kept, each with the numbers of its sources (in the order
 * first cited), or NOTHING.
 * @param {string} question
 * @param {string} raw
 * @param {import('./tools.js').LibraryTools} tools
 * @param {{ calls: Reading['calls'], rounds: number, timings: Reading['timings'] }} more
 * @returns {Reading}
 */
export function finish(question, raw, tools, more) {
  const checked = checkAnswer(raw, tools.sources);
  /** @type {import('./tools.js').Source[]} */
  const sources = [];
  const statements = checked.kept.map((st) => ({
    text: sentence(st.text),
    cites: st.ids.map((id) => {
      const s = /** @type {import('./tools.js').Source} */ (tools.sources.get(id));
      let n = sources.indexOf(s);
      if (n < 0) n = sources.push(s) - 1;
      return n + 1;
    }),
  }));
  const nothing = !statements.length;
  return {
    question,
    nothing,
    text: nothing ? NOTHING : statements.map((s) => s.text).join(' '),
    statements,
    sources,
    dropped: checked.dropped,
    madeUp: checked.madeUp,
    raw,
    ...more,
  };
}

/** What he says when the model could not be asked or failed, before what the catalogue has. */
export const CANNOT_READ = 'I cannot read the books just now.';

/**
 * A source as the card shows it and takes you to it (ask.js Find): a book, an article and a place
 * in the text as experiment 1's finds; a section or a passage as a place in its book (`passage`),
 * with the book's cover where the catalogue has one.
 * @param {import('./tools.js').Source} s
 * @param {Record<string, any[]> | undefined} booksByLib the catalogue
 * @returns {import('./ask.js').Find}
 */
export function findOf(s, booksByLib) {
  if (s.kind === 'book') return { kind: 'book', book: s.entry, lib: s.lib };
  if (s.kind === 'article') return { kind: 'article', article: s.entry, lib: s.lib };
  if (s.kind === 'text') return { kind: 'text', hit: s.entry, lib: s.lib };
  const book = (booksByLib?.[s.lib.id] || []).find((b) => b.id === s.book);
  const title = s.in ?? s.title;
  return {
    kind: 'passage',
    lib: s.lib,
    bookId: s.book,
    at: s.at ?? { c: 0, b: 0 },
    title,
    section: s.title !== title ? s.title : '',
    text: s.kind === 'passage' ? s.text : '',
    // A Wikipedia's volume has its ZIM's creator for an author: no one's to name for an article.
    author: book?.volume ? '' : book?.author ?? '',
    cover: book?.cover ?? null,
  };
}

/**
 * The card's answer for a reading (ask.js Answer): his sentences, each with the numbers of its
 * sources, and the sources as finds in that order; or, when nothing he read says it, NOTHING with
 * what the catalogue has (experiment 1's answer, `plain`), when it has something.
 * @param {Reading} reading
 * @param {import('./ask.js').Answer} plain experiment 1's answer to the same question
 * @param {Record<string, any[]> | undefined} booksByLib the catalogue
 * @returns {import('./ask.js').Answer}
 */
export function answerOf(reading, plain, booksByLib) {
  if (reading.nothing) {
    return { text: plain.finds.length ? `${NOTHING} ${plain.text}` : NOTHING, finds: plain.finds, search: plain.search, reading };
  }
  return {
    text: reading.text,
    statements: reading.statements,
    finds: reading.sources.map((s) => findOf(s, booksByLib)),
    search: null,
    reading,
  };
}

/**
 * The card's answer when the model could not be asked, or failed: that, and what the catalogue has.
 * @param {import('./ask.js').Answer} plain experiment 1's answer
 * @returns {import('./ask.js').Answer}
 */
export const couldNotRead = (plain) => ({ ...plain, text: `${CANNOT_READ} ${plain.text}` });
