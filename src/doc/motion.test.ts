import { describe, expect, it } from 'vitest';
import { createDemoDoc } from './demo';
import { evaluate, glyphProgress, glyphRanks, posterTime, restTime, unitDelays, type TextItem } from './evaluate';
import { migrate, NewerSchemaError } from './migrations';
import {
  defaultEnter,
  defaultExit,
  defaultLoop,
  ENTER_PRESETS,
  EXIT_PRESETS,
  glyphAnimatorFor,
  glyphExitFor,
  glyphLoopFor,
  IDENTITY,
  maxRank,
  LOOP_PRESETS,
  motionModifiers,
  unitCount,
  waveFor,
  type Motion,
} from './motion';
import { REST_POSE, SCHEMA_VERSION, type ImageLayer, type TextLayer } from './types';

const comp = { width: 1920, height: 1080, duration: 5 };
const enter = (preset: Parameters<typeof defaultEnter>[0]): Motion => ({ enter: defaultEnter(preset, 1), exit: null, loop: null });

describe('enter presets (whole layer)', () => {
  const imagePresets = ENTER_PRESETS.filter((p) => p.for.includes('image')).map((p) => p.id);
  it.each(imagePresets)('%s: hidden or offset at start, identity at the end', (preset) => {
    const before = motionModifiers(enter(preset), 0.5, comp, 'image');
    const after = motionModifiers(enter(preset), 10, comp, 'image');
    expect(after).toEqual(IDENTITY);
    const changed = before.opacity < 1 || before.dx !== 0 || before.dy !== 0 || before.scale !== 1 || before.tiltX !== 0;
    expect(changed).toBe(true);
  });
  it('opacity never exceeds 1 even with overshooting easings', () => {
    for (let t = 0; t <= 3; t += 0.01) expect(motionModifiers(enter('pop'), t, comp, 'image').opacity).toBeLessThanOrEqual(1);
  });
  it('slides scale with the comp size', () => {
    const small = motionModifiers(enter('slide-up'), 1, { width: 960, height: 540, duration: 5 }, 'image').dy;
    const big = motionModifiers(enter('slide-up'), 1, comp, 'image').dy;
    expect(big).toBeCloseTo(small * 2);
  });
  it('per-glyph presets leave text layers untouched as a whole', () => {
    expect(motionModifiers(enter('rise'), 1.2, comp, 'text')).toEqual(IDENTITY);
  });
});

describe('exit presets (whole layer)', () => {
  const exits = EXIT_PRESETS.filter((p) => p.for.includes('image')).map((p) => p.id);
  it.each(exits)('%s: identity before, gone at the comp end', (preset) => {
    const m: Motion = { enter: null, exit: defaultExit(preset), loop: null };
    expect(motionModifiers(m, 1, comp, 'image')).toEqual(IDENTITY);
    expect(motionModifiers(m, comp.duration, comp, 'image').opacity).toBe(0);
  });
  it('enter and exit compose', () => {
    const m: Motion = { enter: defaultEnter('fade', 0), exit: defaultExit('fade'), loop: null };
    expect(motionModifiers(m, 0, comp, 'image').opacity).toBe(0);
    expect(motionModifiers(m, 2.5, comp, 'image').opacity).toBe(1);
    expect(motionModifiers(m, 5, comp, 'image').opacity).toBe(0);
  });
  it('rest time lies between the enter and the exit', () => {
    const doc = createDemoDoc();
    const h = doc.comp.layers[2] as TextLayer;
    h.motion = { enter: defaultEnter('rise', 0.5), exit: defaultExit('sink'), loop: null };
    const t = restTime(h, doc.comp);
    expect(t).toBeGreaterThanOrEqual(1.3);
    expect(t).toBeLessThan(doc.comp.duration - 0.6);
  });
});

describe('poster time (thumbnails)', () => {
  it('is late when nothing exits, and between enter and exit otherwise', () => {
    const doc = createDemoDoc();
    expect(posterTime(doc)).toBeCloseTo(doc.comp.duration - 0.05);
    const h = doc.comp.layers[2] as TextLayer;
    h.animator = null;
    h.motion = { enter: defaultEnter('rise', 0), exit: { ...defaultExit('sink'), duration: 1 }, loop: null };
    const t = posterTime(doc);
    expect(t).toBeGreaterThan(0.8);
    expect(t).toBeLessThan(doc.comp.duration - 1);
  });
});

describe('loops are seamless', () => {
  it.each(LOOP_PRESETS.map((p) => p.id))('%s matches at the start and end of a cycle', (preset) => {
    const loop = defaultLoop(preset, comp);
    const m: Motion = { enter: null, exit: null, loop };
    const a = motionModifiers(m, 0.3, comp, 'image');
    const b = motionModifiers(m, 0.3 + loop.period, comp, 'image');
    expect(a.dy).toBeCloseTo(b.dy, 6);
    expect(a.scale).toBeCloseTo(b.scale, 6);
    expect(a.dx).toBeCloseTo(b.dx, 6);
  });
  it('ken burns defaults to the comp duration', () => {
    expect(defaultLoop('ken-burns', comp).period).toBe(5);
  });
  it('per-glyph loops compile for text loop presets only', () => {
    expect(waveFor(defaultLoop('wave', comp), 96)?.amplitude).toBeGreaterThan(0);
    expect(waveFor(defaultLoop('float', comp), 96)).toBeNull();
    for (const p of LOOP_PRESETS.filter((l) => l.glyph)) expect(glyphLoopFor(defaultLoop(p.id, comp), 96)?.kind).toBe(p.id);
    expect(glyphLoopFor(defaultLoop('pulse', comp), 96)).toBeNull();
  });
});

