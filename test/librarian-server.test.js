// The Librarian's model on the server (server/librarian.js, SPEC §4; docs/LIBRARIAN.md, experiment
// 2): a turn checked and copied field by field, forwarded to Ollama (faked here) with the server's
// own model and settings, the routes under /api/librarian (createApp), and the CLI's --ollama.

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, it } from 'node:test';
import { createApp } from '../server/http.js';
import { parseCliArgs } from '../server/index.js';
import { checkTurn, KEEP_ALIVE, LibrarianModel, LIMITS, OPTIONS, RequestError, thinkFor } from '../server/librarian.js';

const SYSTEM = { role: 'system', content: 'You are the Librarian.' };
const USER = { role: 'user', content: 'Who wrote Emma?' };
const TOOL = { type: 'function', function: { name: 'search_books', description: 'Find books.', parameters: { type: 'object', properties: { query: { type: 'string' } } } } };

/** `p`, or the signal's reason once it aborts (as fetch does). */
const abortable = (p, signal) => new Promise((resolve, reject) => {
  signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
  Promise.resolve(p).then(resolve, reject);
});

/**
 * A stand-in for Ollama: /api/show says what the model can do, /api/chat answers with `reply`
 * (or as `chat` says); every request is kept.
 */
function fakeOllama({ caps = ['completion', 'tools', 'thinking'], family = 'gemma4', reply, chat, show } = {}) {
  const requests = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ path: new URL(url).pathname, body });
    const json = (status, value) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
    if (new URL(url).pathname === '/api/show') return show ? show(body) : json(200, { capabilities: caps, details: { family } });
    if (chat) return abortable(chat(body), init.signal);
    return json(200, reply ?? {
      message: { role: 'assistant', content: 'Emma was written by Jane Austen [B1].', thinking: 'secret' },
      done_reason: 'stop', load_duration: 2.5e9, prompt_eval_duration: 0.2e9, eval_duration: 0.5e9, prompt_eval_count: 300, eval_count: 12,
    });
  };
  return { fetch, requests };
}

describe('a turn as the page sends it (checkTurn)', () => {
  it('copies messages, tool calls and tools field by field, nothing else', () => {
    const turn = checkTurn({
      messages: [
        { ...SYSTEM, extra: 1 },
        USER,
        { role: 'assistant', content: '', tool_calls: [{ id: 'x', function: { name: 'search_books', arguments: { query: 'Emma' }, index: 0 } }] },
        { role: 'tool', tool_name: 'search_books', content: '[B1] Emma, by Jane Austen', images: ['…'] },
      ],
      tools: [{ ...TOOL, extra: true }],
      model: 'someone-elses-model',
      options: { num_ctx: 100000 },
    });
    assert.deepEqual(turn.messages, [
      SYSTEM,
      USER,
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'search_books', arguments: { query: 'Emma' } } }] },
      { role: 'tool', tool_name: 'search_books', content: '[B1] Emma, by Jane Austen' },
    ]);
    assert.deepEqual(turn.tools, [TOOL]);
    assert.equal(turn.warm, false);
    assert.equal(checkTurn({ messages: [USER], warm: true }).warm, true);
  });

  it('refuses what is not a turn, and what is too large', () => {
    const refuses = (body, status, re) => assert.throws(() => checkTurn(body), (e) => e instanceof RequestError && e.status === status && re.test(e.message));
    refuses(null, 400, /JSON object/);
    refuses({ messages: [] }, 400, /at least one/);
    refuses({ messages: [{ role: 'admin', content: 'x' }] }, 400, /role/);
    refuses({ messages: [{ role: 'user', content: 5 }] }, 400, /string/);
    refuses({ messages: [{ role: 'user', content: 'x'.repeat(LIMITS.text + 1) }] }, 413, /longer/);
    refuses({ messages: Array.from({ length: LIMITS.messages + 1 }, () => USER) }, 413, /at most/);
    refuses({ messages: [USER], tools: Array.from({ length: LIMITS.tools + 1 }, () => TOOL) }, 413, /at most/);
    refuses({ messages: [USER], tools: [{ type: 'retrieval' }] }, 400, /function/);
    refuses({ messages: [{ role: 'assistant', content: '', tool_calls: [{ function: { name: 'rm -rf' } }] }] }, 400, /name/);
    refuses({ messages: [{ role: 'assistant', content: '', tool_calls: [{ function: { name: 'read', arguments: 'x' } }] }] }, 400, /object/);
    refuses({ messages: [USER], warm: 'yes' }, 400, /warm/);
  });
});

