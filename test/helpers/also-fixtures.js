// A small library in five ZIM files, for "Also in the library" (public/js/librarian/also.js): two
// gutenberg2zim-like files that share an author and a work, a Wikisource with the same work and
// another of that author's, and two Wikipedias with the articles on an author and on a book, and
// with what must not be taken for them: the article of a book's word ("Language"), a page that
// lists what a name may refer to ("John Smith"), a theory by a book's author ("Relativity"), a
// writer's article that names nothing of theirs. Used by test/librarian-also-zim.test.js, which
// reads them as the server does, and for checking the page in a browser.

import crypto from 'node:crypto';
import path from 'node:path';
import { bookHtml, js, page, png, WIKI_PNG, WS_PNG } from './zim-fixtures.js';
import { writeZim } from './zimwriter.js';

const uuidOf = (file) => crypto.createHash('md5').update(path.basename(file)).digest();
const text = (mime, content) => ({ mime, content });
const meta = (fields) => Object.entries(fields).map(([url, content]) => ({ ns: 'M', url, ...text('text/plain', content) }));

/** A book's pages: enough paragraphs to turn a few. @param {string} title @param {string} about */
const pages = (title, about) => bookHtml(title, Array.from({ length: 24 }, (_, i) => `<p>${about} Paragraph ${i + 1} of ${title}, with words enough to fill a line or two of a page and to make a few pages of it.</p>`).join('\n'));

/**
 * A gutenberg2zim-like file: rows [title, author, formats, id, shelf], and its authors' numbers.
 * @param {string} file
 * @param {string} name the ZIM's Name
 * @param {string} description
 * @param {Array<[string, string, string, number, string]>} rows
 * @param {Array<[string, string]>} authors
 */
function writeGutenberg(file, name, description, rows, authors) {
  const entries = [
    { ns: 'C', url: 'full_by_popularity.js', ...text('text/javascript', js('json_data', rows)) },
    { ns: 'C', url: 'authors.js', ...text('text/javascript', js('authors_json_data', authors)) },
    { ns: 'C', url: 'languages.js', ...text('text/javascript', js('languages_json_data', [['English', 'en', rows.length]])) },
    { ns: 'C', url: 'lcc_shelves.js', ...text('text/javascript', js('lcc_shelves_json_data', [...new Set(rows.map((r) => r[4]))])) },
    ...rows.map(([title, author, , id]) => ({ ns: 'C', url: `${title.replace('/', '-').substring(0, 230)}.${id}`, ...text('text/html', pages(title, `By ${author}.`)) })),
    ...meta({ Title: 'Project Gutenberg Library', Description: description, Language: 'eng', Creator: 'gutenberg.org', Publisher: 'openZIM', Date: '2026-01-02', Name: name }),
    { ns: 'M', url: 'Illustration_48x48@1', mime: 'image/png', content: png(48, 48) },
  ];
  return writeZim(file, { entries, scheme: 'new', uuid: uuidOf(file) });
}

/**
 * An mwoffliner-like article: its first heading, its opening paragraphs, then sections.
 * @param {string} title
 * @param {string[]} opening
 * @param {Array<[string, string]>} [sections] [heading, html]
 */
