// @ts-check
// The librarian's words (docs/LIBRARIAN.md, experiment 1; SPEC §5.10): a question in English
// becomes a search of the library, the search box's own (search.js: titles, subtitles and authors
// in the catalogue; Wikipedia's articles by title and by their other names; the full text where the
// server has it), and the answer says what was found and nothing more: the librarian can only find
// things. Pure but for the searches it is given, so it is tested in Node.

import { fold, matchBooks } from '../search.js';

/** The most an answer lists. */
export const MAX_FINDS = 5;

/** ms an answer waits for the articles and the full text (a stalled request), then goes on without them. */
export const ANSWER_WAIT = 10000;

/** What the librarian says to a question with nothing in it, or only a greeting. */
export const PROMPT = 'Ask me for a title, an author or a subject.';
/** The same while he reads the books for his answers (experiment 2): a question too. */
export const PROMPT_READING = 'Ask me a question, or for a title, an author or a subject.';

/** Words that open a question, taken off its front one after another ("Hello, do you have …"). */
const OPENERS = [
  /^(?:hello|hi|hey|good (?:morning|afternoon|evening)|excuse me|dear librarian|librarian|please|ok(?:ay)?|so|well|um+|er+|uh+)\b[\s,.!:;-]*/i,
  /^(?:can|could|would|will) you (?:please )?(?:help me )?(?:find|show|get|bring|give|fetch|look up|look for|search for|tell me where)(?: me| us)?\b/i,
  /^(?:can|could|may|might) (?:i|we) (?:please )?(?:have|find|see|get|read|borrow)\b/i,
  /^(?:do|does) (?:you|the library|this library|it) (?:happen to )?(?:have|hold|keep|carry|stock)\b/i,
  /^have you(?: got)?\b/i,
  /^(?:is|are) there\b/i,
  /^(?:i'm|im|i am|we're|we are) (?:looking|searching) for\b/i,
  /^(?:looking|searching) for\b/i,
  /^(?:i'd|id|i would|we'd|we would) (?:like|love)(?: to (?:read|find|see|have))?\b/i,
  /^(?:i|we) (?:want|need)(?: to (?:read|find|see))?\b/i,
  /^(?:find|show|get|bring|give|fetch)(?: me| us)?\b/i,
  /^(?:search|look)(?: for| up)?\b/i,
  /^where (?:is|are|can i find|do i find|would i find|might i find)\b/i,
  /^where's\b/i,
  /^who wrote\b/i,
  /^(?:a|an|any|some|the) (?:copy|copies|edition) of\b/i,
];

/** Words that close a question ("…, please"). */
const CLOSERS = /(?:[\s,]+(?:please|thanks|thank you|for me|for us|here|in (?:the|this|your) library|by any chance|at all|maybe|perhaps))+$/i;

/** An author's books: "by Mark Twain", "anything by …", "books written by …", "the works of …". */
const AUTHOR = [
  /^(?:(?:anything|something|everything|all|any|some|the|other)\s+)?(?:(?:books?|works?|novels?|poems?|poetry|plays?|stories|writings?|titles?|texts?)\s+)?(?:(?:written|authored)\s+)?by\s+(.+)$/i,
  /^(?:(?:the|any|some|all)\s+)?(?:(?:complete|collected|other)\s+)?(?:works|writings|books|novels|poems|plays|stories) of\s+(.+)$/i,
];