describe('the model (LibrarianModel)', () => {
  it('thinks as little as it can: not at all, gpt-oss low, a model without thinking not told', () => {
    assert.equal(thinkFor({ capabilities: ['tools', 'thinking'], details: { family: 'gemma4' } }), false);
    assert.equal(thinkFor({ capabilities: ['tools', 'thinking'], details: { family: 'gpt-oss' } }), 'low');
    assert.equal(thinkFor({ capabilities: ['tools'] }), undefined);
  });

  it('forwards a turn with its own model and settings, kept loaded, and answers with the reply alone', async () => {
    const o = fakeOllama();
    const model = new LibrarianModel({ model: 'gemma4:12b', url: 'http://ollama.test:11434', fetch: o.fetch });
    const out = await model.chat({ messages: [SYSTEM, USER], tools: [TOOL] });
    const sent = o.requests.find((r) => r.path === '/api/chat').body;
    assert.deepEqual(sent, {
      model: 'gemma4:12b', messages: [SYSTEM, USER], tools: [TOOL], stream: false, keep_alive: KEEP_ALIVE, think: false, options: OPTIONS,
    });
    assert.deepEqual(out, {
      message: { role: 'assistant', content: 'Emma was written by Jane Austen [B1].' },
      done: 'stop',
      timings: { load: 2.5, prompt: 0.2, reply: 0.5, promptTokens: 300, tokens: 12 },
    });
    // A warm-up asks for one token; Ollama's /api/show is asked once.
    await model.chat({ messages: [SYSTEM, USER], tools: [TOOL], warm: true });
    assert.equal(o.requests.at(-1).body.options.num_predict, 1);
    assert.equal(o.requests.filter((r) => r.path === '/api/show').length, 1);
  });

  it('gives the model\'s tool calls, their arguments as objects', async () => {
    const o = fakeOllama({ reply: { message: { role: 'assistant', content: '', tool_calls: [
      { function: { name: 'search_books', arguments: { query: 'Emma' } } },
      { function: { name: 'read', arguments: '{"id":"B1"}' } },
      { nonsense: true },
    ] } } });
    const out = await new LibrarianModel({ model: 'm', fetch: o.fetch }).chat({ messages: [USER], tools: [TOOL] });
    assert.deepEqual(out.message.tool_calls, [
      { function: { name: 'search_books', arguments: { query: 'Emma' } } },
      { function: { name: 'read', arguments: { id: 'B1' } } },
    ]);
  });

  it('says what failed, never what was asked', async () => {
    const asked = 'Who wrote Emma?';
    const fails = async (o, status, re) => {
      const model = new LibrarianModel({ model: 'gemma4:12b', fetch: o.fetch, timeoutMs: 50 });
      await assert.rejects(model.chat({ messages: [USER] }), (e) => e.status === status && re.test(e.message) && !e.message.includes(asked));
    };
    await fails(fakeOllama({ caps: ['completion'] }), 503, /cannot call tools/);
    await fails(fakeOllama({ chat: () => new Response(JSON.stringify({ error: 'model "gemma4:12b" not found' }), { status: 404 }) }), 502, /no model gemma4:12b.*ollama pull/);
    await fails(fakeOllama({ chat: () => new Response('{"error":"out of memory"}', { status: 500 }) }), 502, /500: out of memory/);
    await fails(fakeOllama({ chat: () => { throw new TypeError('fetch failed'); } }), 502, /cannot be reached/);
    await fails(fakeOllama({ chat: (b) => new Promise(() => {}) }), 504, /longer than/);
    const down = new LibrarianModel({ model: 'm', fetch: async () => { throw new TypeError('fetch failed'); } });
    assert.deepEqual(await down.info(), { model: 'm', ready: false, error: 'Ollama cannot be reached at http://127.0.0.1:11434/' });
  });
});

