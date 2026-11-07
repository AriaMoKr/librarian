#!/usr/bin/env node
/**
 * The Librarian's evaluation (docs/LIBRARIAN.md, experiment 2): questions over a folder of ZIMs
 * (tools/librarian-questions.json, over the demo set), each read by every model asked for, the
 * way the page reads them: the same reading (public/js/librarian/read.js), tools (tools.js) and
 * citation rule (cite.js), over the server's own API (run here, in this process), and each model
 * through server/librarian.js, as the server forwards it to Ollama. Each model is warmed up first
 * (timed: its load) and unloaded after. Nothing is sent anywhere but to Ollama.
 *
 *   node tools/librarian-eval.mjs --dir <folder of ZIMs> --models gemma4:12b,qwen3:14b
 *     [--questions tools/librarian-questions.json] [--only 1,4,7] [--rounds 6]
 *     [--ollama-url http://127.0.0.1:11434] [--out perf/librarian-eval-<time>.json]
 *   node tools/librarian-eval.mjs --rescore <an evaluation's .json> [--out <file>]
 *
 * Prints each answer as it comes, then a line per model: questions right (an answer that says what
 * it should and cites a right source; "nothing" where the library holds no answer), sentences
 * struck out by the citation rule (and why), ids made up, and the time an answer took. The file
 * keeps each answer as the model gave it and everything the tools showed it, so --rescore holds
 * the same answers to the citation rule as it is now, without a model (the rule's calibration).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { LibrarianModel, OLLAMA_URL } from '../server/librarian.js';
import { main } from '../server/index.js';
import { bookIndex } from '../public/js/search.js';
import { finish, MAX_ROUNDS, readFor, warmTurn } from '../public/js/librarian/read.js';
import { LibraryTools } from '../public/js/librarian/tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: path.join(ROOT, '.demo', 'render') },
    models: { type: 'string' },
    questions: { type: 'string', default: path.join(ROOT, 'tools', 'librarian-questions.json') },
    only: { type: 'string' },
    rounds: { type: 'string' },
    'ollama-url': { type: 'string', default: OLLAMA_URL },
    out: { type: 'string' },
    rescore: { type: 'string' },
  },
});
if (!values.models && !values.rescore) {
  console.error('usage: node tools/librarian-eval.mjs --dir <folder of ZIMs> --models <model>[,<model>…] [--questions <file>] [--only 1,4] [--rounds 6] [--ollama-url <url>] [--out <file>]\n'
    + '       node tools/librarian-eval.mjs --rescore <an evaluation\'s .json> [--questions <file>] [--out <file>]');
  process.exit(2);
}
const all = JSON.parse(fs.readFileSync(values.questions, 'utf8')).questions;
const only = values.only ? new Set(values.only.split(',').map(Number)) : null;
const questions = all.map((q, i) => ({ ...q, n: i + 1 })).filter((q) => !only || only.has(q.n));

/** Whether a source is one a question's `cites` names. */
function citesOne(source, spec) {
  if (!source.lib.id.startsWith(spec.lib)) return false;
  if (spec.article) return (source.kind === 'article' ? source.title : source.in) === spec.article;
  if (spec.book && source.book !== spec.book) return false;
  if (spec.c === undefined) return true;
  return source.at?.c === spec.c && (spec.b === undefined || Math.abs(source.at.b - spec.b) <= 2);
}

/** Whether an answer is right: nothing where nothing is, else what it should say and a right source. */
function score(q, reading) {
  if (q.nothing) return reading.nothing;
  if (reading.nothing) return false;
  const says = (q.says ?? []).every((p) => new RegExp(p, 'i').test(reading.text));
  const cites = !q.cites?.length || reading.sources.some((s) => q.cites.some((spec) => citesOne(s, spec)));
  return says && cites;
}

/** A source as the file keeps it (its library by id). */
const sourceRow = (s) => ({
  id: s.id, kind: s.kind, lib: s.lib.id, book: s.book, at: s.at, title: s.title, in: s.in, text: s.text, context: s.context,
  ...(s.end !== undefined ? { end: s.end } : {}),
});

/** A reading as the file keeps it. */
const readingRow = (q, reading, right) => ({
  text: reading.text, right, raw: reading.raw, dropped: reading.dropped, madeUp: reading.madeUp,
  sources: reading.sources.map(sourceRow).map(({ text, context, ...s }) => s),
});