export function wikiArticle(title, opening, sections = []) {
  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${title}</title></head><body>
<div class="mw-body"><h1 id="firstHeading">${title}</h1><div id="mw-content-text"><div class="mw-parser-output">
${opening.map((t) => `<p>${t}</p>`).join('\n')}
${sections.map(([name, html]) => `<details data-level="2" open><summary class="section-heading"><h2 id="${name.replace(/ /g, '_')}">${name}</h2></summary>\n${html}</details>`).join('\n')}
</div></div></div></body></html>`.padEnd(1500, ' ');
}

/**
 * An mwoffliner-like Wikipedia: [title, html] articles, and other names for some.
 * @param {string} file
 * @param {string} title the ZIM's title
 * @param {Array<[string, string]>} articles
 * @param {Array<[string, string]>} [redirects] [another name, the article's title]
 */
function writeWikipedia(file, title, articles, redirects = []) {
  const url = (t) => t.replace(/ /g, '_');
  const entries = [
    { ns: 'C', url: 'Main_Page', title: 'Main Page', ...text('text/html', wikiArticle('Main Page', ['Welcome to Wikipedia.'])) },
    ...articles.map(([t, html]) => ({ ns: 'C', url: url(t), title: t, ...text('text/html', html) })),
    ...redirects.map(([from, to]) => ({ ns: 'C', url: url(from), title: from, redirectTo: `C/${url(to)}` })),
    { ns: 'C', url: '_assets_/style.css', ...text('text/css', 'body{}') },
    ...meta({ Source: 'en.wikipedia.org', Title: title, Language: 'eng', Creator: 'Wikipedia' }),
    { ns: 'M', url: 'Illustration_48x48@1', mime: 'image/png', content: WIKI_PNG },
  ];
  return writeZim(file, { entries, scheme: 'new', mainPage: 'C/Main_Page', uuid: uuidOf(file) });
}

/**
 * Writes the five files into a folder (which must exist).
 * @param {string} dir
 * @returns {{ pg: string, all: string, ws: string, wp: string, mini: string }} their paths
 */
export function writeAlsoSet(dir) {
  const files = {
    pg: path.join(dir, 'gutenberg_en_lcc-p_2026-01.zim'),
    all: path.join(dir, 'gutenberg_en_lcc-ps_2026-01.zim'),
    ws: path.join(dir, 'wikisource_en_test_2026-01.zim'),
    wp: path.join(dir, 'wikipedia_en_test_2026-01.zim'),
    mini: path.join(dir, 'wikipedia_en_test_mini_2026-01.zim'),
  };
  writeGutenberg(files.pg, 'gutenberg_en_lcc-p', 'All books in English from LCC shelf P - Language and literature', [
    ['Language: An Introduction to the Study of Speech', 'Edward Sapir', '100', 12629, 'P'],
    ['Lectures on the Science of Language', 'F. Max (Friedrich Max) Müller', '100', 32856, 'P'],
    ['Adventures of Huckleberry Finn', 'Mark Twain', '100', 76, 'P'],
    ['A Tramp Abroad — Volume 1', 'Mark Twain', '100', 119, 'P'],
    ['Beowulf', 'Anonymous', '100', 16328, 'P'],
    ['A Description of New England', 'John Smith', '100', 500, 'P'],
    ['Poems', 'Ann Nobody', '100', 600, 'P'],
  ], [['Edward Sapir', '4464'], ['F. Max (Friedrich Max) Müller', '787'], ['Mark Twain', '53'], ['Anonymous', '216'], ['John Smith', '1'], ['Ann Nobody', '9']]);
  writeGutenberg(files.all, 'gutenberg_en_lcc-ps', 'All books in English from LCC shelf PS - American literature', [
    ['Language: An Introduction to the Study of Speech', 'Edward Sapir', '100', 12629, 'PS'],
    ['The Adventures of Tom Sawyer', 'Mark Twain', '100', 74, 'PS'],
    ['A Tramp Abroad — Volume 2', 'Mark Twain', '100', 5782, 'PS'],
    ['Select Discourses', 'John Smith', '100', 700, 'PS'],
  ], [['Edward Sapir', '4464'], ['Mark Twain', '53'], ['John Smith', '2']]);

  // A Wikisource: works are pages with subpages; their authors come from Author: pages.
  const C = (url, html) => ({ ns: 'C', url, title: url.replace(/_/g, ' '), ...text('text/html', html) });
  const work = (url, title, parts, cats) => [
    C(url, page(title, `<ul>${parts.map((part) => `<li><a href="${url}/${part.replace(/ /g, '_')}">${part}</a></li>`).join('')}</ul>`, cats)),
    ...parts.map((part) => C(`${url}/${part.replace(/ /g, '_')}`, page(`${title}/${part}`, `<p>${part} of ${title}. ${'It goes on for a while. '.repeat(30)}</p>`))),
  ];
  writeZim(files.ws, {
    entries: [
      C('Main_Page', page('Main Page', '<p>Welcome</p>')),
      ...work('Adventures_of_Huckleberry_Finn', 'Adventures of Huckleberry Finn', ['Chapter 1', 'Chapter 2'], ['Novels', '1884 works']),
      ...work('Roughing_It', 'Roughing It', ['Chapter 1', 'Chapter 2'], ['1872 works', 'Travel literature']),
      ...work('Beowulf', 'Beowulf', ['Part 1', 'Part 2'], ['Epic poems']),
      ...work('Chips_from_a_German_Workshop', 'Chips from a German Workshop', ['Volume 1', 'Volume 2'], ['Essays']),
      C('Author:Mark_Twain', page('Author:Mark Twain', '<ul><li><a href="Adventures_of_Huckleberry_Finn">Adventures of Huckleberry Finn</a> (1884)</li><li><a href="Roughing_It">Roughing It</a> (1872)</li></ul>')),
      C('Author:Max_Müller', page('Author:Max Müller', '<ul><li><a href="Chips_from_a_German_Workshop">Chips from a German Workshop</a></li></ul>')),
      { ns: 'C', url: '_assets_/h/PD-icon.svg.png', mime: 'image/png', content: WS_PNG },
      ...meta({ Source: 'en.wikisource.org', Title: 'Wikisource', Language: 'eng' }),
    ],
    scheme: 'new', mainPage: 'C/Main_Page', uuid: uuidOf(files.ws),
  });

  writeWikipedia(files.wp, 'Wikipedia', [
    ['Adventures of Huckleberry Finn', wikiArticle('Adventures of Huckleberry Finn', ['Adventures of Huckleberry Finn is a picaresque novel by American author Mark Twain, first published in the United Kingdom in December 1884.'], [['Plot', '<p>Huck runs away down the river on a raft.</p>']])],
    ['Edward Sapir', wikiArticle('Edward Sapir', ['Edward Sapir (1884–1939) was an American anthropologist-linguist, widely considered one of the most important figures in the development of linguistics in the United States.'], [['Works', '<ul><li>Language: An Introduction to the Study of Speech (1921)</li><li>Time Perspective in Aboriginal American Culture (1916)</li></ul>']])],
    ['John Smith', wikiArticle('John Smith', ['John Smith may refer to:'], [['People', '<ul><li>John Smith (explorer) (1580–1631), of Jamestown, who wrote A Description of New England</li><li>John Smith (Platonist) (1618–1652), who wrote the Select Discourses</li></ul>']])],
    ['Language', wikiArticle('Language', ['Language is a structured system of communication that consists of grammar and vocabulary. It is the primary means by which humans convey meaning.'], [['Study', '<p>Edward Sapir wrote a book on it, and so did Otto Jespersen and Max Müller.</p>']])],
    ['Language (Sapir book)', wikiArticle('Language (Sapir book)', ['Language: An Introduction to the Study of Speech is a 1921 work on linguistics, among the first written for the general reader.'])],
    ['Mark Twain', wikiArticle('Mark Twain', ['Samuel Langhorne Clemens (1835–1910), known by the pen name Mark Twain, was an American writer, humorist and essayist.', 'His novels include The Adventures of Tom Sawyer (1876) and its sequel, Adventures of Huckleberry Finn (1884).'], [['Travel', '<p>He wrote Roughing It and A Tramp Abroad of his journeys.</p>']])],
    ['Max Müller', wikiArticle('Max Müller', ['Friedrich Max Müller (1823–1900) was a German-born British philologist and Orientalist, one of the founders of the study of comparative religion.'], [['Life', '<p>He lived and taught in Oxford.</p>']])],
    ['Relativity', wikiArticle('Relativity', ['The theory of relativity usually encompasses two interrelated physics theories by Albert Einstein, proposed and published in 1905 and 1915.'])],
    ['Roughing It', wikiArticle('Roughing It', ['Roughing It is a book of semi-autobiographical travel literature by Mark Twain, written in 1870–71 and published in 1872.'])],
  ], [['Samuel Clemens', 'Mark Twain']]);
  writeWikipedia(files.mini, 'Wikipedia (introductions)', [
    ['Ann Nobody', wikiArticle('Ann Nobody', ['Ann Nobody (born 1970) is a Canadian curler, who has played in four national championships and coached a fifth.'])],
    ['Mark Twain', wikiArticle('Mark Twain', ['Samuel Langhorne Clemens, known by the pen name Mark Twain, was an American writer, humorist and essayist, praised as the greatest humorist of his country.'])],
    ['Robert Gordon Latham', wikiArticle('Robert Gordon Latham', ['Robert Gordon Latham (1812–1888) was an English ethnologist and philologist, who wrote on the English language and on the varieties of man.'])],
  ]);
  return files;
}
