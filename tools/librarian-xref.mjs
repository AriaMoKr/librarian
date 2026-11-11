#!/usr/bin/env node
/**
 * The Librarian's links between libraries, counted (docs/LIBRARIAN.md, experiment 3): over folders
 * of ZIMs (the demo set), the words of each library's text that are an article's title in another
 * library, by the rule the page uses (public/js/librarian/xref.js), read as the server reads the
 * files (server/library.js, in this process). Nothing is sent anywhere.
 *
 *   node tools/librarian-xref.mjs [--dir <folder of ZIMs>]… [--sample 150] [--books 20]
 *     [--checked tools/librarian-xref-checked.json] [--label 40] [--out <file>]
 *
 * Without --dir: the demo set as the Pages workflow keeps it (.demo/render and .demo/files).
 * Prints a line per library:
 *   - what was read: a Wikipedia's articles, --sample of them evenly spread; another library's
 *     first --books books, whole;
 *   - the matches there (words that are another library's title as written) and the mentions
 *     among them (the matches that stand: written as a name, or with another article of the same
 *     library named near), and how the mentions are spread (a text's median and 9th decile, the
 *     texts with none);
 *   - what finding them costs a reader without the titles at hand: the runs of words that may be
 *     a mention (each a title to look up), per 3,000 characters, about two pages;
 * then each Wikipedia's titles as a list (what a reader would keep at hand instead), and the rule
 * held to the matches read by hand (--checked): of the mentions found again here, the share that
 * were the right article. It fails under 95 %.
 *
 * --label <n> writes n mentions not read yet, evenly spread, as entries to judge ("right": true
 * or false) and add to the list; with them, half as many of what the rule does not offer, to
 * judge too: matches that do not stand, single words, and loose matches (a title's words in
 * another case or with other marks between them, or little words only). --out keeps every match
 * found, with the words round it.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { Library } from '../server/library.js';
import {
  asWritten, contextOf, entryTokens, isName, keyOf, matchesIn, MAX_WORDS, mayBeMention, nearestOf, piecesOf, plain, stands, Titles,
  tokensOf,
} from '../public/js/librarian/xref.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/** The share of the mentions read by hand that must be the right article. */
const RIGHT = 0.95;

const { values } = parseArgs({
  options: {
    dir: { type: 'string', multiple: true },
    sample: { type: 'string', default: '150' },
    books: { type: 'string', default: '20' },
    checked: { type: 'string', default: path.join(ROOT, 'tools', 'librarian-xref-checked.json') },
    label: { type: 'string' },
    out: { type: 'string' },
  },
});
const dirs = values.dir?.length ? values.dir : [path.join(ROOT, '.demo', 'render'), path.join(ROOT, '.demo', 'files')].filter((d) => fs.existsSync(d));
if (!dirs.length) {
  console.error('usage: node tools/librarian-xref.mjs [--dir <folder of ZIMs>]… [--sample 150] [--books 20] [--checked <file>] [--label 40] [--out <file>]\n'
    + '(without --dir: the demo set in .demo/render and .demo/files, which are not here)');
  process.exit(2);
}
const SAMPLE = Math.max(1, Number(values.sample) || 150);
const BOOKS = Math.max(1, Number(values.books) || 20);
const t0 = Date.now();

/** A library's id without its edition ("wikipedia_en_physics_mini"): the list outlives a month's files. */
const undated = (id) => id.replace(/_\d{4}-\d{2}$/, '');
/** What a match is, in the list read by hand. */
const idOf = (m) => `${m.kind}|${m.lib}|${m.from}|${m.text}|${m.title}`;

// The libraries, opened as the server opens a folder (their indexes in .cache/, built on a first open).
const folders = await Promise.all(dirs.map((d) => Library.scan(d, { log: () => {}, warn: (m) => console.error(m) })));
const libs = folders.flatMap((f) => f.list());
for (let waited = 0; ; waited++) {
  const infos = await Promise.all(libs.map((l) => l.info()));
  const busy = infos.filter((i) => i.indexing);
  if (!busy.length) break;
  if (waited % 10 === 0) console.error(`waiting for ${busy.length} ${busy.length === 1 ? 'index' : 'indexes'} (${busy.map((i) => i.id).join(', ')})…`);
  await new Promise((r) => setTimeout(r, 1000));
}

