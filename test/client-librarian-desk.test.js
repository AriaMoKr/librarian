// The librarian at the desk (public/js/librarian/desk.js and figure.js, SPEC §5.10): his figure,
// where he stands by the catalogue stand and his collider there, how a pointer finds him, a click on
// a screen against the trigger in a headset, his panel (its keyboard, the question asked through
// the card, the answer and its finds, Take me there), his turning towards a viewer, and his walk to
// a shelf (he ahead, the viewer following; the vignette and the blinks in a headset; skipped at
// once; the cut it was with less motion; his way back to the desk). In Node, on a stand-in for the
// room (interaction.js) and a stub canvas for common's Panel.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import './helpers/vendor.js'; // desk.js's ../../vendor/common/panel.js

globalThis.document ??= /** @type {any} */ ({
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => new Proxy({}, { get: () => () => ({ width: 0 }) }) }),
});
const { bookOf, Desk } = await import('../public/js/librarian/desk.js');
const { Figure, FIGURE, figureGeometry, rayUpright } = await import('../public/js/librarian/figure.js');
const { VIGNETTE } = await import('../public/vendor/common/access.js');

/** Lets promises settle (the walk's start and end, the fades). */
const flush = () => new Promise((r) => setImmediate(r));

/** A bookcase's footprint and the spot before it (shelves.js footprints, locate: 1.3 m before its front, facing it). */
const bookcase = (x, z, yaw) => ({ position: { x, z }, yaw, halfW: 0.65, halfD: 0.23 });
const spotBefore = (b) => ({ position: new THREE.Vector3(b.position.x + 1.5 * Math.sin(b.yaw), 0, b.position.z + 1.5 * Math.cos(b.yaw)), yaw: b.yaw });

/**
 * A stand-in for the room: by default a rotunda's spawn point and stand (world.js _layoutRotunda,
 * R 3.8) with eight bookcases round its far wall; `hall`: a long hall (_layoutHall) with a row of
 * them at its far end. Its controls are an EventTarget (select) with a rig holding the camera.
 */
function room({ presenting = false, hall = false, furniture = [], speech = undefined } = {}) {
  const spawn = hall ? new THREE.Vector3(0, 0, 3.1) : new THREE.Vector3(0, 0, 1.33);
  const kp = hall ? new THREE.Vector3(1.3, 0, 1.9) : new THREE.Vector3(1.368, 0, -0.07);
  const R = 3.8;
  /** @type {any[]} */
  const cases = [];
  if (hall) {
    for (let k = 0; k < 5; k++) cases.push(bookcase(-2.48 + k * 1.24, -24.8, 0));
  } else {
    const da = 1.24 / 3.56;
    for (let i = 0; i < 8; i++) {
      const a = (i - 3.5) * da;
      cases.push(bookcase(Math.sin(a) * 3.56, -Math.cos(a) * 3.56, -a));
    }
  }
  const margin = 0.35;
  const world = {
    room: hall
      ? { kind: 'hall', bounds: { minX: -6, maxX: 6, minZ: -28, maxZ: 4.5 }, colliders: [...furniture], walkable: (x, z) => Math.abs(x) < 6 - margin && z > -28 + margin && z < 4.5 - margin }
      : { kind: 'rotunda', R, colliders: [...furniture], walkable: (x, z) => Math.hypot(x, z) < R - 0.45 },
    spawn: { position: spawn, yaw: 0 },
    kiosk: { position: kp, yaw: Math.atan2(spawn.x - kp.x, spawn.z - kp.z) },
    /** A book is on the bookcase its `onCase` names. */
    shelves: { locate: (book) => (book.onCase == null ? null : spotBefore(cases[book.onCase])), footprints: () => cases },
  };
  const scene = new THREE.Scene();
  const rig = new THREE.Group();
  const camera = new THREE.PerspectiveCamera();
  rig.add(camera);
  scene.add(rig);
  const panels = [];
  const targets = [];
  const frames = [];
  const log = [];
  const controls = Object.assign(new EventTarget(), {
    presenting, rig, yaw: 0, pitch: 0.3, locomotionEnabled: true, lookEnabled: true,
    vignette: { enabled: true, values: [], set(v) { this.values.push(v); } },
    viewerPosition: (out) => camera.getWorldPosition(out).setY(rig.position.y),
  });
  const ia = {
    scene, world, camera, controls, reduced: false, state: 'browse', booksByLib: {},
    addPanel: (p) => panels.push(p), addTarget: (t) => targets.push(t), onFrame: (fn) => frames.push(fn),
    ensureShelved: async (book) => book.onCase != null,
    putBack: async () => { ia.state = 'browse'; },
    _fadeTo: async (target, duration) => { log.push(['fade', target, duration]); },
  };
  /** The viewer's eyes at (x, z): the rig there, the camera in it. */
  const eyesAt = (x, z, y = 1.6) => {
    rig.position.set(x, 0, z);
    camera.position.set(0, y, 0);
    rig.updateMatrixWorld(true);
  };
  eyesAt(spawn.x, spawn.z);
  const asked = [];
  const card = {
    input: { value: '' }, answer: null, onLooking: null, onAnswer: null,
    askNow(q) { asked.push(q); },
  };
  const calls = { box: 0, taken: [] };
  const desk = new Desk({
    interaction: ia, card, multi: () => false, intoBox: () => { calls.box++; },
    take: (find) => {
      calls.taken.push(find);
      log.push(['take', find.book.title]);
    },
    onWalk: (on) => log.push(['walk', on]),
    speech,
  });
  const frame = (dt = 1 / 72, n = 1) => {
    for (let i = 0; i < n; i++) for (const fn of frames) fn(dt);
  };
  /** A find of a book on bookcase `i`, and where the viewer will stand for it. */
  const findOn = (i, title = `Book ${i}`) => ({ kind: 'book', book: { id: String(i), title, onCase: i }, lib: { id: 'pg', title: 'Gutenberg' } });
  const viewer = () => controls.viewerPosition(new THREE.Vector3());
  return { ia, world, cases, camera, rig, controls, eyesAt, panels, targets, frame, card, asked, calls, desk, log, findOn, viewer };
}