/** A subject, Wikipedia's articles first: "what is …", "tell me about …", "the article on …". */
const SUBJECT = [
  /^(?:what|who)(?:'s| is| are| was| were)\s+(.+)$/i,
  /^tell (?:me|us) (?:about|of)\s+(.+)$/i,
  /^(?:(?:the|an?|any|some)\s+)?(?:wikipedia\s+)?(?:articles?|pages?|entry|entries)\s+(?:on|about|for|of|called|named|titled)\s+(.+)$/i,
  /^(?:information|info|facts)\s+(?:on|about|regarding|concerning)\s+(.+)$/i,
];

/** Books, or anything, on a subject: "books about …", "anything on …", "about …". */
const TOPIC = [
  /^(?:(?:any|some|a few|the)\s+)?(?:books?|novels?|reading|anything|something|everything)\s+(?:on|about|regarding|concerning)\s+(.+)$/i,
  /^(?:about|regarding|concerning)\s+(.+)$/i,
];

/**
 * A title: "a book called …". Not "the story …" alone, which begins titles ("The Story of the
 * Alphabet").
 */
const TITLE = [
  /^(?:(?:a|an|the|any)\s+)?(?:books?|novels?|copy|copies|poems?|plays?|story|stories|works?)\s+(?:called|named|titled|entitled)\s+(.+)$/i,
];

/**
 * What the open pages mention (experiment 3: asked beside the open book, here-panel.js; the card
 * is not there while a book is read).
 */
const HERE = [
  /^(?:what|which articles?)\s+(?:do|does)\s+(?:this|the|these|my)\s+(?:pages?|book|article|passage|part)\s+(?:mention|name)$/i,
  /^(?:what(?:'s| is| are)\s+)?(?:mentioned|named)\s+(?:here|on\s+(?:this|these)\s+pages?)$/i,
];

/** What he says to that in the card: where to ask it. */
export const HERE_HOW = 'Open a book and ask me beside it, with “Mentioned here” or L: I will tell you which articles of the other libraries its pages name.';

/** Words without a leading "the", "a" or "an" ("a black hole": "black hole"). @param {string} s */
const bareOf = (s) => s.replace(/^(?:the|an?)\s+/i, '');

/** The words inside quotation marks around the whole ("“Emma”"). */
const unquote = (s) => {
  const t = s.trim();
  const m = /^["“”«„](.+)["“”»]$/u.exec(t) ?? /^'(.+)'$/.exec(t);
  return (m ? m[1] : t).trim();
};

/** The first of `patterns` that matches all of `s`: what it holds; else null. */
const matchOf = (patterns, s) => {
  for (const re of patterns) {
    const m = re.exec(s);
    if (m) return m[1].trim();
  }
  return null;
};

/**
 * @typedef {'any' | 'book' | 'article'} Wants what a question asks for: anything (books first),
 *   a book (a title, an author's), or a subject (Wikipedia's articles first)
 */

/**
 * @typedef {object} Question
 * @property {string} q what to look for: a title or a subject; '' for an author's books
 * @property {string} by an author, or ''
 * @property {Wants} wants
 * @property {{ q: string, by: string } | null} split "Emma by Jane Austen" as a title and its
 *   author, tried when the whole finds nothing ("Stand by Me" is a title)
 * @property {string} whole the question as asked, without its closing punctuation: tried last
 * @property {boolean} empty whether it asks for nothing yet ("Hello", "Do you have")
 * @property {boolean} greeting whether it opens with a greeting
 * @property {boolean} here whether it asks what the open pages mention ("What does this page
 *   mention?"), which no search answers
 */

/**
 * What a question asks for, in English: its opening and closing words taken off ("Do you have …,
 * please?"), and an author ("anything by …"), a subject ("what is …") or a title ("a book called
 * …") told apart.
 * @param {string} text
 * @returns {Question}
 */
export function parseQuestion(text) {
  const whole = String(text ?? '').replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim().replace(/[\s?!.…]+$/u, '');
  let s = whole;
  for (let again = true; again && s;) {
    again = false;
    for (const re of OPENERS) {
      const m = re.exec(s);
      if (!m || !m[0].trim()) continue;
      s = s.slice(m[0].length).replace(/^[\s,:;-]+/, '');
      again = true;
    }
  }
  s = s.replace(CLOSERS, '').trim();
  const empty = !s;
  const greeting = /^(?:hello|hi|hey|good (?:morning|afternoon|evening))\b/i.test(whole);
  /** @type {Wants} */
  let wants = 'any';
  let by = '';
  let found;
  if ((found = matchOf(AUTHOR, s)) !== null) {
    by = unquote(found);
    s = '';
    wants = 'book';
  } else if ((found = matchOf(SUBJECT, s)) !== null) {
    s = bareOf(unquote(found)); // "what is a black hole": Wikipedia's "Black hole"
    wants = 'article';
  } else if ((found = matchOf(TOPIC, s)) !== null) {
    s = found;
  } else if ((found = matchOf(TITLE, s)) !== null) {
    s = found;
    wants = 'book';
  }
  const q = unquote(s);
  const m = !by && wants !== 'article' ? /^(.+?)\s+by\s+(.+)$/i.exec(q) : null;
  const split = m ? { q: unquote(m[1]), by: unquote(m[2]) } : null;
  // Asked of the pages, with or without a greeting before it ("Hello, what is mentioned here?").
  const asked = whole.replace(OPENERS[0], '');
  const here = HERE.some((re) => re.test(asked));
  return { q, by, wants, split, whole, empty, greeting, here };
}

/**
 * @typedef {object} Search one way of looking for a question's answer
 * @property {string} q
 * @property {string} by
 * @property {Wants} wants
 */

/**
 * Whether a book's title is these words, or begins with them as a whole ("What Is Man?", "The
 * Works of Edgar Allan Poe — Volume 1"), as search.js matchBooks ranks titles.
 * @param {Array<{ title: string }>} index search.js bookIndex (titles folded)
 * @param {string} text
 */
export function namesTitle(index, text) {
  const s = fold(text).trim();
  return !!s && index.some((e) => e.title.startsWith(s) && !/[\p{L}\p{N}]/u.test(e.title.charAt(s.length)));
}

/**
 * The searches to try, in order, until one finds something: the question as understood, then a
 * title and its author ("Emma by Jane Austen"), then the words as typed; the words as typed first
 * when a book has them for its title, which the question's forms would take apart ("What Is Man?"
 * is no subject to look up, "The Works of …" no author).
 * @param {Question} question
 * @param {Array<{ title: string }>} [index] the catalogue's books (search.js bookIndex)
 * @returns {Search[]}
 */
export function searchesFor(question, index) {
  /** @type {Search[]} */
  const list = [];
  /** @param {string} q @param {string} by @param {Wants} wants */
  const add = (q, by, wants) => {
    if (!q && !by) return;
    if (list.some((s) => fold(s.q) === fold(q) && fold(s.by) === fold(by))) return;
    list.push({ q, by, wants });
  };
  if (index && namesTitle(index, question.whole)) add(question.whole, '', 'any');
  add(question.q, question.by, question.wants);
  if (question.split) add(question.split.q, question.split.by, 'book');
  add(question.whole, '', 'any');
  return list;
}

/** A name's words ("Austen, Jane": austen, jane). @param {string} s */
const wordsOf = (s) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * Whether an author's name holds every word of `by`, each as the beginning of one of its words
 * ("twain" in "Mark Twain", "austen" in "Austen, Jane").
 * @param {string | undefined} author
 * @param {string[]} terms `by`'s words
 */
const writtenBy = (author, terms) => {
  const words = wordsOf(author ?? '');
  return terms.every((t) => words.some((w) => w.startsWith(t)));
};

/**
 * The catalogue's books for a search, the search box's best first (search.js matchBooks): every word
 * of `q` in the title, subtitle or author, and with `by`, written by someone whose name holds it.
 * @param {Array<{ book: any, lib: any, hay: string, title: string }>} index search.js bookIndex
 * @param {Search} search
 * @returns {Array<{ book: any, lib: any }>}
 */
export function booksFor(index, { q, by }) {
  const terms = wordsOf(by);
  /** @param {string} words */
  const look = (words) => {
    const found = matchBooks(index, words, Infinity);
    return terms.length ? found.filter((e) => writtenBy(e.book.author, terms)) : found;
  };
  if (!q) return terms.length ? look(by) : [];
  const books = look(q);
  const bare = bareOf(q);
  return books.length || !bare || bare === q ? books : look(bare);
}

/**
 * How an article's name (the one it was found by: another name's, or its title) stands to the
 * words asked: 0 the same, 1 beginning with them as a whole ("Paris Commune"), 2 beginning with
 * them inside a word ("Pariser–Parr–Pople method").
 * @param {{ title: string, from?: string }} article
 * @param {string[]} asked the words asked, folded (with and without a leading "the")
 */
function articleRank({ title, from }, asked) {
  let best = 2;
  for (const name of [from, title]) {
    if (!name) continue;
    const t = fold(name).trim();
    for (const s of asked) {
      if (t === s) return 0;
      if (t.startsWith(s) && !/[\p{L}\p{N}]/u.test(t.charAt(s.length))) best = 1;
    }
  }
  return best;
}

/**
 * A promise's answer, or [] when it fails or takes longer than `ms`.
 * @template T
 * @param {Promise<T[]>} promise
 * @param {number} ms
 * @returns {Promise<T[]>}
 */
function within(promise, ms) {
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  /** @type {Promise<T[]>} */
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve([]), ms); });
  return Promise.race([promise.catch(() => []), late]).finally(() => clearTimeout(timer));
}

