/**
 * The Librarian's model (docs/LIBRARIAN.md, experiment 2; SPEC §4, §5.10), through Ollama:
 * `--ollama <model>` names the one model the page may use, and the page's reading
 * (public/js/librarian/read.js: a question, the library's searches and reading as the model's
 * tools, the citation rule) sends each turn of its conversation here, which forwards it to
 * Ollama's /api/chat with the server's own model and settings, and answers with the model's
 * reply.
 *
 * - Nothing is logged: neither the questions nor the answers. A failure is logged without them.
 * - Only that model, and the request's size is capped (LIMITS); the page's messages and tools are
 *   passed on field by field, nothing else.
 * - Ollama keeps the model loaded for KEEP_ALIVE after each turn; a warm-up (`warm: true`, one
 *   token) loads it and reads the page's instructions and tools before the first question.
 */

/** Ollama's own address on this machine (`--ollama-url` names another). */
export const OLLAMA_URL = 'http://127.0.0.1:11434';
/** How long Ollama keeps the model loaded after a turn. */
export const KEEP_ALIVE = '30m';
/** The most a turn may hold: bytes of JSON, messages, tools, characters of one message, tool calls of one message. */
export const LIMITS = Object.freeze({ bytes: 256 * 1024, messages: 48, tools: 8, text: 24_000, calls: 8 });
/**
 * The model's settings: room for the instructions, the tools and a few pages read (Ollama's own
 * default is 4,096 tokens at 16 GB of video memory), a low temperature, and a reply's length
 * capped (an answer is three sentences; gpt-oss thinks first).
 */
export const OPTIONS = Object.freeze({ num_ctx: 8192, temperature: 0.2, num_predict: 1024 });
/** ms a turn may take: a cold load of a large model, then the reply. */
const TIMEOUT_MS = 180_000;
/** ms a failed look at the model is trusted before Ollama is asked again. */
const RETRY_MS = 10_000;

const ROLES = new Set(['system', 'user', 'assistant', 'tool']);
const NAME = /^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/;