const short = (s, n = 150) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const line = (q, right, reading, extra = '') => `  ${q.n}. ${right ? '✓' : '✗'} ${q.q}${extra} — ${short(reading.text)}${reading.dropped.length ? ` [struck: ${reading.dropped.map((d) => d.why).join('; ')}]` : ''}`;

/** A line per model: right, nothing right, struck, made up, the times. */
function report(results) {
  console.log('\nmodel           right  nothing  struck  made-up  median s  total s  warm s');
  for (const r of results) {
    const qs = r.questions.filter((x) => !x.error);
    const secs = qs.map((x) => x.seconds).sort((a, b) => a - b);
    const median = secs.length ? secs[Math.floor(secs.length / 2)] : 0;
    const nothing = qs.filter((x) => x.nothingExpected);
    console.log([
      r.model.padEnd(14),
      `${qs.filter((x) => x.right).length}/${r.questions.length}`.padStart(6),
      `${nothing.filter((x) => x.right).length}/${nothing.length}`.padStart(8),
      String(qs.reduce((n, x) => n + x.dropped.length, 0)).padStart(7),
      String(qs.reduce((n, x) => n + x.madeUp.length, 0)).padStart(8),
      String(median).padStart(9),
      String(Math.round(secs.reduce((a, b) => a + b, 0))).padStart(8),
      String(r.warm ?? '–').padStart(7),
      r.error ? `  ${r.error}` : '',
    ].join(' '));
  }
}

/** Writes the results, and says where. */
function save(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 1));
  console.log(`\n${path.relative(process.cwd(), file)}`);
}

if (values.rescore) {
  // The same answers, held to the citation rule as it is now.
  const data = JSON.parse(fs.readFileSync(values.rescore, 'utf8'));
  const byText = new Map(all.map((q, i) => [q.q, { ...q, n: i + 1 }]));
  for (const r of data.results) {
    console.log(`\n${r.model}`);
    let unsaved = 0;
    for (const row of r.questions) {
      const q = byText.get(row.q);
      if (row.error || !q) continue;
      if (!row.shown) {
        unsaved++;
        continue;
      }
      const sources = new Map(row.shown.map((s) => [s.id, { ...s, lib: { id: s.lib } }]));
      const reading = finish(row.q, row.raw, /** @type {any} */ ({ sources }), { calls: [], rounds: row.rounds, timings: { load: 0, prompt: 0, reply: 0, tokens: 0 } });
      const right = score(q, reading);
      const was = row.right;
      Object.assign(row, readingRow(q, reading, right));
      if (right !== was) console.log(line(q, right, reading, ` (was ${was ? '✓' : '✗'})`));
    }
    if (unsaved) console.log(`  ${unsaved} answers kept no sources, so they stand as they were scored: run them again`);
  }
  report(data.results);
  if (values.out) save(values.out, data);
  process.exit(0);
}

const models = values.models.split(',').map((m) => m.trim()).filter(Boolean);
const rounds = Number(values.rounds) || MAX_ROUNDS;

// The library, served here as the page would be served (no folder watching, no address but this machine's).
const server = await main(['--dir', values.dir, '--port', '0', '--host', '127.0.0.1', '--no-watch', '--quiet'], {
  out: () => {}, err: (m) => console.error(m), handleSignals: false,
});
const base = `http://127.0.0.1:${server.port}/`;
const enc = encodeURIComponent;
const getJSON = async (p) => {
  const res = await fetch(new URL(p, base));
  if (!res.ok) throw new Error(`${res.status} ${p}`);
  return res.json();
};

// The Wikipedias' indexes are built on a folder's first open: wait for them.
let libraries;
for (let waited = 0; ; waited++) {
  ({ libraries } = await getJSON('api/libraries'));
  const busy = libraries.filter((l) => l.indexing);
  if (!busy.length) break;
  if (waited % 10 === 0) console.log(`waiting for ${busy.length} ${busy.length === 1 ? 'index' : 'indexes'} (${busy.map((l) => l.id).join(', ')})…`);
  await new Promise((r) => setTimeout(r, 1000));
}
const booksByLib = Object.fromEntries(await Promise.all(libraries.map(async (l) => [l.id, (await getJSON(`api/libraries/${enc(l.id)}/books`)).books])));

