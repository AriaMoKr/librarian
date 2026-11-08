// @ts-check
// The library as the Librarian's model reads it (docs/LIBRARIAN.md, experiment 2; SPEC §5.10):
// its tools (search the books, the articles and the full text; read a book, an article or a place
// in one, a page at a time; find words in a book), and everything they showed the model, by the
// ids it was shown with (B3, A1, T2, S4, P17), so the answer can be held to it (cite.js).
//
// Pure but for the library's access, which the page gives it (search.js, api.js: librarian.js) and
// tools/librarian-eval.mjs gives it over the server's HTTP API, so the two read alike.

import { fold } from '../search.js';
import { booksFor } from './ask.js';

/** The most results a search shows the model. */
const MAX_RESULTS = 8;
/** A page of reading: passages until this many characters (at least one). */
const PAGE_CHARS = 3000;
/** A passage longer than this is cut, as the model sees it (cite.js holds the answer to the whole). */
const PASSAGE_CHARS = 800;
/** The most contents entries a book's first page lists. */
const MAX_CONTENTS = 30;
/** find: the most passages shown, and how many of a book's parts (chunks) it looks through. */
const MAX_FOUND = 6;
const MAX_FIND_CHUNKS = 60;
/** The most calls of one turn that are run (the rest are answered as not run). */
export const MAX_CALLS = 4;

/**
 * @typedef {object} Access the library, as the tools read it
 * @property {() => any[]} libraries the catalogue's libraries ({ id, title, kind, fulltext? })
 * @property {() => Array<{ book: any, lib: any, hay: string, title: string }>} index the books'
 *   search index (search.js bookIndex)
 * @property {(q: string, perLibrary: number) => Promise<Array<{ article: any, lib: any }>>} articles
 *   Wikipedia articles whose titles begin with q (search.js findArticles)
 * @property {(q: string, perLibrary: number) => Promise<Array<{ hit: any, lib: any }>>} texts
 *   places in the full text (search.js findInText; only through the server's kiwix-serve)
 * @property {(libId: string, bookId: string) => Promise<any>} meta a book's reading metadata
 *   (api.getBookMeta: chunks, toc)
 * @property {(libId: string, bookId: string, n: number) => Promise<any[]>} chunk a part's blocks
 *   (api.getChunk)
 * @property {(libId: string, hit: any) => Promise<{ at: { c: number, b: number } | null }>} place
 *   where a full-text hit is in its book (api.findText)
 */

/**
 * @typedef {'book' | 'article' | 'text' | 'section' | 'passage'} SourceKind
 */

/**
 * @typedef {object} Source something the model was shown, by its id
 * @property {string} id 'B3', 'A1', 'T2', 'S4', 'P17'
 * @property {SourceKind} kind
 * @property {any} lib its library
 * @property {string} book its book's id (an article's volume)
 * @property {{ c: number, b: number } | null} at where it is in the book (null: the book's start)
 * @property {string} title the book's title, the article's, the section's
 * @property {string} [author] the book's author
 * @property {string} text what it says: a passage's whole text; a result's title, author and
 *   library; a hit's snippet
 * @property {string} context what stands round it: its book's or article's title and author, then
 *   on a line of its own its section (names and numbers may come from there: "In Language, Sapir
 *   writes …")
 * @property {number} [end] an article's part (chunk) when reading must not go past it
 * @property {string} [in] the title of the book or article a section or passage is in
 * @property {any} [entry] the book (a book), the article (an article), the hit (a text)
 */

/** The model's instructions: the Librarian, who only finds things. English to start (LIBRARIAN.md). */
export const SYSTEM = `You are the Librarian of a library of books and encyclopedia articles. You can only find things: you never guess, never speculate, never draw conclusions and never use your own knowledge.

To answer a question:
1. Search the library: search_books for a title or an author, search_articles for a subject (an article's title is its subject's name: "Insulin", "William Shakespeare").
2. Read what you found with read (a page at a time), or look for words in it with find.
3. Answer in English, in one to three short sentences, only with what the passages you read say. End each sentence with the ids of the passages or results it comes from, in square brackets, like [P4] or [B2][P7]. When you quote, quote exactly, in quotation marks.

If what you read does not say it, answer exactly: "I found nothing that says so."`;

