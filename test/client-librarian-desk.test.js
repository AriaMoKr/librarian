// The librarian at the desk (public/js/librarian/desk.js and figure.js, SPEC §5.10): his figure,
// where he stands by the catalogue stand and his collider there, how a pointer finds him, a click on
// a screen against the trigger in a headset, his panel (its keyboard, the question asked through
// the card, the answer and its finds, Take me there) and his turning towards a viewer. In Node, on
// a stand-in for the room (interaction.js) and a stub canvas for common's Panel.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as THREE from 'three';
import './helpers/vendor.js'; // desk.js's ../../vendor/common/panel.js

globalThis.document ??= /** @type {any} */ ({
  createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => new Proxy({}, { get: () => () => ({ width: 0 }) }) }),
});
const { Desk } = await import('../public/js/librarian/desk.js');
const { Figure, FIGURE, figureGeometry, rayUpright } = await import('../public/js/librarian/figure.js');

/** A rotunda's spawn point and stand (world.js _layoutRotunda, R 3.8), and a stand-in for the room. */
function room({ presenting = false } = {}) {
  const spawn = new THREE.Vector3(0, 0, 1.33);
  const kp = new THREE.Vector3(1.368, 0, -0.07);
  const world = {
    room: { colliders: [] },
    spawn: { position: spawn, yaw: 0 },
    kiosk: { position: kp, yaw: Math.atan2(spawn.x - kp.x, spawn.z - kp.z) },
  };
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  scene.add(camera);
  const panels = [];
  const targets = [];
  const frames = [];
  const ia = {
    scene, world, camera, controls: { presenting }, reduced: false,
    addPanel: (p) => panels.push(p), addTarget: (t) => targets.push(t), onFrame: (fn) => frames.push(fn),
  };
  /** The viewer's eyes at (x, z). */
  const eyesAt = (x, z, y = 1.6) => {
    camera.position.set(x, y, z);
    camera.updateMatrixWorld(true);
  };
  eyesAt(spawn.x, spawn.z);
  const asked = [];
  const card = {
    input: { value: '' }, answer: null, onLooking: null, onAnswer: null,
    askNow(q) { asked.push(q); },
  };
  const calls = { box: 0, taken: [] };
  const desk = new Desk({
    interaction: ia, card, take: (find) => calls.taken.push(find), multi: () => false, intoBox: () => { calls.box++; },
  });
  const frame = (dt = 1 / 72, n = 1) => {
    for (let i = 0; i < n; i++) for (const fn of frames) fn(dt);
  };
  return { ia, world, camera, eyesAt, panels, targets, frame, card, asked, calls, desk };
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

  it('asks from his panel through the card, says the answer and lists its finds, each a way there', () => {
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
    assert.deepEqual(calls.taken, [emma]);
    // Opened again: the conversation where it was.
    desk.open();
    assert.equal(p.get('answer').text, 'I have Emma, by Jane Austen.');
    assert.deepEqual(desk.uiState(), { panel: true });
    p.click(...[(p.get('close').x + 30) / p.w, 1 - (p.get('close').y + 28) / p.h]);
    assert.equal(p.visible, false);
    assert.deepEqual(desk.uiState(), {});
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