/** The library as the page's tools read it (librarian.js gives search.js and api.js), here over HTTP. */
const metas = new Map();
const chunks = new Map();
const access = {
  libraries: () => libraries,
  index: () => bookIndex(libraries, booksByLib),
  async articles(q, perLibrary) {
    if (q.trim().length < 2) return [];
    const wikis = libraries.filter((l) => l.kind === 'wikipedia');
    const found = await Promise.all(wikis.map((lib) => getJSON(`api/libraries/${enc(lib.id)}/articles?q=${enc(q)}&limit=${perLibrary}`)
      .then((r) => r.articles.map((article) => ({ article, lib })), () => [])));
    return found.flat();
  },
  async texts(q, perLibrary) {
    const searchable = libraries.filter((l) => l.fulltext);
    const found = await Promise.all(searchable.map((lib) => getJSON(`api/libraries/${enc(lib.id)}/text?q=${enc(q)}&limit=${perLibrary}`)
      .then((r) => r.results.map((hit) => ({ hit, lib })), () => [])));
    return found.flat();
  },
  meta(lib, book) {
    const key = `${lib}\n${book}`;
    if (!metas.has(key)) metas.set(key, getJSON(`api/libraries/${enc(lib)}/books/${enc(book)}`));
    return metas.get(key);
  },
  chunk(lib, book, n) {
    const key = `${lib}\n${book}\n${n}`;
    if (!chunks.has(key)) chunks.set(key, getJSON(`api/libraries/${enc(lib)}/books/${enc(book)}/chunks/${n}`).then((r) => r.blocks));
    return chunks.get(key);
  },
  async place(lib, hit) {
    const { to, path: p, find } = hit;
    const q = `path=${enc(p ?? '')}&c=${to.c ?? 0}&t=${enc((find.terms ?? []).join(' '))}&w=${enc(find.words.join(' '))}&h=${enc(find.hits.join(' '))}`;
    const { at = null } = await getJSON(`api/libraries/${enc(lib)}/books/${enc(to.book)}/find?${q}`);
    return { at };
  },
};

const results = [];
for (const name of models) {
  const model = new LibrarianModel({ model: name, url: values['ollama-url'] });
  const probe = await model.probe();
  const row = { model: name, warm: null, questions: [], error: probe.ok ? null : probe.error };
  results.push(row);
  if (!probe.ok) {
    console.log(`${name}: ${probe.error}`);
    continue;
  }
  try {
    let t = performance.now();
    await model.chat({ ...warmTurn(new LibraryTools(access)), warm: true });
    row.warm = +((performance.now() - t) / 1000).toFixed(1);
    console.log(`\n${name}: warmed up in ${row.warm} s`);
    for (const q of questions) {
      const tools = new LibraryTools(access);
      t = performance.now();
      const chat = (messages, defs) => model.chat({ messages, tools: defs });
      let reading;
      try {
        reading = await readFor(q.q, { chat, tools, rounds });
      } catch (err) {
        row.questions.push({ n: q.n, q: q.q, error: String(err.message ?? err) });
        console.log(`  ${q.n}. ✗ ${q.q} — ${err.message ?? err}`);
        continue;
      }
      const seconds = +((performance.now() - t) / 1000).toFixed(1);
      const right = score(q, reading);
      row.questions.push({
        n: q.n, q: q.q, nothingExpected: !!q.nothing, seconds, rounds: reading.rounds,
        calls: reading.calls.map((c) => `${c.name}(${Object.values(c.args ?? {}).map((v) => JSON.stringify(v)).join(', ')})`),
        ...readingRow(q, reading, right),
        tokens: reading.timings.tokens,
        shown: [...tools.sources.values()].map(sourceRow),
      });
      console.log(line(q, right, reading, ` (${seconds} s, ${reading.calls.length} calls)`));
    }
  } catch (err) {
    row.error = String(err.message ?? err);
    console.log(`${name}: ${row.error}`);
  } finally {
    // Unloaded, so the next model has the memory.
    await fetch(new URL('api/generate', model.url), { method: 'POST', body: JSON.stringify({ model: name, keep_alive: 0 }) }).catch(() => {});
  }
}
await server.close();

report(results);
save(values.out ?? path.join(ROOT, 'perf', `librarian-eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
  { dir: path.basename(values.dir), rounds, results });