/** Text of runs (SPEC §3.5): image runs left out, a hard break a space. @param {any[] | undefined} runs */
const runsText = (runs) => (runs ?? []).map((r) => (r[2]?.src ? '' : String(r[0]))).join('');

/** References and notes the encyclopedia marks in its text ("[1]", "[a]", "[note 3]", "[citation needed]"). */
const REFS = /\[(?:\d{1,3}|[a-z]|[a-z]{1,4} \d{1,3}|citation needed)\]/gi;

/** A text as one line: references gone, breaks and spaces one space. @param {string} s */
const clean = (s) => s.replace(REFS, '').replace(/\s+/g, ' ').trim();

/**
 * What a block says, as one line ('' for none): a list item marked, a table's row as "head:
 * cells", a heading as it is.
 * @param {any} b a block (SPEC §3.5)
 * @returns {string}
 */
export function blockText(b) {
  switch (b?.t) {
    case 'p':
    case 'h':
      return clean(runsText(b.r));
    case 'li': {
      const s = clean(runsText(b.r));
      return s ? `• ${s}` : '';
    }
    case 'tr': {
      const cells = (b.c ?? []).map((/** @type {any[]} */ c) => clean(runsText(c).replace(/\n/g, ', '))).filter(Boolean);
      return cells.length > 1 ? `${cells[0]}: ${cells.slice(1).join('; ')}` : cells[0] ?? '';
    }
    case 'pre':
      return clean(String(b.x ?? ''));
    default:
      return '';
  }
}

/** A line cut to `max` characters at a word, with "…". @param {string} s @param {number} max */
function cut(s, max) {
  if (s.length <= max) return s;
  const at = s.lastIndexOf(' ', max);
  return `${s.slice(0, at > max * 0.6 ? at : max)}…`;
}

