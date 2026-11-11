# The Librarian: experiments

Experiments with an AI librarian in vrlbry's library, in a repository of their own, a fork of
vrlbry's main: AriaMoKr/librarian, with a site of its own, <https://ariamokr.github.io/librarian/>
(CLAUDE.md, "Branches and sites"). These are the proposals, cheapest first, each one something to
try on its own.

**Built so far** (SPEC §5.10): experiment 1, all four steps, experiment 2's first three, and
experiment 3's steps 1, 2 and 4.
- **The words, in the library card:** a question becomes a search, then an answer with what it
  found, and *Take me there* goes to it as the search's results do. It works on a desktop (L), a
  phone and a TV.
- **The figure beside the stand:** he faces where you arrive and turns towards you as you come
  near. Clicking or tapping him, or a TV's OK with the dot on him, goes into the card's question
  box. In VR you point at him and pull the trigger, and his panel opens with the stand's keyboard,
  his answer and what he found. He costs 1 draw call, his panel 1 more while it is open.
- **The walk:** *Take me there* and he goes ahead along a way round what stands in the room (a
  grid over the floor, made once per room, and A* across it), you follow, eased, and he stands
  beside the shelf as the book comes out to you. A soft line on the floor shows the way while you
  go (1 draw call). On a screen the view turns the way you go; in VR your head keeps its own turn,
  the comfort vignette closes with the speed, a long way's middle is skipped in a blink, and the
  turn to the shelf is a blink. A click, a tap, Enter, Esc or the trigger is there at once; with
  less motion it is the cut it was. Later he walks back to the desk.
- **His voice:** once chosen (the help's "The librarian speaks his answers", or *Voice* on his
  panel; off at first), he says each answer aloud with the browser's speech synthesis, in an
  English voice of the device's own (never a network voice, which would send the words to its
  service), a man's where one is known by name. A new question stops the last answer. Where the
  device has no such voice, the choice says so.
- **Experiment 2, step 1: his reading.** A model of Ollama's (gemma4:12b) gets the library as
  tools (search the books, the articles and the full text; read a book or an article a page at a
  time; find words in one) and answers in one to three sentences, each citing what it read. Each
  sentence is then held to the citation rule in code, and what fails is struck; with nothing left
  he says "I found nothing that says so." The server forwards each turn to Ollama on the same
  machine (`--ollama <model>`) and logs nothing. Measured with eight models over the 24
  questions: gemma4:12b answered all of them right, with nothing struck, in both runs; qwen3:8b
  and gemma4:26b 23; none made up a source (SPEC §5.10).