/** A ray from `from` towards `to`. */
const rayFrom = (from, to) => new THREE.Ray(from.clone(), to.clone().sub(from).normalize());

describe('the librarian: his figure', () => {
  it('is one geometry with a colour per vertex, his height, standing on the floor and facing +Z', () => {
    const geo = figureGeometry();
    for (const name of ['position', 'normal', 'color']) assert.ok(geo.getAttribute(name), name);
    geo.computeBoundingBox();
    const b = geo.boundingBox;
    assert.ok(Math.abs(b.min.y) < 0.005, `feet at ${b.min.y}`);
    assert.ok(b.max.y > 1.78 && b.max.y < 1.83, `height ${b.max.y}`);
    assert.ok(b.max.z > 0.14 && b.min.z > -0.2, `front ${b.max.z}, back ${b.min.z}: facing +Z`);
    assert.ok(Math.max(-b.min.x, b.max.x) <= FIGURE.hitRadius, `within what a pointer finds: ${b.min.x}..${b.max.x}`);
    assert.ok(b.max.y <= FIGURE.hitHeight);
    const figure = new Figure();
    assert.equal(figure.mesh.material, figure.material, 'one material: one draw call');
    assert.equal(figure.material.vertexColors, true);
    figure.setHover(true);
    assert.notEqual(figure.material.emissive.getHex(), 0);
    figure.setHover(false);
    assert.equal(figure.material.emissive.getHex(), 0);
  });

  it('is found along a ray through his side or onto his top, not from inside nor when the ray misses', () => {
    const eye = new THREE.Vector3(0, 1.6, 3);
    assert.ok(Math.abs(rayUpright(rayFrom(eye, new THREE.Vector3(0, 1.2, 0)), 0, 0, 0.3, 1.86) - (eye.distanceTo(new THREE.Vector3(0, 1.2, 0)) - 0.3 * 1.0)) < 0.02);
    assert.equal(rayUpright(rayFrom(eye, new THREE.Vector3(2, 1.2, 0)), 0, 0, 0.3, 1.86), Infinity, 'beside him');
    assert.equal(rayUpright(rayFrom(eye, new THREE.Vector3(0, 1.6, 6)), 0, 0, 0.3, 1.86), Infinity, 'away from him');
    assert.equal(rayUpright(rayFrom(eye, new THREE.Vector3(0, 2.5, 0)), 0, 0, 0.3, 1.86), Infinity, 'over his head');
    const above = new THREE.Vector3(0.1, 3, 0);
    assert.ok(Math.abs(rayUpright(rayFrom(above, new THREE.Vector3(0.1, 0, 0)), 0, 0, 0.3, 1.86) - (3 - 1.86)) < 1e-9, 'onto his top');
    assert.equal(rayUpright(rayFrom(new THREE.Vector3(0, 1, 0), new THREE.Vector3(5, 1, 0)), 0, 0, 0.3, 1.86), Infinity, 'from inside');
  });
});