describe('text presets compile to the glyph animator', () => {
  const text = 'Ship it';
  const glyphEnters = ENTER_PRESETS.filter((p) => p.glyph).map((p) => p.id);
  it.each(glyphEnters)('%s: last unit finishes exactly at start + duration', (preset) => {
    const e = defaultEnter(preset, 0.5);
    const a = glyphAnimatorFor(e, text)!;
    const n = unitCount(text, a.unit);
    const last = maxRank(n, a.order);
    expect(glyphProgress(a, last, e.start + e.duration - 1e-6)).toBeLessThan(1);
    expect(glyphProgress(a, last, e.start + e.duration + 1e-6)).toBe(1);
    expect(glyphRanks(n, a.order, a.seed)).toHaveLength(n);
    // Fully away at the start: something visibly differs from rest.
    expect(JSON.stringify(a.pose)).not.toBe(JSON.stringify(REST_POSE));
  });
  it('20+ kinetic text presets across enter / exit / emphasis', () => {
    const count = [ENTER_PRESETS, EXIT_PRESETS, LOOP_PRESETS].flat().filter((p) => p.glyph).length;
    expect(count).toBeGreaterThanOrEqual(20);
  });
  it('overrides change unit, order, overlap and falloff', () => {
    const e = { ...defaultEnter('rise', 0), stagger: { unit: 'word' as const, order: 'reverse' as const, overlap: 1 } };
    const a = glyphAnimatorFor(e, 'one two three')!;
    expect(a.unit).toBe('word');
    expect(a.order).toBe('reverse');
    expect(a.duration).toBeCloseTo(e.duration);
    expect(a.stagger).toBe(0);
  });
  it('glyph exits finish at the comp end (minus endOffset)', () => {
    const x = { ...defaultExit('sink'), endOffset: 0.5 };
    const a = glyphExitFor(x, text, comp)!;
    const n = unitCount(text, a.unit);
    const delays = unitDelays(n, a);
    expect(a.start + Math.max(...delays) + a.duration).toBeCloseTo(comp.duration - 0.5);
  });
  it('non-glyph presets return null', () => {
    expect(glyphAnimatorFor(defaultEnter('fade'), text)).toBeNull();
  });
});

describe('evaluate applies motion', () => {
  it('image enter preset changes opacity/position before it finishes', () => {
    const doc = createDemoDoc();
    const shot = doc.comp.layers[1] as ImageLayer;
    shot.motion = { enter: defaultEnter('slide-up', 2), exit: null, loop: null };
    const at = (t: number) => evaluate(doc, t).items.find((i) => i.id === 'shot') as { y: number; opacity: number };
    expect(at(2).opacity).toBe(0);
    expect(at(2.1).y).toBeGreaterThan(at(5).y);
    expect(at(5).opacity).toBe(1);
  });
  it('text glyph preset overrides the legacy animator', () => {
    const doc = createDemoDoc();
    const h = doc.comp.layers[2] as TextLayer;
    h.motion = { enter: defaultEnter('typewriter', 0), exit: null, loop: null };
    const item = evaluate(doc, 0).items.find((i) => i.id === 'headline') as TextItem;
    expect(item.enter!.easing.kind).toBe('hold');
  });
});

describe('migrations', () => {
  it('upgrades a v1 document (no motion) to the current schema', () => {
    const v1 = createDemoDoc() as unknown as Record<string, unknown> & { comp: { layers: Record<string, unknown>[] } };
    v1.schemaVersion = 1;
    v1.comp.layers.forEach((l) => delete l.motion);
    const doc = migrate(JSON.parse(JSON.stringify(v1)));
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect((doc.comp.layers[1] as ImageLayer).motion).toEqual({ enter: null, exit: null, loop: null });
    expect(doc.comp.layers[0]).not.toHaveProperty('motion');
  });
  it('upgrades a v2 document: text styling defaults, animator pose, exit', () => {
    const v2 = createDemoDoc() as unknown as Record<string, unknown> & { comp: { layers: Record<string, unknown>[] } };
    v2.schemaVersion = 2;
    const head = v2.comp.layers[2]!;
    for (const k of ['weight', 'lineHeight', 'gradient', 'outline', 'shadow']) delete head[k];
    head.animator = { start: 0.3, duration: 0.7, stagger: 0.04, order: 'forward', seed: 7, easing: { kind: 'linear' }, from: { offsetX: 0, offsetY: 60, scale: 0.4, rotation: -12, opacity: 0 } };
    v2.comp.layers.forEach((l) => l.motion && delete (l.motion as Record<string, unknown>).exit);
    const doc = migrate(JSON.parse(JSON.stringify(v2)));
    const t = doc.comp.layers[2] as TextLayer;
    expect(t.weight).toBe(400);
    expect(t.lineHeight).toBe(1.15);
    expect(t.motion.exit).toBeNull();
    expect(t.animator!.unit).toBe('glyph');
    expect(t.animator!.pose).toMatchObject({ offsetY: 60, scaleX: 0.4, scaleY: 0.4, rotation: -12, opacity: 0, blur: 0, spread: 1 });
    expect((doc.comp.layers[1] as ImageLayer).motion.exit).toBeNull();
  });
  it('current documents pass through unchanged', () => {
    const doc = createDemoDoc();
    expect(migrate(JSON.parse(JSON.stringify(doc)))).toEqual(doc);
  });
  it('refuses newer formats and garbage', () => {
    expect(() => migrate({ ...createDemoDoc(), schemaVersion: SCHEMA_VERSION + 1 })).toThrow(NewerSchemaError);
    expect(() => migrate({ hello: 1 })).toThrow();
  });
});