// Every article's title, of every Wikipedia (its volumes' contents); those of one word too, which
// no match is ever (leftOut reads them).
const titles = new Titles({ single: true });
const articles = new Map(); // lib id -> [{ book, n, title }]
const lists = [];
for (const lib of libs) {
  if (lib.kind !== 'wikipedia') continue;
  const list = [];
  const several = [];
  for (const volume of await lib.books()) {
    const { meta } = await lib.content(volume.id);
    for (const e of meta.toc ?? []) {
      if (typeof e.title !== 'string') continue;
      list.push({ book: volume.id, n: e.c, title: e.title });
      if (titles.add(lib.id, e.title, { book: volume.id, n: e.c }) && tokensOf(e.title).words.length >= 2) several.push(e.title);
    }
  }
  articles.set(lib.id, list);
  const text = Buffer.from(several.join('\n'), 'utf8');
  lists.push({ lib: lib.id, titles: list.length, several: several.length, bytes: text.length, gzip: zlib.gzipSync(text, { level: 9 }).length });
}

/** How many runs of words in the pieces may be a mention: each a title to look up. */
function runsIn(pieces) {
  const keys = new Set();
  for (const piece of pieces) {
    const { words } = tokensOf(piece.text);
    for (let i = 0; i + 1 < words.length; i++) {
      for (let n = Math.min(MAX_WORDS, words.length - i); n >= 2; n--) {
        if (mayBeMention(words, i, n)) keys.add(keyOf(words.slice(i, i + n)));
      }
    }
  }
  return keys.size;
}

/**
 * What the rule never matches, to judge by hand: single words (a name standing alone, written as
 * a name) and loose matches (the words of a title, not as written or little words only).
 */
function leftOut(blocks, own) {
  const out = [];
  const seen = new Set();
  const add = (kind, s, t, i, n, entry) => {
    const key = `${kind} ${keyOf(t.words.slice(i, i + n))}`;
    if (seen.has(key)) return;
    seen.add(key);
    const from = t.at[i];
    const to = t.at[i + n - 1] + t.words[i + n - 1].length;
    out.push({ kind, text: s.slice(from, to), title: entry.title, to: entry.lib, context: contextOf(s, from, to) });
  };
  const capital = (w) => /^\p{Lu}/u.test(w ?? '');
  for (const piece of piecesOf(blocks)) {
    const s = plain(piece.text);
    const t = tokensOf(s);
    for (let i = 0; i < t.words.length; i++) {
      for (let n = Math.min(MAX_WORDS, t.words.length - i); n >= 2; n--) {
        const all = titles.get(keyOf(t.words.slice(i, i + n)))?.filter((e) => entryTokens(e).words.length === n);
        if (!all?.length) continue;
        if (all.some((e) => e.lib === own)) break;
        if (!(mayBeMention(t.words, i, n) && all.some((e) => asWritten(t, i, n, entryTokens(e))))) add('loose', s, t, i, n, all[0]);
        break;
      }
      const w = t.words[i];
      if (w.length >= 4 && capital(w) && w !== w.toUpperCase() && isName(t, i, 1) && !capital(t.words[i - 1]) && !capital(t.words[i + 1])) {
        const all = titles.get(w.toLowerCase())?.filter((e) => entryTokens(e).words.length === 1);
        if (all?.length && !all.some((e) => e.lib === own)) add('single', s, t, i, 1, all[0]);
      }
    }
  }
  return out;
}

/** The texts to read of a library: a Wikipedia's articles evenly spread, another's first books. */
async function textsOf(lib) {
  if (lib.kind === 'wikipedia') {
    const list = articles.get(lib.id) ?? [];
    const step = Math.max(1, Math.floor(list.length / SAMPLE));
    return list.filter((_, i) => i % step === 0).slice(0, SAMPLE).map((a) => ({ title: a.title, book: a.book, chunks: [a.n] }));
  }
  const books = (await lib.books()).filter((b) => b.readable !== false).slice(0, BOOKS);
  const out = [];
  for (const b of books) {
    const content = await lib.content(b.id).catch(() => null);
    if (content) out.push({ title: b.title, book: b.id, chunks: content.meta.chunks.map((_, n) => n) });
  }
  return out;
}

const rows = [];
const matches = []; // every match, with whether it stands as a mention
const others = []; // what the rule never matches (for --label)
for (const lib of libs) {
  const own = lib.kind === 'wikipedia' ? lib.id : null;
  const texts = await textsOf(lib);
  const per = [];
  let chars = 0;
  let runs = 0;
  let matched = 0;
  for (const text of texts) {
    const blocks = [];
    for (const n of text.chunks) blocks.push(...((await lib.chunk(text.book, n))?.blocks ?? []));
    const pieces = piecesOf(blocks);
    for (const piece of pieces) chars += piece.text.length;
    runs += runsIn(pieces);
    const found = nearestOf(matchesIn(blocks, titles, { own }));
    matched += found.length;
    per.push(found.filter(stands).length);
    for (const m of found) {
      matches.push({
        kind: 'words', lib: undated(lib.id), from: text.title, text: m.text, title: m.entries[0].title, to: undated(m.entries[0].lib),
        context: m.context, name: m.name, near: m.near,
      });
    }
    if (values.label) for (const m of leftOut(blocks, own)) others.push({ ...m, lib: undated(lib.id), from: text.title, to: undated(m.to) });
  }
  per.sort((a, b) => a - b);
  rows.push({
    lib: lib.id, kind: lib.kind, read: texts.length, chars, matches: matched, mentions: per.reduce((a, b) => a + b, 0),
    median: per[per.length >> 1] ?? 0, p90: per[Math.floor(per.length * 0.9)] ?? 0, none: per.filter((x) => x === 0).length,
    runs: chars ? Math.round((runs / chars) * 3000) : 0,
  });
}