describe('the librarian: at the desk', () => {
  it('stands beside the stand, on its left as seen from in front of it, facing the spawn point', () => {
    const { desk, world } = room();
    const k = world.kiosk;
    assert.ok(Math.abs(Math.hypot(desk.x - k.position.x, desk.z - k.position.z) - 0.95) < 1e-9);
    // Seen from the spawn point looking at the stand, he is to its left.
    const sp = world.spawn.position;
    const dx = k.position.x - sp.x;
    const dz = k.position.z - sp.z;
    const right = (desk.x - sp.x) * -dz + (desk.z - sp.z) * dx; // along the viewer's right (−dz, dx)
    assert.ok(right < (k.position.x - sp.x) * -dz + (k.position.z - sp.z) * dx, 'left of the stand');
    assert.ok(Math.abs(desk.home - Math.atan2(sp.x - desk.x, sp.z - desk.z)) < 1e-9, 'facing the spawn point');
    assert.equal(desk.figure.mesh.position.x, desk.x);
    assert.equal(desk.figure.mesh.rotation.y, desk.home);
    assert.ok(Math.hypot(desk.x - sp.x, desk.z - sp.z) > 1.5, 'clear of where you arrive');
  });

  it('is a collider of the room while shown, and moves with the stand when the room is built again', () => {
    const { desk, world, frame } = room();
    const mine = () => world.room.colliders.filter((c) => c.r === FIGURE.radius && c.x === desk.x && c.z === desk.z);
    assert.equal(mine().length, 1);
    assert.equal(mine()[0].h, FIGURE.height);
    desk.setShown(false);
    assert.equal(world.room.colliders.length, 0);
    assert.equal(desk.figure.mesh.visible, false);
    desk.setShown(true);
    desk.setShown(true);
    assert.equal(mine().length, 1, 'once');
    // A hall (world.js _layoutHall): a new room, the stand elsewhere.
    const before = { x: desk.x, z: desk.z };
    world.room = { colliders: [] };
    world.spawn.position.set(0, 0, 3.1);
    world.kiosk.position.set(1.3, 0, 1.9);
    world.kiosk.yaw = Math.atan2(0 - 1.3, 3.1 - 1.9);
    frame();
    assert.notDeepEqual({ x: desk.x, z: desk.z }, before);
    assert.equal(mine().length, 1, 'in the new room');
    assert.ok(Math.abs(Math.hypot(desk.x - 1.3, desk.z - 1.9) - 0.95) < 1e-9);
  });

  it('is pointed at by his cylinder while shown, and chosen: the card on a screen, his panel in a headset', () => {
    const { desk, targets, panels, ia, calls, camera } = room();
    assert.equal(targets.length, 1);
    assert.deepEqual(panels, [desk.panel]);
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const ray = rayFrom(eye, new THREE.Vector3(desk.x, 1.2, desk.z));
    const d = targets[0].hit(ray, 100);
    assert.ok(d > 0 && d < eye.distanceTo(new THREE.Vector3(desk.x, 1.2, desk.z)));
    // Before his collider (the room's laser stop), so he is what the pointer is on.
    assert.ok(d < rayUpright(ray, desk.x, desk.z, FIGURE.radius, FIGURE.height));
    desk.setShown(false);
    assert.equal(targets[0].hit(ray, 100), Infinity);
    desk.setShown(true);
    targets[0].select();
    assert.equal(calls.box, 1, 'a screen: into the card\'s box');
    assert.equal(desk.panel.visible, false);
    ia.controls.presenting = true;
    targets[0].select();
    assert.equal(desk.panel.visible, true, 'a headset: his panel');
    targets[0].select();
    assert.equal(desk.panel.visible, false, 'chosen again: it closes');
    assert.equal(calls.box, 1);
    targets[0].hover(true);
    assert.notEqual(desk.figure.material.emissive.getHex(), 0, 'lit while pointed at');
    targets[0].hover(false);
  });

  it('opens his panel in front of the viewer, beside him and away from the stand, turned to them', () => {
    const { desk, eyesAt, camera, world } = room({ presenting: true });
    eyesAt(0.2, 0.9);
    desk.open();
    const m = desk.panel.mesh;
    const eye = camera.getWorldPosition(new THREE.Vector3());
    assert.ok(Math.abs(Math.hypot(m.position.x - eye.x, m.position.z - eye.z) - 0.95) < 1e-9, 'at arm\'s length');
    // Off the line to him, on the other side from the stand.
    const dx = desk.x - eye.x;
    const dz = desk.z - eye.z;
    const side = (p) => (p.z - eye.z) * dx - (p.x - eye.x) * dz; // > 0: on the viewer's right
    assert.ok(Math.sign(side(m.position)) === -Math.sign(side(world.kiosk.position)));
    // Facing the eyes: its front (+Z) towards them.
    const front = new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion);
    const toEye = eye.clone().sub(m.position).setY(0).normalize();
    assert.ok(front.setY(0).normalize().dot(toEye) > 0.99);
  });

  it('asks from his panel through the card, says the answer and lists its finds, each a way there', async () => {
    const { desk, card, asked, calls } = room({ presenting: true });
    card.input.value = 'emma';
    desk.open();
    const p = desk.panel;
    assert.equal(p.get('q').text, 'emma|');
    const key = (label) => p.elements.find((e) => e.type === 'button' && e.label === label);
    const press = (el) => p.click((el.x + el.w / 2) / p.w, 1 - (el.y + el.h / 2) / p.h);
    press(key('X'));
    assert.equal(desk.q, 'emmax');
    press(key('⌫'));
    press(key('Space'));
    press(key('Space'));
    assert.equal(desk.q, 'emma ', 'one space at a time');
    press(key('Clear'));
    assert.equal(desk.q, '');
    assert.equal(p.get('q').text, '| A title, an author or a subject');
    assert.equal(p.get('ask').active, false);
    press(key('Ask'));
    assert.deepEqual(asked, [], 'nothing to ask');
    for (const ch of 'emma') press(key(ch.toUpperCase()));
    assert.equal(p.get('ask').active, true);
    press(key('Ask'));
    assert.deepEqual(asked, ['emma']);
    assert.equal(card.input.value, 'emma', 'the card asks it, and shows it too');
    card.onLooking();
    assert.equal(p.get('answer').text, 'Looking…');
    assert.equal(p.get('finds'), undefined);
    const emma = { kind: 'book', book: { id: '3', title: 'Emma', author: 'Jane Austen' }, lib: { id: 'pg', title: 'Gutenberg' } };
    card.answer = { text: 'I have Emma, by Jane Austen.', finds: [emma], search: null };
    card.onAnswer(card.answer);
    assert.equal(p.get('answer').text, 'I have Emma, by Jane Austen.');
    const items = p.get('finds').items;
    assert.equal(items.length, 1);
    assert.deepEqual({ label: items[0].label, sub: items[0].sub, right: items[0].right }, { label: 'Emma', sub: 'Jane Austen', right: 'Take me there' });
    items[0].onClick();
    assert.equal(p.visible, false, 'the panel goes as he takes you there');
    await flush();
    assert.deepEqual(calls.taken, [emma], 'not on a shelf here: taken without a walk');
    // Opened again: the conversation where it was.
    desk.open();
    assert.equal(p.get('answer').text, 'I have Emma, by Jane Austen.');
    assert.deepEqual(desk.uiState(), { panel: true });
    p.click(...[(p.get('close').x + 30) / p.w, 1 - (p.get('close').y + 28) / p.h]);
    assert.equal(p.visible, false);
    assert.deepEqual(desk.uiState(), {});
  });

  it('shows a reading on his panel: what he does meanwhile, then his sentences and their sources by number', () => {
    const { desk, card } = room({ presenting: true });
    desk.open();
    const p = desk.panel;
    card.onLooking();
    card.onStep('Reading Emma…');
    assert.equal(p.get('answer').text, 'Reading Emma…');
    card.onStep('');
    assert.equal(p.get('answer').text, 'Looking…');
    const read = { kind: 'passage', lib: { id: 'pg', title: 'Gutenberg' }, bookId: '3', at: { c: 0, b: 2 }, title: 'Emma', section: 'Chapter I', text: 'Emma Woodhouse, handsome, clever, and rich.', author: 'Jane Austen', cover: null };
    const emma = { kind: 'book', book: { id: '3', title: 'Emma', author: 'Jane Austen' }, lib: { id: 'pg', title: 'Gutenberg' } };
    card.answer = {
      text: 'Emma was handsome, clever, and rich. Jane Austen wrote it.', finds: [read, emma], search: null,
      statements: [{ text: 'Emma was handsome, clever, and rich.', cites: [1] }, { text: 'Jane Austen wrote it.', cites: [2] }],
    };
    card.onAnswer(card.answer);
    assert.equal(p.get('answer').text, 'Emma was handsome, clever, and rich. [1] Jane Austen wrote it. [2]');
    assert.deepEqual(p.get('finds').items.map((i) => [i.label, i.sub]), [['1. Emma', 'Chapter I · Jane Austen'], ['2. Emma', 'Jane Austen']]);
    card.onStep('Reading Emma…');
    assert.equal(p.get('answer').text, 'Emma was handsome, clever, and rich. [1] Jane Austen wrote it. [2]', 'a step only while looking');
  });

  it('says his answers once chosen, stops at a new question or hidden, and his panel\'s Voice button chooses it', () => {
    const said = [];
    let on = false;
    let available = true;
    const speech = {
      available: () => available,
      on: () => on && available,
      set: (v) => {
        on = v;
        said.push(['set', v]);
        r.desk.refresh(); // as librarian.js does
      },
      say: (text) => said.push(['say', text]),
      stop: () => said.push(['stop']),
    };
    const r = room({ presenting: true, speech });
    const { desk, card } = r;
    const answer = { text: 'I have Emma, by Jane Austen.', finds: [], search: null };
    card.onLooking();
    card.onAnswer(answer);
    assert.deepEqual(said, [['stop']], 'not chosen: not said');
    on = true;
    said.length = 0;
    card.onLooking();
    card.onAnswer(answer);
    assert.deepEqual(said, [['stop'], ['say', 'I have Emma, by Jane Austen.']], 'a new question stops the last answer');
    said.length = 0;
    card.onAnswer(null);
    assert.deepEqual(said, [['stop']], 'the answer taken away');
    said.length = 0;
    desk.setShown(false);
    card.onAnswer(answer);
    assert.deepEqual(said, [['stop']], 'hidden: stopped, and nothing said');
    desk.setShown(true);
    // His panel's Voice button, beside ✕.
    desk.open();
    const p = desk.panel;
    const button = () => p.get('voice');
    const press = (el) => p.click((el.x + el.w / 2) / p.w, 1 - (el.y + el.h / 2) / p.h);
    const state = () => ({ label: button().label, active: !!button().active, disabled: !!button().disabled });
    assert.deepEqual(state(), { label: 'Voice: on', active: true, disabled: false });
    assert.ok(button().x > p.get('q').x + 300 && button().x + button().w < p.get('close').x, 'between the title and ✕');
    said.length = 0;
    press(button());
    assert.deepEqual(said, [['set', false]]);
    assert.deepEqual(state(), { label: 'Voice: off', active: false, disabled: false });
    press(button());
    assert.deepEqual(state(), { label: 'Voice: on', active: true, disabled: false });
    available = false;
    desk.refresh();
    assert.deepEqual(state(), { label: 'No voice', active: false, disabled: true });
    said.length = 0;
    press(button());
    assert.deepEqual(said, [], 'no voice: nothing to choose');
  });

  it('turns towards a viewer nearby, eased and at most so far round, and stands still with less motion', () => {
    const { desk, eyesAt, frame, ia } = room();
    // To his side, near.
    const side = desk.home + Math.PI / 3;
    eyesAt(desk.x + 2 * Math.sin(side), desk.z + 2 * Math.cos(side));
    frame(1 / 72);
    assert.ok(desk.yaw > desk.home && desk.yaw - desk.home < 0.05, 'a little at a time');
    frame(1 / 72, 200);
    assert.ok(Math.abs(desk.yaw - side) < 1e-6, 'facing them');
    // Behind him: back to where he faces at rest, not round to them.
    const behind = desk.home + Math.PI * 0.9;
    eyesAt(desk.x + 2 * Math.sin(behind), desk.z + 2 * Math.cos(behind));
    frame(1 / 72, 200);
    assert.ok(Math.abs(desk.yaw - desk.home) < 1e-6);
    // Far away: at rest too.
    eyesAt(desk.x + 9 * Math.sin(side), desk.z + 9 * Math.cos(side));
    frame(1 / 72, 200);
    assert.ok(Math.abs(desk.yaw - desk.home) < 1e-6);
    // Less motion: never turns.
    ia.reduced = true;
    eyesAt(desk.x + 2 * Math.sin(side), desk.z + 2 * Math.cos(side));
    frame(1 / 72, 50);
    assert.equal(desk.yaw, desk.home);
    assert.equal(desk.figure.mesh.rotation.y, desk.home);
  });
});