/**
 * A place in a book or an article that the Librarian read (experiment 2: read.js findOf): its
 * section or its paragraph.
 * @typedef {object} Passage
 * @property {'passage'} kind
 * @property {any} lib
 * @property {string} bookId its book (an article's volume)
 * @property {{ c: number, b: number }} at where it is in the book
 * @property {string} title the book's or the article's title
 * @property {string} section the section's heading ('' for none)
 * @property {string} text what it says ('' for a section)
 * @property {string} [author] the book's author
 * @property {string | null} [cover] the book's cover
 */

/**
 * @typedef {{ kind: 'book', book: any, lib: any } | { kind: 'article', article: any, lib: any, mention?: { text: string, context: string } } | { kind: 'text', hit: any, lib: any }} SearchFind
 *   something a search found: a book, an article of a Wikipedia (search.js findArticles), or a
 *   place in a book's text (findInText). An article the open pages name (experiment 3: here.js)
 *   has its `mention`: the words as the page has them, and the words round them
 */

/**
 * @typedef {SearchFind | Passage} Find something found: by a search, or a place the Librarian read
 */

/**
 * @typedef {object} Found what one search found
 * @property {Search} search
 * @property {Array<{ book: any, lib: any }>} books every book
 * @property {Array<{ article: any, lib: any }>} articles
 * @property {Array<{ hit: any, lib: any }>} texts
 * @property {SearchFind[]} finds the ones the answer lists
 */