- **Experiment 2, step 2: in the card.** Where the server has a model, the help offers "The
  librarian reads the books to answer questions", off at first. Chosen, he reads for each
  question, and meanwhile the card shows what he is doing ("Reading Language: An Introduction to
  the Study of Speech…"). His sentences carry the numbers of their sources, which are listed under
  them: a passage with its words, a section, an article or a book. *Take me there* on a passage
  walks you to its book, which opens at that paragraph. With nothing left he says so and adds
  what the plain search found; when the model cannot answer he says that and answers as in
  experiment 1. A newer question stops the reading, at the model too, and the model is warmed up
  as the box takes the focus. On the static site nothing changes. With gemma4:12b an answer took
  2.6–3.6 s on the development PC.
- **Experiment 2, step 3: first, in VR and aloud.** What the catalogue finds comes at once, as in
  experiment 1, with what he is doing on a line under it, and his reading's answer then takes its
  place; taking one of those first finds stops his reading. When the catalogue finds nothing
  (often, for a question asked as a question) he shows what he is doing until his answer comes. In VR his panel shows the same: what
  he is doing, then his sentences with their sources' numbers and the sources as its list, each a
  *Take me there*. It is drawn again only when its words change, and opening it warms the model
  up. With his voice chosen he says the answer he ends with, without the numbers.
- **Experiment 3, step 1: the rule for links between libraries.** Nothing to see yet: it is the
  rule by which he will tell what a page names that another library has an article on, and its
  measure. The words must be the article's title as written, two words or more and not little
  words only, and the text must show which sense it means: it writes them as a name, or it names
  another article of the same library within a few lines. `tools/librarian-xref.mjs` counts them
  over the demo set and holds the rule to 517 matches read by hand. What the rule offers was the
  right article 190 times of 196; what it holds back, 89 of 114; single words, which it never
  offers, 46 of 97.
- **Experiment 3, step 2: "Mentioned here".** With a book open on a screen, his button at the
  foot of the page (beside *Text view*; in the text view, in its toolbar), or L, lists the
  articles of the other libraries that the open pages name, at most five, each with the page's
  words round its name. *Take me there* brings the article into your hands as a link's page
  comes, and Back brings your book back at your page. The other libraries' titles are got the
  first time you ask (about a second for the demo set's 110,000, then kept), and nothing before.
  The library card is not there while a book is read, so the question typed in it gets where to
  ask instead. It works with a keyboard, a touch screen and a TV's remote.
- **Experiment 3, step 4: in a headset and aloud.** In VR his button, *Mentioned here*, is at the
  right end of the open book's toolbar, and his answer comes on a panel of his beside the pages
  (the contents are on the other side): what he is doing, then his words and the articles, each
  a *Take me there* by the trigger; B or Y brings your book back. A turned page closes it. With
  his voice chosen he says the answer and names the articles, on a screen too. The titles are
  now kept in a worker of their own, which gets them itself and reads the pages against them:
  keeping WikiMed's 71,000 alone takes 131 ms on a desktop, far more than a frame in a headset
  has, and the page's memory is spared their 14 MB. Two things are not as proposed: the list is
  a panel of its own (his desk's closes as it opens), and the button to ask is one draw call for
  each eye while a book is read in a headset.

Next: experiment 3's step 3, "Also in the library" for the book in hand. Experiment 2's step 4
(whether the Pages site can talk to a visitor's own Ollama directly) waits on a test of its own,
not run yet. His reading and "Mentioned here" in VR have been checked with the emulator only, not
yet on a Quest itself.

The model is the Librarian of Neal Stephenson's *Snow Crash* (1992): a daemon who fronts a vast
library in the Metaverse, appears as a pleasant silver-haired man in a sweater and tie, and finds,
retrieves and cross-references anything at once, but will not speculate or draw conclusions. He
can only find things; what they mean is the reader's to work out.

## The experiments

### 1. A librarian at the desk, no AI yet

A figure near the kiosk takes a question and answers it with the search the app already has
(titles and authors: `search.js`; Wikipedia articles and their redirects: `searchIndex`,
`searchRedirects`), then leads you to the book: walks to the shelf or lights a path, and hands it
to you (`interaction.ensureShelved`, `interaction.openArticle`). It can speak its answers with the
browser's speech synthesis (`speechSynthesis`).

This builds the body, the conversation panel (common's `Panel`, SPEC §5.5; `interaction.notice`
for a word in the headset) and the "take me there" part that every later experiment reuses. It
works offline and on the Quest.

### 2. "I can only find things": answers with citations

A language model gets the library as tools: search titles, search articles, search the full text
(Kiwix's Xapian indexes: [SEARCH.md](SEARCH.md#kiwixs-search-indexes-xapian)), read a chunk of a
book or article (`ArchiveLibrary.chunk`), open a book at a passage. Like Stephenson's Librarian,
it never speculates: every statement points to a source, a book and a block anchor `{c, b}`, and
selecting the source opens the book at that exact paragraph. This is the core of the idea, and the
citation rule also keeps the model from making things up.

- **A local model, through Ollama** (chosen 2026-11-07). The page holds the conversation and runs
  the tools; the Node server forwards each turn to Ollama on the same machine (`--ollama <model>`,
  a route beside `server/http.js`'s), so the question never leaves it. Any of Ollama's models that
  can call tools will do; gemma4:12b by default, chosen over seven others on the questions below.
  The static site has no model: there he answers as in experiment 1 (step 4 would change that).
- **The citation rule, in code** (`librarian/cite.js`). Each sentence must end with ids the tools
  gave; a quote must be in the passage it cites (or the one that has it is cited instead); its
  numbers and names must be in what it cites, or round it (the book's title and author, the
  section); it may judge or guess ("the best", "probably") only where its sources do, and never
  say what he thinks; and at least half its other words must be there. What fails is struck. He
  must search before he answers, and with nothing left he says "I found nothing that says so."
- **Opt-in**: a choice in the help, off at first, and offered only where the server has a model.
- **Steps**: 1. the reading, the rule, the route and an evaluation (`tools/librarian-eval.mjs`:
  24 questions over the demo set, 4 of them with no answer there); 2. the card; 3. VR and the
  voice; 4. later, the Pages site with a visitor's own Ollama.
- **A hosted model later**: Claude Haiku 5.5 (`claude-haiku-5-5`) or Sonnet 5.5
  (`claude-sonnet-5-5`) can come through the same loop. Its key goes in the server's environment,
  set by hand, never in chat, a commit or the site, and a question sent to it leaves the device.

### 3. Cross-references between libraries

While you read *Moby-Dick* from Gutenberg, the librarian offers the Wikipedia article on Melville,
his other works on Wikisource, and the articles a passage mentions. A first version can match
titles and authors without any AI; the model from experiment 2 can add looser connections later.
This makes the separate ZIMs feel like one library.

- **What a count over the demo set showed** (2026-11-10). None of its 19 Gutenberg books has its
  author or its title among its Wikipedias, which are the 100 most-read articles and five
  topics. The links in its articles all lead within their own file: a link to an article outside
  a file's selection was dropped when the file was made, and the words kept. So there a link
  between libraries has to come from a page's words.
- **The rule for words** (`librarian/xref.js`). Words that merely resemble a title are mostly
  noise ("up to" for mathematics' *Up to*, "Nova" for *NOvA*), and single words are the right
  article less than half the time ("Mass" in *Catholic Church* is not physics' *Mass*). The
  title as written, in two words or more, is right about 9 times in 10; the rest is one sense of
  the same words for another ("large numbers of bats", a fungus's "nuclear fusion"). So the text
  must also show which sense it means, by writing the words as a name or by naming another
  article of the same library within a few lines: 19 in 20 are then right, and about two in
  five of the matches are held back.
- **Steps**: 1. the rule and its measure (`tools/librarian-xref.mjs`, over matches read by hand);
  2. "Mentioned here": asked while you read, he lists the articles of other libraries that the
  open pages name, each a *Take me there* that brings the article into your hands, with Back
  bringing your book back at your page (built, on a screen); 3. "Also in the library", for the book in hand: its
  author's article, its own, the same work in another library and the author's other books
  (nothing in the demo set: it shows with bigger collections); 4. in VR and aloud (built: his
  button by the book's toolbar, his panel beside the pages, his voice; the titles in a worker).
- **Later**: looser connections with experiment 2's model, which could also tell one sense from
  another where the rule holds a match back.

### 4. Voice in VR

VR has no keyboard, so speaking is the natural way in: hold a controller button
(`xr/controls.js` `button` events), speak, hear the answer. The first step is a measurement:
whether Quest Browser supports the browser's speech recognition (`SpeechRecognition`) at all. If
not, the options are speech recognition on the server, or a small Whisper model in the browser
(heavy).

### 5. A model on the device

A probe of whether a small language model runs in the browser over WebGPU, on the desktop and on
the Quest: tokens per second, memory, and whether the room still holds 72 Hz (measured with
`tools/quest-perf.mjs`). Nothing would leave the device, but the Quest probably cannot do both at
once. This tells us whether that route is open at all.

## Where to start

1, then 2. Experiment 1 settles the figure, the panel and walking you to the book; experiment 2
then plugs a model into the same desk, and its citation rule is what makes it the Librarian rather
than a chatbot.

Decided for experiment 2: a local model, through Ollama (gemma4:12b by default).

## Ground rules

These follow the project's own (CLAUDE.md, TODO.md):

- **Optional.** The library works exactly as now without the librarian; no model, server or
  network service is ever required to open and read a book.
- **No telemetry.** The page reports nothing about its visitors. A question goes to a model only
  when someone asks one, opted in, and nothing is logged beyond that.
- **The Quest is the target.** The figure and its panel stay within the draw-call budget, per-frame
  code allocates nothing, and nothing heavy runs in one frame.
- **English to start.** English is the starting focus: the Librarian reads questions as English
  (`ask.js`), answers in English and speaks with an English voice. Other languages will be tested,
  and enabled as they become available.
