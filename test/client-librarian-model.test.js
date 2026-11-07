// The Librarian's model as the page reaches it (public/js/librarian/model.js, SPEC §4, §5.10;
// docs/LIBRARIAN.md, experiment 2): which model the server has, a turn sent and its reply, the
// warm-up at most every ten minutes, over a stand-in for the server.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ASK_AGAIN_AFTER, ServerModel, WARM_EVERY } from '../public/js/librarian/model.js';

/** A stand-in for the site's server: `answer(path, init)` gives { status?, body } or an Error to throw; every request is kept. */
function server(answer) {
  const requests = [];
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    requests.push({ path: u.pathname, method: init.method ?? 'GET', cache: init.cache, headers: init.headers, signal: init.signal, body: init.body ? JSON.parse(init.body) : null });
    const r = answer(u.pathname, init);
    if (r instanceof Error) throw r;
    return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  };
  return { fetch, requests };
}

/** Runs `fn` with console.warn kept quiet (a failed warm-up is warned of). */
async function quietly(fn) {
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
}

describe('the librarian: the server\'s model (model.js)', () => {
  it('asks the server which model answers, and finds none where it has none or cannot be reached', async () => {
    let answer = { body: { model: 'gemma4:12b', ready: true } };
    const s = server(() => answer);
    const m = new ServerModel({ fetch: s.fetch, root: 'http://site.test/librarian/' });
    assert.deepEqual(await m.info(), { model: 'gemma4:12b', ready: true });
    assert.deepEqual([s.requests[0].path, s.requests[0].method, s.requests[0].cache], ['/librarian/api/librarian', 'GET', 'no-store']);
    answer = { body: { model: 'gemma4:12b', ready: false, error: 'Ollama cannot be reached' } };
    assert.deepEqual(await m.info(), { model: 'gemma4:12b', ready: false, error: 'Ollama cannot be reached' });
    answer = { body: { model: null, ready: false } }; // a server without --ollama
    assert.equal(await m.info(), null);
    answer = { status: 404, body: { error: 'unknown API endpoint' } };
    assert.equal(await m.info(), null);
    answer = new TypeError('fetch failed');
    assert.equal(await m.info(), null);
  });

  it('sends a turn as JSON, stoppable, and gives the reply or says what failed', async () => {
    let answer = { body: { message: { role: 'assistant', content: 'Emma is by Jane Austen [B1].' }, done: 'stop', timings: { load: 0, prompt: 0.1, reply: 0.2, tokens: 9 } } };
    const s = server(() => answer);
    const m = new ServerModel({ fetch: s.fetch, root: 'http://site.test/' });
    const stop = new AbortController();
    const messages = [{ role: 'user', content: 'Who wrote Emma?' }];
    const tools = [{ type: 'function', function: { name: 'read' } }];
    const reply = await m.chat(messages, tools, { signal: stop.signal });
    assert.equal(reply.message.content, 'Emma is by Jane Austen [B1].');
    const r = s.requests[0];
    assert.deepEqual([r.path, r.method, r.headers['content-type'], r.signal], ['/api/librarian/chat', 'POST', 'application/json', stop.signal]);
    assert.deepEqual(r.body, { messages, tools });
    answer = { status: 502, body: { error: 'Ollama answered 500: out of memory' } };
    await assert.rejects(m.chat(messages, tools), /could not answer \(502: Ollama answered 500: out of memory\)/);
    answer = { status: 500, body: '<html>' };
    await assert.rejects(m.chat(messages, tools), /could not answer \(500\)/);
    answer = { body: '<html>' };
    await assert.rejects(m.chat(messages, tools), /not understood/);
  });

  it('warms the model at most every ten minutes, and soon again after a failure', async () => {
    let now = 1000;
    let fail = false;
    const s = server(() => (fail ? { status: 503, body: { error: 'the model cannot answer now' } } : { body: { message: { role: 'assistant', content: '' } } }));
    const m = new ServerModel({ fetch: s.fetch, root: 'http://site.test/', now: () => now });
    const turn = { messages: [{ role: 'system', content: 'You are the Librarian.' }], tools: [] };
    assert.equal(await m.warm(turn), true);
    assert.deepEqual(s.requests[0].body, { ...turn, warm: true });
    now += WARM_EVERY - 1;
    assert.equal(await m.warm(turn), false, 'too soon');
    assert.equal(s.requests.length, 1);
    now += 1;
    fail = true;
    assert.equal(await quietly(() => m.warm(turn)), false, 'it went, and failed');
    assert.equal(s.requests.length, 2);
    fail = false;
    assert.equal(await m.warm(turn), true, 'after a failure the next focus tries again');
  });

  it('asks about a model that could not answer again only after a while', async () => {
    let now = 0;
    const m = new ServerModel({ fetch: server(() => ({ body: { model: 'gemma4:12b', ready: false } })).fetch, root: 'http://site.test/', now: () => now });
    assert.equal(m.mayAskAgain, true);
    await m.info();
    assert.equal(m.mayAskAgain, false);
    now += ASK_AGAIN_AFTER;
    assert.equal(m.mayAskAgain, true);
  });
});