const pad = (s, n) => String(s).padEnd(n);
const num = (s, n) => String(s).padStart(n);
const big = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));
console.log(`${pad('library', 40)} ${pad('read', 14)} ${num('chars', 6)} ${num('matches', 8)} ${num('mentions', 8)} ${num('median', 6)} ${num('p90', 4)} ${num('none', 5)} ${num('runs/3,000', 10)}`);
for (const r of rows) {
  console.log(`${pad(r.lib, 40)} ${pad(`${r.read} ${r.kind === 'wikipedia' ? 'articles' : 'books'}`, 14)} ${num(big(r.chars), 6)} ${num(r.matches, 8)} ${num(r.mentions, 8)} ${num(r.median, 6)} ${num(r.p90, 4)} ${num(r.none, 5)} ${num(r.runs, 10)}`);
}
console.log(`\n${pad('titles', 40)} ${num('articles', 8)} ${num('2 words +', 9)} ${num('bytes', 7)} ${num('gzipped', 8)}`);
for (const l of lists) console.log(`${pad(l.lib, 40)} ${num(l.titles, 8)} ${num(l.several, 9)} ${num(big(l.bytes), 7)} ${num(big(l.gzip), 8)}`);

// The rule held to the matches read by hand.
let failed = false;
const checked = fs.existsSync(values.checked) ? JSON.parse(fs.readFileSync(values.checked, 'utf8')).matches ?? [] : [];
const verdicts = new Map(checked.map((m) => [idOf(m), m.right]));
const share = (list) => {
  const right = list.filter((m) => verdicts.get(idOf(m))).length;
  return `${right} right of ${list.length}${list.length ? ` (${((right / list.length) * 100).toFixed(1)} %)` : ''}`;
};
if (checked.length) {
  const again = matches.filter((m) => verdicts.has(idOf(m)));
  const standing = again.filter(stands);
  const of = (kind) => checked.filter((m) => m.kind === kind);
  console.log(`\nread by hand: ${checked.length} (${of('words').length} matches, ${of('single').length} single words, ${of('loose').length} loose matches)`);
  console.log(`found again here, of ${matches.length} matches (${matches.filter(stands).length} of them mentions):`);
  console.log(`  mentions: ${share(standing)}`);
  console.log(`  matches that do not stand: ${share(again.filter((m) => !stands(m)))}`);
  console.log(`  never matched: single words ${share(of('single'))}, loose matches ${share(of('loose'))}`);
  const right = standing.filter((m) => verdicts.get(idOf(m))).length;
  if (standing.length >= 20 && right / standing.length < RIGHT) {
    console.log(`under ${RIGHT * 100} %: the rule offers too much that is wrong`);
    failed = true;
  }
} else console.log(`\nno matches read by hand (${path.relative(process.cwd(), values.checked)})`);

/** `n` of a list, evenly spread. */
const spread = (list, n) => (list.length <= n ? list : list.filter((_, i) => i % Math.ceil(list.length / n) === 0).slice(0, n));

function save(file, data) {
  fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(data, null, 1)}\n`);
  console.log(path.relative(process.cwd(), path.resolve(file)));
}

if (values.label) {
  const n = Math.max(1, Number(values.label) || 40);
  const half = Math.ceil(n / 2);
  const unread = (list) => list.filter((m) => !verdicts.has(idOf(m)));
  const toJudge = [
    ...spread(unread(matches.filter(stands)), n),
    ...spread(unread(matches.filter((m) => !stands(m))), half),
    ...spread(unread(others.filter((m) => m.kind === 'single')), half),
    ...spread(unread(others.filter((m) => m.kind === 'loose')), half),
  ].map((m) => ({ ...m, right: null }));
  console.log(`\n${toJudge.length} to judge:`);
  save(values.out ?? path.join(ROOT, 'perf', `librarian-xref-label-${new Date().toISOString().replace(/[:.]/g, '-')}.json`), { matches: toJudge });
} else if (values.out) {
  console.log('');
  save(values.out, { when: new Date().toISOString(), dirs, sample: SAMPLE, books: BOOKS, seconds: Math.round((Date.now() - t0) / 1000), libraries: rows, titles: lists, matches });
}

await Promise.all(folders.map((f) => f.close()));
process.exit(failed ? 1 : 0);
