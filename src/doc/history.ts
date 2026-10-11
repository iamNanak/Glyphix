// Command bus + undo/redo via path patches. Every edit records a forward and inverse
// patch; history never copies the whole document (or pixels — assets are referenced by id).

export type Path = readonly (string | number)[];

export interface Patch {
  path: Path;
  /** `undefined` means "remove". */
  value: unknown;
}

export interface HistoryEntry {
  label: string;
  forward: Patch[];
  inverse: Patch[];
  /** Consecutive entries with the same key (e.g. a drag) collapse into one undo step. */
  coalesceKey?: string;
}

function getIn(obj: unknown, path: Path): unknown {
  let cur: unknown = obj;
  for (const key of path) {
    if (cur == null) return undefined;
    cur = (cur as Record<string | number, unknown>)[key];
  }
  return cur;
}

/** Immutable set with structural sharing. Arrays: numeric key; `undefined` at an array index splices. */
function setIn<T>(obj: T, path: Path, value: unknown): T {
  if (path.length === 0) return value as T;
  const [key, ...rest] = path as [string | number, ...Path];
  if (Array.isArray(obj)) {
    const copy = obj.slice();
    const idx = key as number;
    if (rest.length === 0 && value === undefined) copy.splice(idx, 1);
    else copy[idx] = setIn(copy[idx], rest, value);
    return copy as T;
  }
  const src = (obj ?? {}) as Record<string, unknown>;
  const copy = { ...src };
  if (rest.length === 0 && value === undefined) delete copy[key as string];
  else copy[key as string] = setIn(src[key as string], rest, value);
  return copy as T;
}

export function applyPatches<T>(doc: T, patches: readonly Patch[]): T {
  return patches.reduce((d, p) => setIn(d, p.path, p.value), doc);
}

/** Build a "set these paths" edit, capturing inverse values from the current doc. */
export function makeSet(doc: unknown, label: string, sets: Patch[], coalesceKey?: string): HistoryEntry {
  const inverse = sets.map((p) => ({ path: p.path, value: getIn(doc, p.path) })).reverse();
  return { label, forward: sets, inverse, coalesceKey };
}

/** Insert into an array at index (inverse removes it). */
export function makeInsert(arrayPath: Path, index: number, value: unknown, label: string): HistoryEntry {
  return {
    label,
    forward: [{ path: arrayPathSplice(arrayPath, index), value: { __insert: value } }],
    inverse: [{ path: [...arrayPath, index], value: undefined }],
  };
}

const arrayPathSplice = (p: Path, i: number): Path => [...p, `__insert:${i}`];

export class History<T> {
  private past: HistoryEntry[] = [];
  private future: HistoryEntry[] = [];
  private lastCommitAt = 0;

  constructor(
    private doc: T,
    private readonly limit = 500,
    private readonly coalesceWindowMs = 1000,
  ) {}

  get current(): T {
    return this.doc;
  }
  get canUndo(): boolean {
    return this.past.length > 0;
  }
  get canRedo(): boolean {
    return this.future.length > 0;
  }

  commit(entry: HistoryEntry, now = Date.now()): T {
    this.doc = applyEntry(this.doc, entry.forward);
    const prev = this.past[this.past.length - 1];
    const coalesce =
      entry.coalesceKey !== undefined &&
      prev?.coalesceKey === entry.coalesceKey &&
      now - this.lastCommitAt < this.coalesceWindowMs;
    if (coalesce && prev) {
      // Keep the original inverse; replace forward with the latest values.
      this.past[this.past.length - 1] = { ...prev, forward: mergeForward(prev.forward, entry.forward) };
    } else {
      this.past.push(entry);
      if (this.past.length > this.limit) this.past.shift();
    }
    this.future = [];
    this.lastCommitAt = now;
    return this.doc;
  }

  undo(): T {
    const e = this.past.pop();
    if (!e) return this.doc;
    this.doc = applyEntry(this.doc, e.inverse);
    this.future.push(e);
    this.lastCommitAt = 0;
    return this.doc;
  }

  redo(): T {
    const e = this.future.pop();
    if (!e) return this.doc;
    this.doc = applyEntry(this.doc, e.forward);
    this.past.push(e);
    this.lastCommitAt = 0;
    return this.doc;
  }

  /** Replace the document without history (e.g. loading a project). */
  reset(doc: T): void {
    this.doc = doc;
    this.past = [];
    this.future = [];
  }
}

function applyEntry<T>(doc: T, patches: readonly Patch[]): T {
  let d = doc;
  for (const p of patches) {
    const last = p.path[p.path.length - 1];
    if (typeof last === 'string' && last.startsWith('__insert:')) {
      const idx = Number(last.slice('__insert:'.length));
      const arrPath = p.path.slice(0, -1);
      const arr = (getIn(d, arrPath) as unknown[] | undefined) ?? [];
      const copy = arr.slice();
      copy.splice(idx, 0, (p.value as { __insert: unknown }).__insert);
      d = setIn(d, arrPath, copy);
    } else {
      d = setIn(d, p.path, p.value);
    }
  }
  return d;
}

function mergeForward(prev: Patch[], next: Patch[]): Patch[] {
  const key = (p: Patch) => JSON.stringify(p.path);
  const map = new Map(prev.map((p) => [key(p), p]));
  for (const p of next) map.set(key(p), p);
  return [...map.values()];
}