/** An id as the model may write it ("b1", "[B1]", "B 1"), as the tools give it ("B1"). @param {unknown} v */
export const idOf = (v) => String(v ?? '').toUpperCase().replace(/[\s[\]()"'`]/g, '');

/** A tool's argument as text. @param {any} args @param {string} name */
const arg = (args, name) => String(args?.[name] ?? '').replace(/\s+/g, ' ').trim();

/** What he is doing until the model's first call: reading on, under the library's own answer (card.js). */
export const FIRST_STEP = 'Reading for an answer…';

/**
 * What he is doing, as the card shows it while he reads (read.js onStep): the search's words, or
 * the title of what he reads (by its id, as the model gave it).
 * @param {{ name: string, args: any }} step
 * @param {Map<string, Source>} sources what was shown so far (LibraryTools.sources)
 * @returns {string}
 */
export function stepText({ name, args }, sources) {
  const q = arg(args, 'query') || arg(args, 'words');
  const quoted = q ? `“${q}”` : '';
  /** @param {unknown} id */
  const what = (id) => {
    const s = sources.get(idOf(id));
    if (!s) return 'what he found';
    return s.in && s.in !== s.title ? `${s.in}: ${s.title}` : s.title;
  };
  switch (name) {
    case 'search_books': {
      const by = arg(args, 'author');
      return `Looking in the catalogue for ${quoted ? `${quoted}${by ? ` by ${by}` : ''}` : by ? `books by ${by}` : 'books'}…`;
    }
    case 'search_articles':
      return `Looking for an article on ${quoted || 'it'}…`;
    case 'search_text':
      return `Looking through the books’ text for ${quoted || 'it'}…`;
    case 'read': {
      const page = Number(args?.page) || 1;
      return `Reading ${what(args?.id)}${page > 1 ? `, page ${page}` : ''}…`;
    }
    case 'find':
      return `Looking for ${quoted || 'words'} in ${what(args?.id)}…`;
    default:
      return 'Looking…';
  }
}

/** The tools, for Ollama's /api/chat (`tools`). */
const DEFS = {
  search_books: {
    description: 'Find books in the library by words of their title or their author\'s name. Returns books, each with an id like [B1].',
    properties: {
      query: { type: 'string', description: 'words of the title, or the author\'s name' },
      author: { type: 'string', description: 'only books by this author (optional)' },
    },
    required: ['query'],
  },
  search_articles: {
    description: 'Find encyclopedia articles whose title begins with these words. An article\'s title is the name of its subject: a person, a place, a thing ("Insulin", "Nelson Mandela"). Returns articles, each with an id like [A1].',
    properties: { query: { type: 'string', description: 'the subject\'s name' } },
    required: ['query'],
  },
  search_text: {
    description: 'Find places in the books\' full text that hold these words. Returns places, each with an id like [T1].',
    properties: { query: { type: 'string', description: 'words that are in the text' } },
    required: ['query'],
  },
  read: {
    description: 'Read a book, an article, a place found by search_text or a section, a page at a time. Returns passages, each with an id like [P12] to cite; a book\'s first page lists its contents, sections with ids like [S3].',
    properties: {
      id: { type: 'string', description: 'an id a search or a contents list gave you: B1, A2, T1, S3' },
      page: { type: 'integer', description: 'which page, from 1 (optional)' },
    },
    required: ['id'],
  },
  find: {
    description: 'Find the passages of a book or an article that hold all of these words. Returns passages, each with an id like [P12].',
    properties: {
      id: { type: 'string', description: 'the book\'s or article\'s id: B1, A2' },
      words: { type: 'string', description: 'words to look for' },
    },
    required: ['id', 'words'],
  },
};

/**
 * Where reading a source starts, and where it must stop: an article's part (one chunk).
 * @typedef {{ lib: any, book: string, c: number, b: number, end: number | null, title: string, context: string }} Place
 */

export class LibraryTools {
  /** @param {Access} access */
  constructor(access) {
    this.access = access;
    /** Everything shown to the model, by id. @type {Map<string, Source>} */
    this.sources = new Map();
    /** Whether the model has searched (an answer before any search is sent back: read.js). */
    this.searched = false;
    /** The calls run, in order: { name, args }. @type {Array<{ name: string, args: any }>} */
    this.calls = [];
    /** Ids by what they name, so the same thing keeps its id. @type {Map<string, string>} */
    this._ids = new Map();
    /** @type {Record<string, number>} the last id given of each letter */
    this._counts = { B: 0, A: 0, T: 0, S: 0, P: 0 };
  }

  /** Whether any library's full text can be searched (the server's kiwix-serve). */
  get fullText() {
    return this.access.libraries().some((l) => l.fulltext);
  }

  /** The tools to offer the model (search_text only where the full text can be searched). */
  get defs() {
    return Object.entries(DEFS).filter(([name]) => name !== 'search_text' || this.fullText).map(([name, d]) => ({
      type: 'function',
      function: { name, description: d.description, parameters: { type: 'object', properties: d.properties, required: d.required } },
    }));
  }

  /**
   * A thing's id, the same each time it is shown, and it registered as shown.
   * @param {string} key what it is
   * @param {'B' | 'A' | 'T' | 'S' | 'P'} letter
   * @param {Omit<Source, 'id'>} source
   */
  _id(key, letter, source) {
    let id = this._ids.get(key);
    if (!id) {
      id = `${letter}${++this._counts[letter]}`;
      this._ids.set(key, id);
    }
    if (!this.sources.has(id)) this.sources.set(id, { id, ...source });
    return id;
  }

  /**
   * Runs one of the model's calls: what to tell it, never a throw (a failure is said).
   * @param {string} name
   * @param {any} args
   * @returns {Promise<string>}
   */
  async run(name, args) {
    this.calls.push({ name, args });
    try {
      if (name === 'search_books') return this._searchBooks(args);
      if (name === 'search_articles') return await this._searchArticles(args);
      if (name === 'search_text' && this.fullText) return await this._searchText(args);
      if (name === 'read') return await this._read(args);
      if (name === 'find') return await this._find(args);
      return `There is no tool ${JSON.stringify(name)}. The tools are: ${this.defs.map((d) => d.function.name).join(', ')}.`;
    } catch (err) {
      console.warn('[librarian] tool', name, err);
      return `That could not be done just now (${String(/** @type {any} */ (err)?.message ?? err).slice(0, 120)}).`;
    }
  }

  /** @param {any} args */
  _searchBooks(args) {
    const q = arg(args, 'query');
    const by = arg(args, 'author');
    if (!q && !by) return 'Say what to look for: words of a title, or an author\'s name.';
    this.searched = true;
    // A Wikipedia's volumes ("Aa – Ab") are no one's books.
    const books = booksFor(this.access.index(), { q, by, wants: 'book' }).filter((e) => e.lib.kind !== 'wikipedia');
    if (!books.length) return `No book's title or author has the words “${q || by}”${by && q ? ` by ${by}` : ''}.`;
    const lines = books.slice(0, MAX_RESULTS).map(({ book, lib }) => {
      const title = `${book.title}${book.subtitle ? `: ${book.subtitle}` : ''}`;
      const text = `${title}${book.author ? `, by ${book.author}` : ''} (${lib.title})`;
      const id = this._id(`b ${lib.id} ${book.id}`, 'B', {
        kind: 'book', lib, book: book.id, at: null, title: book.title, author: book.author, text, context: text, entry: book,
      });
      return `[${id}] ${text}`;
    });
    const more = books.length - lines.length;
    return `${books.length === 1 ? 'One book' : `${books.length} books`}:\n${lines.join('\n')}${more > 0 ? `\n…and ${more} more.` : ''}`;
  }

  /** @param {any} args */
  async _searchArticles(args) {
    const q = arg(args, 'query');
    if (!q) return 'Say what to look for: a subject\'s name.';
    this.searched = true;
    const bare = q.replace(/^(?:the|an?)\s+/i, '');
    const lists = await Promise.all([...new Set([q, bare])].map((f) => this.access.articles(f, MAX_RESULTS)));
    /** @type {Array<{ article: any, lib: any }>} */
    const found = [];
    const seen = new Set();
    for (const e of lists.flat()) {
      const key = `${e.lib.id} ${e.article.book} ${e.article.n}`;
      if (seen.has(key)) continue;
      seen.add(key);
      found.push(e);
    }
    // The subject named as asked first, then names beginning with it as a whole word (stable: each
    // library's own order among equals).
    const asked = [fold(q), fold(bare)];
    /** @param {{ title: string, from?: string }} a */
    const rank = (a) => {
      let best = 2;
      for (const name of [a.from, a.title]) {
        if (!name) continue;
        const t = fold(name);
        for (const s of asked) {
          if (t === s) return 0;
          if (t.startsWith(s) && !/[\p{L}\p{N}]/u.test(t.charAt(s.length))) best = 1;
        }
      }
      return best;
    };
    const ranked = found.map((e, i) => ({ e, r: rank(e.article), i })).sort((x, y) => x.r - y.r || x.i - y.i).map((x) => x.e);
    if (!ranked.length) return `No article's title begins with “${q}”. An article's title is the name of its subject: try the name alone, or fewer words.`;
    const lines = ranked.slice(0, MAX_RESULTS).map(({ article, lib }) => {
      const text = `${article.title} (${lib.title})`;
      const id = this._id(`a ${lib.id} ${article.book} ${article.n}`, 'A', {
        kind: 'article', lib, book: article.book, at: { c: article.n, b: 0 }, title: article.title, text, context: text, end: article.n, entry: article,
      });
      return `[${id}] ${text}${article.from ? ` (found as “${article.from}”)` : ''}`;
    });
    const more = ranked.length - lines.length;
    return `${ranked.length === 1 ? 'One article' : `${ranked.length} articles`}:\n${lines.join('\n')}${more > 0 ? `\n…and ${more} more.` : ''}`;
  }

  /** @param {any} args */
  async _searchText(args) {
    const q = arg(args, 'query');
    if (!q) return 'Say what to look for: words that are in the text.';
    this.searched = true;
    const hits = await this.access.texts(q, 4);
    if (!hits.length) return `No place in the full text has “${q}”.`;
    const lines = hits.slice(0, MAX_RESULTS).map(({ hit, lib }) => {
      const snippet = clean((hit.snippet ?? []).map((/** @type {[string, unknown]} */ p) => p[0]).join(''));
      const where = `${hit.title}${hit.author ? `, by ${hit.author}` : ''} (${lib.title})`;
      const id = this._id(`t ${lib.id} ${hit.path ?? `${hit.to?.book} ${hit.to?.c}`}`, 'T', {
        kind: 'text', lib, book: hit.to.book, at: { c: hit.to.c ?? 0, b: hit.to.b ?? 0 }, title: hit.title, author: hit.author,
        text: snippet, context: where, entry: hit,
        // A Wikipedia's article is its own part: reading it stops at its end.
        ...(lib.kind === 'wikipedia' ? { end: hit.to.c ?? 0 } : {}),
      });
      return `[${id}] ${where}: “${snippet}”`;
    });
    return lines.join('\n');
  }

  /**
   * Where reading a source starts: a book at its start, an article at its own, a hit where the
   * server finds its words (a little before), a section or a passage where it is.
   * @param {Source} s
   * @returns {Promise<Place>}
   */
  async _placeOf(s) {
    const whole = this._whole(s);
    if (s.kind === 'book' || s.kind === 'article') return whole;
    if (s.kind === 'text') {
      const { at } = await this.access.place(s.lib.id, s.entry).catch(() => ({ at: null }));
      const c = at?.c ?? s.at?.c ?? 0;
      return { ...whole, c, b: Math.max(0, (at?.b ?? s.at?.b ?? 0) - 1) };
    }
    return { ...whole, c: s.at?.c ?? 0, b: s.at?.b ?? 0, context: s.context };
  }

  /**
   * The whole book or article a source is in, from its start: an article (or what is in one) its
   * own part only.
   * @param {Source} s
   * @returns {Place}
   */
  _whole(s) {
    const title = s.kind === 'section' || s.kind === 'passage' ? s.in ?? s.title : s.title;
    // Its book's or article's line (a hit's is where it is, not its snippet).
    const context = s.context.split('\n')[0];
    if (s.end !== undefined) return { lib: s.lib, book: s.book, c: s.end, b: 0, end: s.end, title, context };
    return { lib: s.lib, book: s.book, c: 0, b: 0, end: null, title, context };
  }

  /**
   * The passages from a place on, a part (chunk) at a time, as [c, b, block] (empty blocks and
   * pictures left out); within an article's own part only.
   * @param {Place} place
   * @param {number} [maxChunks]
   */
  async *_blocks(place, maxChunks = Infinity) {
    const meta = await this.access.meta(place.lib.id, place.book);
    const last = place.end ?? (meta?.chunks?.length ?? 1) - 1;
    for (let c = place.c, n = 0; c <= last && n < maxChunks; c++, n++) {
      const blocks = await this.access.chunk(place.lib.id, place.book, c);
      for (let b = c === place.c ? place.b : 0; b < blocks.length; b++) yield /** @type {[number, number, any]} */ ([c, b, blocks[b]]);
    }
  }

  /**
   * A passage's id: the block it is, shown to the model.
   * @param {Place} place @param {number} c @param {number} b @param {string} text @param {string} section
   */
  _passage(place, c, b, text, section) {
    const context = [place.context, section].filter(Boolean).join('\n');
    return this._id(`p ${place.lib.id} ${place.book} ${c} ${b}`, 'P', {
      kind: 'passage', lib: place.lib, book: place.book, at: { c, b }, title: section || place.title, in: place.title, text, context,
      ...(place.end !== null ? { end: place.end } : {}),
    });
  }

  /** @param {any} args */
  async _read(args) {
    const id = idOf(args?.id);
    const s = this.sources.get(id);
    if (!s) return `There is no ${id || 'id'} here: read takes an id that a search or a contents list gave you (B…, A…, T…, S…).`;
    const page = Math.max(1, Math.min(500, Math.floor(Number(args?.page) || 1)));
    const place = await this._placeOf(s);
    const head = [];
    if (page === 1 && s.kind === 'book') {
      head.push(s.text);
      const contents = await this._contents(place);
      if (contents) head.push(`Contents (read a section by its id): ${contents}`);
    } else if (page === 1 && s.kind === 'article') {
      head.push(s.text);
    }
    // Pages are counted from the place, PAGE_CHARS of passages each.
    const lines = [];
    let shown = 0;
    let p = 1;
    let more = false;
    let section = s.kind === 'section' ? s.title : s.kind === 'passage' ? s.title : '';
    /** @type {string[]} */
    const sections = [];
    for await (const [c, b, block] of this._blocks(place)) {
      const text = blockText(block);
      if (!text) continue;
      if (block.t === 'h') {
        section = text;
        if (p === page && shown < PAGE_CHARS) lines.push(`— ${text} —`);
        if (page === 1 && s.kind === 'article' && block.l >= 2 && block.l <= 3 && sections.length < MAX_CONTENTS) {
          sections.push(`[${this._section(place, c, b, text)}] ${text}`);
        }
        continue;
      }
      if (shown >= PAGE_CHARS) {
        if (p === page) {
          more = true;
          if (s.kind !== 'article' || page !== 1) break;
          continue; // an article's first page lists its sections: read on for its headings, quietly
        }
        p++;
        shown = 0;
      }
      shown += Math.min(text.length, PASSAGE_CHARS);
      if (p !== page) continue;
      lines.push(`[${this._passage(place, c, b, text, section)}] ${cut(text, PASSAGE_CHARS)}`);
    }
    if (sections.length) head.push(`Sections (read one by its id): ${sections.join('; ')}`);
    if (!lines.length) return `${head.length ? `${head.join('\n')}\n` : ''}${page > 1 ? `There is no page ${page}.` : 'It has no text to read.'}`;
    const foot = more ? `More: read {"id":"${id}","page":${page + 1}}` : '(The end.)';
    return `${head.join('\n')}${head.length ? '\n' : ''}Page ${page}:\n${lines.join('\n')}\n${foot}`;
  }

  /**
   * A section's id (an article's heading, a book's contents entry).
   * @param {Place} place @param {number} c @param {number} b @param {string} title
   */
  _section(place, c, b, title) {
    return this._id(`s ${place.lib.id} ${place.book} ${c} ${b}`, 'S', {
      kind: 'section', lib: place.lib, book: place.book, at: { c, b }, title, in: place.title, text: title,
      context: [place.context, title].join('\n'),
      ...(place.end !== null ? { end: place.end } : {}),
    });
  }

  /**
   * A book's contents (its meta's toc, levels 1 and 2; a heading and the one right after it at the
   * same place, as "I" and "Introductory: Language Defined", as one), as "[S1] title; …".
   * @param {Place} place
   */
  async _contents(place) {
    const meta = await this.access.meta(place.lib.id, place.book);
    /** @type {Array<{ title: string, level: number, c: number, b: number }>} */
    const toc = (meta?.toc ?? []).filter((/** @type {any} */ t) => t.level <= 2 && t.title);
    /** @type {Array<{ title: string, c: number, b: number }>} */
    const merged = [];
    for (const t of toc) {
      const prev = merged[merged.length - 1];
      if (prev && prev.c === t.c && t.b === prev.b + 1 && prev.title.length <= 6) prev.title = `${prev.title}. ${t.title}`;
      else merged.push({ title: t.title, c: t.c, b: t.b });
    }
    if (!merged.length) return '';
    const shown = merged.slice(0, MAX_CONTENTS).map((t) => `[${this._section(place, t.c, t.b, t.title)}] ${t.title}`);
    return `${shown.join('; ')}${merged.length > shown.length ? `; …and ${merged.length - shown.length} more` : ''}`;
  }

  /** @param {any} args */
  async _find(args) {
    const id = idOf(args?.id);
    const s = this.sources.get(id);
    if (!s) return `There is no ${id || 'id'} here: find takes a book's or an article's id that a search gave you (B…, A…).`;
    const words = arg(args, 'words');
    const terms = fold(words).split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1);
    if (!terms.length) return 'Say which words to look for.';
    // The whole book (or article) a source is in.
    const whole = this._whole(s);
    const lines = [];
    let count = 0;
    let section = '';
    for await (const [c, b, block] of this._blocks(whole, MAX_FIND_CHUNKS)) {
      const text = blockText(block);
      if (!text) continue;
      if (block.t === 'h') {
        section = text;
        continue;
      }
      const folded = fold(text);
      if (!terms.every((t) => folded.includes(t))) continue;
      count++;
      if (lines.length >= MAX_FOUND) continue;
      lines.push(`[${this._passage(whole, c, b, text, section)}] ${around(text, folded.indexOf(terms[0]))}`);
    }
    if (!count) return `No passage of ${whole.title} has all of “${words}”.`;
    return `${count === 1 ? 'One passage' : `${count} passages`} of ${whole.title} with “${words}”${count > lines.length ? `; the first ${lines.length}` : ''}:\n${lines.join('\n')}`;
  }
}

/**
 * A passage as find shows it: whole when short, else PASSAGE_CHARS round the words found.
 * @param {string} text @param {number} at where the first word found is
 */
function around(text, at) {
  if (text.length <= PASSAGE_CHARS) return text;
  const from = Math.max(0, Math.min(at - 200, text.length - PASSAGE_CHARS));
  const start = from > 0 ? text.indexOf(' ', from) + 1 || from : 0;
  return `${start > 0 ? '…' : ''}${cut(text.slice(start), PASSAGE_CHARS)}`;
}