/** A request the page should not have made: answered with `status` and the message. */
export class RequestError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Whether `v` is a plain object (JSON's `{}`). */
const isObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** A string no longer than `max`, else a RequestError. */
function text(v, max, what) {
  if (typeof v !== 'string') throw new RequestError(400, `${what} must be a string`);
  if (v.length > max) throw new RequestError(413, `${what} is longer than ${max} characters`);
  return v;
}

/**
 * A turn as the page sends it, checked and copied field by field: `messages` (system, user,
 * assistant with its tool calls, tool with its name), `tools` (functions) and `warm`.
 * @param {unknown} body the request's JSON
 * @returns {{ messages: object[], tools: object[], warm: boolean }}
 * @throws {RequestError}
 */
export function checkTurn(body) {
  if (!isObject(body)) throw new RequestError(400, 'the request must be a JSON object');
  const { messages, tools = [], warm = false } = /** @type {any} */ (body);
  if (!Array.isArray(messages) || !messages.length) throw new RequestError(400, 'messages must be a list of at least one message');
  if (messages.length > LIMITS.messages) throw new RequestError(413, `at most ${LIMITS.messages} messages`);
  if (!Array.isArray(tools)) throw new RequestError(400, 'tools must be a list');
  if (tools.length > LIMITS.tools) throw new RequestError(413, `at most ${LIMITS.tools} tools`);
  if (typeof warm !== 'boolean') throw new RequestError(400, 'warm must be true or false');
  const out = messages.map((m, i) => {
    if (!isObject(m) || !ROLES.has(m.role)) throw new RequestError(400, `message ${i}: role must be system, user, assistant or tool`);
    const copy = { role: m.role, content: text(m.content ?? '', LIMITS.text, `message ${i}'s content`) };
    if (m.role === 'assistant' && m.tool_calls !== undefined) {
      if (!Array.isArray(m.tool_calls) || m.tool_calls.length > LIMITS.calls) throw new RequestError(400, `message ${i}: tool_calls must be a list of at most ${LIMITS.calls}`);
      copy.tool_calls = m.tool_calls.map((c, j) => {
        const fn = isObject(c) ? c.function : null;
        if (!isObject(fn) || typeof fn.name !== 'string' || !NAME.test(fn.name)) throw new RequestError(400, `message ${i}: tool call ${j} needs a function's name`);
        const args = fn.arguments ?? {};
        if (!isObject(args)) throw new RequestError(400, `message ${i}: tool call ${j}'s arguments must be an object`);
        return { function: { name: fn.name, arguments: args } };
      });
    }
    if (m.role === 'tool' && m.tool_name !== undefined) {
      if (typeof m.tool_name !== 'string' || !NAME.test(m.tool_name)) throw new RequestError(400, `message ${i}: tool_name must be a tool's name`);
      copy.tool_name = m.tool_name;
    }
    return copy;
  });
  const fns = tools.map((t, i) => {
    const fn = isObject(t) ? t.function : null;
    if (!isObject(t) || t.type !== 'function' || !isObject(fn) || typeof fn.name !== 'string' || !NAME.test(fn.name)) {
      throw new RequestError(400, `tool ${i} must be { type: 'function', function: { name, description, parameters } }`);
    }
    return {
      type: 'function',
      function: {
        name: fn.name,
        description: text(fn.description ?? '', 2000, `tool ${i}'s description`),
        parameters: isObject(fn.parameters) ? fn.parameters : { type: 'object', properties: {} },
      },
    };
  });
  return { messages: out, tools: fns, warm };
}

/**
 * Whether and how the model thinks before it answers: not at all where it can be told so; gpt-oss
 * always thinks, as little as it can. Undefined for a model that does not think (Ollama refuses
 * `think` for those).
 * @param {{ capabilities?: string[], details?: { family?: string } }} shown Ollama's /api/show
 * @returns {false | 'low' | undefined}
 */
export function thinkFor(shown) {
  if (!shown.capabilities?.includes('thinking')) return undefined;
  return /^gpt-?oss/i.test(shown.details?.family ?? '') ? 'low' : false;
}

/** The model through Ollama, for the server's routes (http.js) and tools/librarian-eval.mjs. */
export class LibrarianModel {
  /**
   * @param {object} o
   * @param {string} o.model the model's name in Ollama ("gemma4:12b")
   * @param {string} [o.url] Ollama's address
   * @param {typeof fetch} [o.fetch]
   * @param {number} [o.timeoutMs] how long a turn may take
   */
  constructor({ model, url = OLLAMA_URL, fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS }) {
    this.model = model;
    this.url = url.endsWith('/') ? url : `${url}/`;
    this._fetch = fetch;
    this._timeoutMs = timeoutMs;
    /** @type {Promise<{ ok: boolean, error?: string, tools?: boolean, think?: false | 'low' }> | null} */
    this._probe = null;
    this._probedAt = 0;
    /** Whether Ollama has answered the probe (it is then trusted: a later failure shows in the turn). */
    this._probeOk = false;
  }

  /** POSTs JSON to Ollama; its JSON answer, or an Error saying what went wrong (no question in it). */
  async _post(path, body, timeoutMs) {
    let res;
    try {
      res = await this._fetch(new URL(path, this.url), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const timedOut = err?.name === 'TimeoutError' || err?.name === 'AbortError';
      throw new RequestError(timedOut ? 504 : 502, timedOut ? `the model took longer than ${Math.round(timeoutMs / 1000)} s` : `Ollama cannot be reached at ${this.url}`);
    }
    const answer = await res.text();
    if (!res.ok) {
      let error = answer.slice(0, 200);
      try { error = JSON.parse(answer).error ?? error; } catch { /* not JSON */ }
      if (res.status === 404) throw new RequestError(502, `Ollama has no model ${this.model} (ollama pull ${this.model})`);
      throw new RequestError(502, `Ollama answered ${res.status}: ${error}`);
    }
    return JSON.parse(answer);
  }

  /**
   * What the model can do, from Ollama's /api/show (which loads nothing): whether it calls tools,
   * how it thinks. Asked once; a failure again after RETRY_MS.
   */
  probe() {
    if (this._probe && (Date.now() - this._probedAt < RETRY_MS || this._probeOk)) return this._probe;
    this._probedAt = Date.now();
    this._probe = this._post('api/show', { model: this.model }, 10_000).then((shown) => {
      const tools = !!shown.capabilities?.includes('tools');
      this._probeOk = true;
      return tools
        ? { ok: true, tools, think: thinkFor(shown) }
        : { ok: false, tools, error: `the model ${this.model} cannot call tools` };
    }, (err) => ({ ok: false, error: err.message }));
    return this._probe;
  }

  /** The page's GET api/librarian: the model, and whether it can answer now. */
  async info() {
    const p = await this.probe();
    return { model: this.model, ready: p.ok, ...(p.ok ? {} : { error: p.error }) };
  }

  /**
   * One turn of a conversation (checkTurn's), sent with the server's model and settings: the
   * model's reply ({ role, content, tool_calls? }) and how long it took (s) and how many tokens.
   * A warm-up asks for one token.
   * @param {unknown} body
   */
  async chat(body) {
    const { messages, tools, warm } = checkTurn(body);
    const p = await this.probe();
    if (!p.ok) throw new RequestError(503, p.error ?? 'the model cannot answer now');
    const reply = await this._post('api/chat', {
      model: this.model,
      messages,
      ...(tools.length ? { tools } : {}),
      stream: false,
      keep_alive: KEEP_ALIVE,
      ...(p.think !== undefined ? { think: p.think } : {}),
      options: warm ? { ...OPTIONS, num_predict: 1 } : OPTIONS,
    }, this._timeoutMs);
    const m = reply.message ?? {};
    const calls = Array.isArray(m.tool_calls) ? m.tool_calls.filter((c) => typeof c?.function?.name === 'string')
      .map((c) => ({ function: { name: c.function.name, arguments: isObject(c.function.arguments) ? c.function.arguments : parseArgs(c.function.arguments) } })) : [];
    const s = (ns) => Math.round((ns ?? 0) / 1e6) / 1000;
    return {
      message: { role: 'assistant', content: typeof m.content === 'string' ? m.content : '', ...(calls.length ? { tool_calls: calls } : {}) },
      done: reply.done_reason ?? null,
      timings: {
        load: s(reply.load_duration), prompt: s(reply.prompt_eval_duration), reply: s(reply.eval_duration),
        promptTokens: reply.prompt_eval_count ?? 0, tokens: reply.eval_count ?? 0,
      },
    };
  }
}

/** Tool arguments given as JSON text (some models), as an object; {} when they are not. */
function parseArgs(v) {
  if (typeof v !== 'string') return {};
  try {
    const o = JSON.parse(v);
    return isObject(o) ? o : {};
  } catch {
    return {};
  }
}
