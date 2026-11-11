// @ts-check
// The module worker that keeps the libraries' titles and tries a page's words against them
// (xref-engine.js; titles.js starts it the first time someone asks what a page mentions, and
// never before). It gets the lists of titles itself, so neither their parsing nor their keeping
// runs on the page's thread, and their memory is its own.
//
// Messages in: { id, method, args }, a method of the engine's (METHODS). Out: { ready: true } once
// loaded, then { id, value } or { id, error }.
// A module worker has no import map: it and what it imports name relative modules only.

import { XrefEngine } from './xref-engine.js';

/** The engine's calls a message may make. */
const METHODS = new Set(['list', 'volume', 'put', 'build', 'keep', 'look']);

const engine = new XrefEngine();
const scope = /** @type {{ postMessage(message: unknown): void, onmessage: ((e: { data: any }) => void) | null }} */ (/** @type {unknown} */ (self));

scope.onmessage = async ({ data }) => {
  const { id, method, args } = data ?? {};
  try {
    if (!METHODS.has(method)) throw new Error(`no such call: ${method}`);
    const value = await /** @type {any} */ (engine)[method](...(Array.isArray(args) ? args : []));
    scope.postMessage({ id, value });
  } catch (err) {
    scope.postMessage({ id, error: String(/** @type {Error} */ (err)?.message ?? err) });
  }
};
scope.postMessage({ ready: true });