/**
 * The finds an answer lists, the best first: for an author or a title only books; for a subject
 * the articles first; else the books, but no more than three before the articles and the text's
 * places, and an article named exactly as asked first, unless a book is too.
 * @param {Search} search
 * @param {Found['books']} books
 * @param {Found['articles']} articles
 * @param {Found['texts']} texts
 * @returns {SearchFind[]}
 */
export function chooseFinds(search, books, articles, texts) {
  /** @type {SearchFind[]} */
  const b = books.map(({ book, lib }) => ({ kind: 'book', book, lib }));
  /** @type {SearchFind[]} */
  const a = articles.map(({ article, lib }) => ({ kind: 'article', article, lib }));
  /** @type {SearchFind[]} */
  const t = texts.map(({ hit, lib }) => ({ kind: 'text', hit, lib }));
  if (search.wants === 'book') return b.slice(0, MAX_FINDS);
  if (search.wants === 'article') return [...a, ...b, ...t].slice(0, MAX_FINDS);
  const asked = new Set([fold(search.q).trim(), fold(bareOf(search.q)).trim()]);
  /** @param {string | undefined} title */
  const named = (title) => !!title && asked.has(fold(title).trim());
  const first = books.some((e) => named(e.book.title)) ? [] : a.filter((f) => f.kind === 'article' && (named(f.article.from) || named(f.article.title)));
  const before = a.length || t.length ? 3 : MAX_FINDS;
  return [...first, ...b.slice(0, before), ...a.filter((f) => !first.includes(f)), ...b.slice(before), ...t].slice(0, MAX_FINDS);
}

/**
 * @typedef {object} Library what the librarian looks in
 * @property {Array<{ id: string, title?: string }>} libraries the catalogue's libraries
 * @property {() => Array<{ book: any, lib: any, hay: string, title: string }>} index the search
 *   index of their books (search.js bookIndex), made when first needed
 * @property {(q: string) => Promise<Array<{ article: any, lib: any }>>} findArticles Wikipedia's
 *   articles whose titles start with q (search.js findArticles)
 * @property {(q: string) => Promise<Array<{ hit: any, lib: any }>>} findInText places in the
 *   books' text (search.js findInText; only through the server's kiwix-serve)
 * @property {number} [wait] ms to wait for those two (ANSWER_WAIT)
 * @property {string} [prompt] what he says to ask him: PROMPT, or PROMPT_READING while he reads
 */

/**
 * What one search finds: the books, and unless it is for an author's books or a title, the
 * articles (with a leading "the", "a" or "an" and without; those named as asked first, then those
 * beginning with the words as a whole, each library's order kept among equals) and the places in
 * the text.
 * @param {Search} search
 * @param {Library} library
 * @returns {Promise<Found>}
 */