describe('/api/librarian (createApp)', () => {
  const library = { list: () => [], get: () => null, generation: 0 };
  let ollama;
  let withModel;
  let without;
  const listen = (app) => new Promise((resolve) => {
    const server = http.createServer(app).listen(0, '127.0.0.1', () => resolve(server));
  });
  const url = (server, p) => `http://127.0.0.1:${server.address().port}${p}`;
  before(async () => {
    ollama = fakeOllama();
    const logged = [];
    withModel = await listen(createApp(library, { librarian: new LibrarianModel({ model: 'gemma4:12b', fetch: ollama.fetch }), log: (m) => logged.push(m) }));
    without = await listen(createApp(library, { log: () => {} }));
  });
  after(() => {
    withModel.close();
    without.close();
  });
  const post = (server, body, headers = {}) => fetch(url(server, '/api/librarian/chat'), {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body),
  });

  it('says which model answers, or that there is none', async () => {
    const res = await fetch(url(withModel, '/api/librarian'));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await res.json(), { model: 'gemma4:12b', ready: true });
    const none = await fetch(url(without, '/api/librarian'));
    assert.equal(none.status, 404);
    assert.match((await none.json()).error, /--ollama/);
    assert.equal((await post(without, { messages: [USER] })).status, 404);
  });

  it('answers a turn through Ollama', async () => {
    const res = await post(withModel, { messages: [SYSTEM, USER], tools: [TOOL] });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).message.content, 'Emma was written by Jane Austen [B1].');
    assert.equal(ollama.requests.at(-1).body.model, 'gemma4:12b');
  });

  it('takes JSON from this site\'s own page only, and not too much of it', async () => {
    assert.equal((await post(withModel, { messages: [USER] }, { 'content-type': 'text/plain' })).status, 415);
    assert.equal((await post(withModel, { messages: [USER] }, { 'sec-fetch-site': 'cross-site' })).status, 403);
    assert.equal((await post(withModel, { messages: [USER] }, { 'sec-fetch-site': 'same-origin' })).status, 200);
    assert.equal((await post(withModel, '{not json')).status, 400);
    assert.equal((await post(withModel, { messages: [{ role: 'user', content: 'x'.repeat(LIMITS.bytes) }] })).status, 413);
    assert.equal((await post(withModel, { messages: [{ role: 'admin', content: 'x' }] })).status, 400);
    const get = await fetch(url(withModel, '/api/librarian/chat'));
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    assert.equal((await fetch(url(withModel, '/api/librarian'), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 405);
    assert.equal((await fetch(url(withModel, '/api/librarian/other'))).status, 404);
  });
});

describe('the CLI\'s --ollama', () => {
  it('names a model, and Ollama\'s address with it', () => {
    const d = parseCliArgs([]);
    assert.equal(d.ollama, null);
    assert.equal(d.ollamaUrl, 'http://127.0.0.1:11434');
    const o = parseCliArgs(['--ollama', 'gemma4:12b', '--ollama-url', 'http://ollama.test:11434']);
    assert.equal(o.ollama, 'gemma4:12b');
    assert.equal(o.ollamaUrl, 'http://ollama.test:11434');
    assert.equal(parseCliArgs(['--ollama', 'hf.co/someone/model:Q4_K_M']).ollama, 'hf.co/someone/model:Q4_K_M');
    assert.throws(() => parseCliArgs(['--ollama-url', 'http://x:1']), /needs --ollama/);
    assert.throws(() => parseCliArgs(['--ollama', 'gemma4:12b', '--ollama-url', 'ftp://x']), /--ollama-url/);
    assert.throws(() => parseCliArgs(['--ollama', 'a model; rm']), /--ollama/);
  });
});