/** Frames, the promises let settle after each, while he leads the way (at most `max` s): their count. */
async function walkOut(r, each = () => {}, max = 20) {
  let n = 0;
  while (r.desk.walking && n < max * 72) {
    r.frame();
    n++;
    each(n);
    await flush();
  }
  return n;
}

const flat = (v) => ({ x: v.x, z: v.z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

describe('the librarian: his walk', () => {
  it('knows the book a find is in: the book, an article\'s volume, a passage\'s book', () => {
    const books = { wp: [{ id: 'v1' }], ws: [{ id: 'b2' }] };
    const book = { id: '3' };
    assert.equal(bookOf({ kind: 'book', book, lib: { id: 'pg' } }, books), book);
    assert.equal(bookOf({ kind: 'article', article: { book: 'v1', n: 4 }, lib: { id: 'wp' } }, books), books.wp[0]);
    assert.equal(bookOf({ kind: 'text', hit: { to: { book: 'b2' } }, lib: { id: 'ws' } }, books), books.ws[0]);
    assert.equal(bookOf({ kind: 'article', article: { book: 'v9', n: 0 }, lib: { id: 'wp' } }, books), null);
    // A place he read (experiment 2): its book.
    const read = { kind: 'passage', lib: { id: 'wp' }, bookId: 'v1', at: { c: 4, b: 2 }, title: 'Insulin', section: '', text: 'Insulin is a hormone.' };
    assert.equal(bookOf(read, books), books.wp[0]);
  });

  it('leads the way to the shelf on a screen: he ahead, the view eased along and turned to it, then the book comes out', async () => {
    const r = room();
    const { desk, ia, controls, calls, log } = r;
    const find = r.findOn(3, 'Emma');
    const to = spotBefore(r.cases[3]);
    const start = r.viewer();
    const taking = desk.takeThere(find);
    await flush();
    assert.equal(desk.walking, true);
    assert.equal(ia.state, 'busy', 'nothing else picked or opened meanwhile');
    assert.equal(controls.locomotionEnabled, false);
    assert.equal(controls.lookEnabled, false, 'the walk turns the view');
    assert.equal(desk.line.mesh.visible, true, 'the way on the floor');
    assert.deepEqual(calls.taken, []);
    assert.deepEqual(log, [['walk', true]], 'the card fading');
    const moves = [];
    let last = r.viewer();
    let ahead = 0;
    await walkOut(r, () => {
      const v = r.viewer();
      moves.push(dist(v, last));
      last = v;
      // Once the viewer is under way, he is nearer the shelf than they are, until they are almost there.
      if (dist(v, start) > 0.3 && dist(v, to.position) > 1.5) {
        assert.ok(dist(desk, to.position) < dist(v, to.position), 'he goes ahead');
        ahead++;
      }
    });
    await taking;
    assert.ok(ahead > 20, `${ahead} frames with him ahead`);
    assert.deepEqual(calls.taken, [find]);
    assert.deepEqual(log, [['walk', true], ['take', 'Emma'], ['walk', false]], 'no fades on a screen; the card back once the book is out');
    assert.ok(dist(r.viewer(), to.position) < 1e-6, 'standing where the cut would put them');
    assert.ok(Math.abs(controls.yaw - to.yaw) < 0.05, `facing the shelf: ${controls.yaw} for ${to.yaw}`);
    assert.equal(r.rig.rotation.y, controls.yaw);
    assert.ok(Math.abs(controls.pitch) < 0.02, 'level');
    const moving = moves.filter((m) => m > 0);
    assert.ok(moving[0] < 0.01 && moving.at(-1) < 0.01, 'eased in and out');
    assert.ok(Math.max(...moves) <= 6 / 72 + 1e-9);
    assert.equal(ia.state, 'browse');
    assert.equal(controls.locomotionEnabled, true);
    assert.equal(controls.lookEnabled, true);
    // He stands beside it, facing the shelf, then turns to the viewer (some 110°); the way fades.
    const d = dist(desk, to.position);
    assert.ok(d > 0.8 && d < 1.4, `${d} m beside them`);
    assert.equal(desk.away, true);
    r.frame(1 / 72, 144);
    const toViewer = Math.atan2(to.position.x - desk.x, to.position.z - desk.z);
    assert.ok(Math.cos(desk.yaw - toViewer) > 0.95, 'facing them');
    assert.equal(desk.line.mesh.visible, false);
  });

  it('goes round furniture in the way', async () => {
    const table = { type: 'circle', x: -0.2, z: -0.4, r: 0.6, h: 0.8 };
    const r = room({ furniture: [table] });
    const to = spotBefore(r.cases[3]);
    const taking = r.desk.takeThere(r.findOn(3));
    await flush();
    let nearest = Infinity;
    await walkOut(r, () => {
      nearest = Math.min(nearest, dist(r.viewer(), table));
    });
    await taking;
    assert.ok(nearest > 0.6 + 0.4 - 0.2, `${nearest} m from the table's middle`);
    assert.ok(dist(r.viewer(), to.position) < 1e-6);
    assert.equal(r.calls.taken.length, 1);
  });

  it('is there at once on a click', async () => {
    const r = room();
    const to = spotBefore(r.cases[5]);
    const taking = r.desk.takeThere(r.findOn(5));
    await flush();
    r.frame(1 / 72, 20);
    assert.equal(r.calls.taken.length, 0);
    r.controls.dispatchEvent(new CustomEvent('select', { detail: {} }));
    r.frame();
    await flush();
    await taking;
    assert.equal(r.calls.taken.length, 1);
    assert.ok(dist(r.viewer(), to.position) < 1e-6);
    assert.equal(r.desk.walking, false);
  });

  it('closes the comfort vignette with the speed in a headset, keeps the head\'s own place and turn, and turns to the shelf in a blink', async () => {
    const r = room({ presenting: true });
    const { desk, controls, log } = r;
    r.camera.position.set(0.2, 1.6, -0.1); // the head off the rig's middle
    r.rig.updateMatrixWorld(true);
    const to = spotBefore(r.cases[3]);
    const taking = desk.takeThere(r.findOn(3, 'Emma'));
    await flush();
    assert.equal(controls.lookEnabled, true, 'a headset\'s view is the head\'s');
    await walkOut(r);
    await taking;
    const v = controls.vignette.values;
    assert.ok(v.length > 50);
    assert.ok(Math.max(...v) <= 1 && Math.max(...v) > 0.8, `up to ${Math.max(...v)}`);
    assert.ok(Math.abs(Math.max(...v) - 1.6 / VIGNETTE.fullSpeed) < 0.01, 'a short way: at 1.6 m/s');
    assert.equal(v.at(-1), 0, 'open at a stop');
    assert.ok(dist(r.viewer(), to.position) < 1e-6, 'the eyes where the cut would put them');
    assert.equal(r.rig.rotation.y, 0, 'not turned');
    assert.deepEqual(log, [['walk', true], ['fade', 1, 0.12], ['take', 'Emma'], ['fade', 0, 0.2], ['walk', false]]);
  });

  it('skips a long way\'s middle in a blink in a headset, and a click is there in a blink too', async () => {
    const r = room({ presenting: true, hall: true });
    const to = spotBefore(r.cases[2]);
    let taking = r.desk.takeThere(r.findOn(2, 'Far'));
    await flush();
    let last = r.viewer();
    const jumps = [];
    await walkOut(r, () => {
      const v = r.viewer();
      if (dist(v, last) > 1) jumps.push(dist(v, last));
      last = v;
    });
    await taking;
    assert.equal(jumps.length, 1, 'across the middle once');
    assert.ok(Math.abs(jumps[0] - (dist(r.world.spawn.position, to.position) - 3 - 6)) < 0.1, `${jumps[0]} m skipped`);
    assert.deepEqual(r.log, [['walk', true], ['fade', 1, 0.15], ['fade', 0, 0.25], ['fade', 1, 0.12], ['take', 'Far'], ['fade', 0, 0.2], ['walk', false]]);
    // Again from the start, and a click: dark, there, the book.
    r.log.length = 0;
    r.eyesAt(r.world.spawn.position.x, r.world.spawn.position.z);
    r.desk._toDesk();
    taking = r.desk.takeThere(r.findOn(2, 'Far'));
    await flush();
    r.frame(1 / 72, 30);
    r.controls.dispatchEvent(new CustomEvent('select', { detail: {} }));
    await walkOut(r);
    await taking;
    assert.deepEqual(r.log, [['walk', true], ['fade', 1, 0.15], ['fade', 1, 0.12], ['take', 'Far'], ['fade', 0, 0.2], ['walk', false]]);
    assert.ok(dist(r.viewer(), to.position) < 1e-6);
  });

  it('is the cut it was with less motion or with him hidden; hidden while walking, it ends at once', async () => {
    const r = room();
    r.ia.reduced = true;
    r.desk.takeThere(r.findOn(3));
    assert.equal(r.calls.taken.length, 1, 'at once');
    assert.equal(r.desk.walking, false);
    r.ia.reduced = false;
    r.desk.setShown(false);
    r.desk.takeThere(r.findOn(3));
    assert.equal(r.calls.taken.length, 2);
    assert.equal(r.desk.walking, false);
    r.desk.setShown(true);
    const taking = r.desk.takeThere(r.findOn(4));
    await flush();
    r.frame(1 / 72, 20);
    assert.equal(r.desk.walking, true);
    r.desk.setShown(false);
    r.frame();
    await flush();
    await taking;
    assert.equal(r.calls.taken.length, 3);
    assert.ok(dist(r.viewer(), spotBefore(r.cases[4]).position) < 1e-6);
    r.desk.setShown(true);
    assert.deepEqual(flat(r.desk), { x: r.desk.deskX, z: r.desk.deskZ }, 'shown again at the desk');
  });

  it('stops where it is when the room is built again under it: no book, the controls given back', async () => {
    const r = room();
    const taking = r.desk.takeThere(r.findOn(3));
    await flush();
    r.frame(1 / 72, 40);
    r.world.room = { colliders: [], walkable: () => true, R: 5 };
    r.frame();
    await flush();
    await taking;
    assert.deepEqual(r.calls.taken, []);
    assert.deepEqual(r.log, [['walk', true], ['walk', false]], 'the card back');
    assert.equal(r.desk.walking, false);
    assert.equal(r.controls.locomotionEnabled, true);
    assert.equal(r.ia.state, 'busy', 'the rebuild\'s to give back');
    assert.deepEqual(flat(r.desk), { x: r.desk.deskX, z: r.desk.deskZ });
  });

  it('walks back to the desk once the viewer has gone on, round them', async () => {
    const r = room();
    const taking = r.desk.takeThere(r.findOn(3));
    await flush();
    await walkOut(r);
    await taking;
    assert.equal(r.desk.away, true);
    // The book read and put back, a while on the same spot: he goes back, at his pace.
    let last = flat(r.desk);
    let nearest = Infinity;
    let frames = 0;
    while (r.desk.away && frames < 72 * 40) {
      r.frame();
      frames++;
      assert.ok(dist(r.desk, last) < 1.5 / 72, 'walking, not put there');
      last = flat(r.desk);
      nearest = Math.min(nearest, dist(r.desk, r.viewer()));
    }
    assert.ok(frames > 20 * 72, 'after a while');
    assert.equal(r.desk.away, false);
    assert.deepEqual(flat(r.desk), { x: r.desk.deskX, z: r.desk.deskZ });
    assert.ok(nearest > 0.6, `${nearest} m from the viewer at most`);
  });
});