export async function lookFor(search, { index, findArticles, findInText, wait = ANSWER_WAIT }) {
  const books = booksFor(index(), search);
  const more = search.wants !== 'book' && !search.by;
  const forms = [search.q];
  const bare = bareOf(search.q);
  if (bare && bare !== search.q) forms.push(bare);
  const [lists, texts] = await Promise.all([
    more ? Promise.all(forms.map((q) => within(findArticles(q), wait))) : Promise.resolve([]),
    more ? within(findInText(search.q), wait) : Promise.resolve([]),
  ]);
  /** @type {Found['articles']} */
  const articles = [];
  const seen = new Set();
  for (const e of lists.flat()) {
    const key = `${e.lib.id}\n${e.article.book}\n${e.article.n}`;
    if (seen.has(key)) continue;
    seen.add(key);
    articles.push(e);
  }
  const asked = forms.map((f) => fold(f).trim());
  const ranks = new Map(articles.map((e) => [e, articleRank(e.article, asked)]));
  articles.sort((x, y) => (ranks.get(x) ?? 2) - (ranks.get(y) ?? 2)); // stable: each library's order among equals
  return { search, books, articles, texts, finds: chooseFinds(search, books, articles, texts) };
}

/** Each kind's words, for one and for many. */
const NOUNS = /** @type {const} */ ({ book: ['a book', 'books'], article: ['an article', 'articles'], text: ['a passage', 'passages'] });

/**
 * "3 books and 2 articles": how many of each kind.
 * @param {{ book?: number, article?: number, text?: number }} counts
 */
function phrase(counts) {
  const parts = /** @type {Array<keyof typeof NOUNS>} */ (Object.keys(NOUNS)).filter((k) => counts[k])
    .map((k) => (counts[k] === 1 ? NOUNS[k][0] : `${counts[k]} ${NOUNS[k][1]}`));
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0] ?? '';
}

/**
 * The author's name as the books give it, when they all give the same; else as asked.
 * @param {Found['books']} books
 * @param {string} by
 */
function authorName(books, by) {
  const names = new Set(books.map((e) => e.book.author).filter(Boolean));
  return names.size === 1 ? String([...names][0]) : by;
}

/**
 * What the librarian says about what a search found: what it has, nothing about what it means.
 * @param {Found} found
 * @param {Array<{ title?: string }>} libraries the catalogue's libraries
 * @returns {string}
 */
export function answerText(found, libraries) {
  const { search, books, articles, texts, finds } = found;
  const asked = search.q ? `“${search.q}”${search.by ? ` by ${search.by}` : ''}` : '';
  if (!finds.length) {
    if (!libraries.length) return 'There are no books here yet.';
    const what = !search.q ? `no books by ${search.by}` : search.wants === 'article' ? `no article on ${asked}` : `nothing called ${asked}`;
    return `I have ${what}. I looked in ${libraries.length === 1 ? 'the library here' : `all ${libraries.length} libraries here`}.`;
  }
  const multi = libraries.length > 1;
  if (finds.length === 1) {
    const f = finds[0];
    const where = multi && f.lib.title ? `, in ${f.lib.title}` : '';
    if (f.kind === 'book') return `I have ${f.book.title}${f.book.author ? `, by ${f.book.author}` : ''}${where}.`;
    if (f.kind === 'article') return `I have the article “${f.article.title}”${where}.`;
    return `I found ${asked} in ${f.hit.title}${where}.`;
  }
  /** @type {{ book: number, article: number, text: number }} */
  const shown = { book: 0, article: 0, text: 0 };
  for (const f of finds) shown[f.kind]++;
  const moreBooks = books.length - shown.book;
  if (!search.q) {
    const name = authorName(books, search.by);
    return moreBooks > 0 ? `I have ${books.length} books by ${name}; here are the first ${finds.length}.` : `I have ${phrase(shown)} by ${name}.`;
  }
  if (!articles.length && !texts.length && moreBooks > 0) return `I have ${books.length} books for ${asked}; here are the first ${finds.length}.`;
  const more = moreBooks > 0 || articles.length > shown.article || texts.length > shown.text;
  return `I have ${phrase(shown)} for ${asked}${more ? ', and more' : ''}.`;
}

/**
 * @typedef {object} Answer
 * @property {string} text what the librarian says (as his voice says it: without numbers)
 * @property {string} [said] what his voice says instead, where it says more than is shown (what
 *   the open pages mention: the articles' names too, here.js)
 * @property {Find[]} finds what it found, at most MAX_FINDS, the best first; a reading's sources
 * @property {Search | null} search the search that found them (the first one tried when none did)
 * @property {Array<{ text: string, cites: number[] }>} [statements] a reading's sentences (read.js
 *   answerOf), each with the numbers of its sources: finds[n - 1]
 * @property {any} [reading] the reading behind it, for the console and scripted checks
 */

/**
 * Answers a question: the searches it allows (searchesFor), one after another until one finds
 * something. A question that asks for nothing yet ("Hello") is answered with what to ask.
 * @param {string} text the question as asked
 * @param {Library} library
 * @returns {Promise<Answer>}
 */
export async function ask(text, library) {
  const question = parseQuestion(text);
  const prompt = library.prompt ?? PROMPT;
  if (question.empty) return { text: question.greeting ? `Hello. ${prompt}` : prompt, finds: [], search: null };
  // What the open pages mention is asked beside the book, not here: he says where.
  if (question.here) return { text: HERE_HOW, finds: [], search: null };
  /** @type {Found | null} */
  let first = null;
  for (const search of searchesFor(question, library.index())) {
    const found = await lookFor(search, library);
    first ??= found;
    if (found.finds.length) return { text: answerText(found, library.libraries), finds: found.finds, search };
  }
  return { text: first ? answerText(first, library.libraries) : prompt, finds: [], search: first?.search ?? null };
}

/**
 * A find's lines, as the search's results show them: its title (an article reached by another
 * name: "NYC → New York City"), the line under it (author and library; an article's library and
 * volume), and a place in the text's snippet ([text, hit] parts, the hit words to stress).
 * @param {Find} find
 * @param {boolean} multi whether there is more than one library with books (the line names a book's)
 * @returns {{ title: string, line: string, snippet: Array<[string, boolean]> | null }}
 */
export function findLines(find, multi) {
  if (find.kind === 'book') {
    return { title: String(find.book.title ?? ''), line: [find.book.author, multi ? find.lib.title : null].filter(Boolean).join(' · '), snippet: null };
  }
  if (find.kind === 'article') {
    const { title, from, book } = find.article;
    // An article the page names: the page's words round its name, the name stressed, and few
    // enough words before it that it shows in the two lines the card gives a snippet.
    const said = find.mention;
    const at = said ? said.context.indexOf(said.text) : -1;
    /** @type {Array<[string, boolean]> | null} */
    let snippet = null;
    if (said && at < 0) snippet = [[said.context, false]];
    else if (said) {
      let before = said.context.slice(0, at);
      if (before.length > MENTION_LEAD) before = `… ${before.slice(-MENTION_LEAD).replace(/^\S*\s+/, '')}`;
      snippet = [[before, false], [said.text, true], [said.context.slice(at + said.text.length), false]];
    }
    return { title: from ? `${from} → ${title}` : String(title), line: `${find.lib.title} · Volume ${String(book).slice(1)}`, snippet };
  }
  if (find.kind === 'passage') {
    // Its book and section, and what it says, quoted (cut: the card shows two lines of it).
    const text = find.text.length > PASSAGE_SHOWN ? `${find.text.slice(0, PASSAGE_SHOWN).replace(/\s+\S*$/, '')}…` : find.text;
    return {
      title: find.title,
      line: [find.section, find.author, multi ? find.lib.title : null].filter(Boolean).join(' · '),
      snippet: text ? /** @type {Array<[string, boolean]>} */ ([[`“${text}”`, false]]) : null,
    };
  }
  return { title: String(find.hit.title ?? ''), line: [find.hit.author, find.lib.title].filter(Boolean).join(' · '), snippet: find.hit.snippet ?? null };
}

/** How much of a passage a find shows: two lines of the card, or of his panel's list. */
const PASSAGE_SHOWN = 240;
/** How much of a page's words a find shows before the name they mention. */
const MENTION_LEAD = 40;

/**
 * What the librarian says, with a reading's sources as numbers ("… 1921. [1]"), where they are
 * shown in text alone (his panel in VR); the answer's text as it is otherwise.
 * @param {Answer} answer
 */
export function citedText(answer) {
  if (!answer.statements) return answer.text;
  return answer.statements.map((s) => (s.cites.length ? `${s.text} [${s.cites.join(', ')}]` : s.text)).join(' ');
}
