// THE NATIVE SEQUENCE DOCUMENT: its shape, its one validator, and the rules that resolve it to a board and calls.
//
// WHAT THIS IS FOR. A sequence - a start setup, the calls in order, the end setup - is the app's unit of work, and the
// app could only keep one in localStorage or read All8's call-format text. `SequenceSyntax.md` (repo root) is the
// published spec and this module is its implementation, so an author (a person, or a model given the spec) writes
// NAMES, and the tree's own ids (`sid`/`aid`/`fid`, `vid`) make the document exact when the app exports it.
//
// THE IDS ARE STORED TAGS, NOT CONTENT ADDRESSES (`call-variant-id.ts` says why that matters):
//   * `fid` names the formation DEFINITION (a shape), `aid` its gender placement, `sid` the arrangement AND the order
//     the dancers are listed in (`sid` implies `aid` implies `fid`), and `vid` names a call variant - the level, the
//     title and the start definition's `fid`.
//   * An id that is present is AUTHORITATIVE: a `sid` resolves through the setup catalogue and never through a name,
//     and a `vid` resolves through the registered variants. A name beside an id is a LABEL - it is reported when it
//     disagrees, never silently preferred.
//   * A document may carry ids alone (the app's export), names alone (what a model writes), or both. That is what makes
//     it both readable and exact.
//
// WHAT IS REFUSED, and every refusal names its reason rather than guessing: an unknown `format` or `version`; a `start`
// with no form to resolve; a `sid` the catalogue does not hold; a step that is neither a name nor a `vid`; a `vid` this
// library does not hold when there is no name to fall back on; a `dancers` list that is not eight physical poses.
//
// PURE AND SEPARATE FROM THE PANEL, so `poc/tools/sequence-json-probe.mjs` drives it against the real corpus: the
// catalogue, the formation labels and the variant library arrive as RESOLVERS, and nothing here reaches for a
// `Sequencer`, a DOM or localStorage.

import { arrangementId, formationId, setupId } from 'dancing-squared-engine';
import type { Board, CallStep, GroupStep, ModuleStep } from 'dancing-squared-engine';

/** The document's discriminator. A file that does not carry it is not a sequence, whatever else it holds. */
export const SEQUENCE_FORMAT = 'dancing-squared/sequence';
/** Bumped when the shape changes incompatibly. A document from the future is refused, not guessed at. */
export const SEQUENCE_VERSION = 1;

/** One dancer's pose in a document: world units, heading in RADIANS (the engine's unit, not the tam format's degrees). */
export interface SequenceDancer {
  gender: 'boy' | 'girl' | 'phantom';
  x: number;
  y: number;
  heading: number;
}

/**
 * One call inside a step, by id and/or name.
 *
 * `vid` is the variant this step means (`V1-…`); `call` is the catalogue title and is what a hand-written or
 * model-written document carries. `selection` scopes the call to a group (`Heads`, `Centers`, …).
 */
export interface StepRefJson {
  vid?: string;
  call?: string;
  selection?: string;
}

/** A step: a bare call name, a scoped call, or a "while" of lanes. */
export type SequenceStepJson = string | StepRefJson | { groups: { selection: string; calls: (string | StepRefJson)[] }[] };

/**
 * A board, in one of four forms - the exporter writes the first three together (ids plus a readable label), and
 * `dancers` is the exact fallback for a board no catalogue row carries.
 */
export interface SetupRefJson {
  /** The setup id (`S1-…`): arrangement AND authored order. Authoritative when present. */
  sid?: string;
  /** The arrangement id (`A1-…`), carried so a reader can check the chain `sid ⇒ aid ⇒ fid`. */
  aid?: string;
  /** The formation id (`F3-…`), ditto. */
  fid?: string;
  /** A resolvable label: a corpus start label ("Zero Box", "Zero Line", "Static Square") or an engine formation name. */
  formation?: string;
  /** A free-text label for people. Never resolved - it is the document's own caption. */
  name?: string;
  /** The exact board: eight physical poses in the order the couples are numbered. Wins over every id. */
  dancers?: SequenceDancer[];
}

export interface SequenceDocJson {
  format: string;
  version: number;
  name?: string;
  level?: string;
  start: SetupRefJson;
  steps: SequenceStepJson[];
  end?: SetupRefJson;
}

// ---------------------------------------------------------------- parse

type ParseResult = { ok: true; doc: SequenceDocJson } | { ok: false; reason: string };

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A board reference: at least one form, and every field that IS present well-formed. */
function readSetupRef(raw: unknown, what: string): { ref: SetupRefJson } | { reason: string } {
  if (!isObject(raw)) return { reason: `${what} must be an object` };
  const ref: SetupRefJson = {};
  if ('sid' in raw) {
    if (!isNonEmptyString(raw.sid)) return { reason: `${what}.sid must be a setup id string` };
    ref.sid = raw.sid.trim();
  }
  if ('aid' in raw) {
    if (!isNonEmptyString(raw.aid)) return { reason: `${what}.aid must be an arrangement id string` };
    ref.aid = raw.aid.trim();
  }
  if ('fid' in raw) {
    if (!isNonEmptyString(raw.fid)) return { reason: `${what}.fid must be a formation id string` };
    ref.fid = raw.fid.trim();
  }
  if ('formation' in raw) {
    if (!isNonEmptyString(raw.formation)) return { reason: `${what}.formation must be a formation name` };
    ref.formation = raw.formation.trim();
  }
  if ('name' in raw) {
    if (typeof raw.name !== 'string') return { reason: `${what}.name must be a string` };
    ref.name = raw.name;
  }
  if ('dancers' in raw) {
    if (!Array.isArray(raw.dancers) || raw.dancers.length === 0) return { reason: `${what}.dancers must be a non-empty array` };
    const dancers: SequenceDancer[] = [];
    for (const [i, d] of raw.dancers.entries()) {
      if (!isObject(d)) return { reason: `${what}.dancers[${i}] must be an object` };
      const gender = d.gender;
      if (gender !== 'boy' && gender !== 'girl' && gender !== 'phantom') {
        return { reason: `${what}.dancers[${i}].gender must be "boy", "girl" or "phantom"` };
      }
      if (!isNumber(d.x) || !isNumber(d.y)) return { reason: `${what}.dancers[${i}] needs numeric x and y` };
      if (!isNumber(d.heading)) return { reason: `${what}.dancers[${i}].heading must be a number in radians` };
      dancers.push({ gender, x: d.x, y: d.y, heading: d.heading });
    }
    ref.dancers = dancers;
  }
  if (Object.keys(ref).length === 0 || (ref.sid === undefined && ref.formation === undefined && ref.dancers === undefined)) {
    return { reason: `${what} needs one of "sid", "formation" or "dancers"` };
  }
  return { ref };
}

/** One step reference: a call name, a `vid`, or both - plus an optional selection. */
function readStepRef(raw: unknown, what: string): { step: StepRefJson } | { reason: string } {
  if (!isObject(raw)) return { reason: `${what} must be a string or an object` };
  let vid: string | undefined;
  let call: string | undefined;
  let selection: string | undefined;
  if ('vid' in raw) {
    if (!isNonEmptyString(raw.vid)) return { reason: `${what}.vid must be a call-variant id` };
    vid = raw.vid.trim();
  }
  if ('call' in raw) {
    if (!isNonEmptyString(raw.call)) return { reason: `${what}.call must be a call name` };
    call = raw.call.trim();
  }
  if ('selection' in raw) {
    if (!isNonEmptyString(raw.selection)) return { reason: `${what}.selection must be a group name` };
    selection = raw.selection.trim();
    if (call === undefined) return { reason: `${what}.selection needs a "call" to scope` };
  }
  if (vid === undefined && call === undefined) {
    return { reason: `${what} needs "call", "vid" or both` };
  }
  // THE KEYS ARE WRITTEN IN THE DOCUMENT'S OWN ORDER (`selection`, `call`, `vid`), so a parsed document and a serialised
  // one are the same object and not merely the same data - the probe compares them directly.
  const step: StepRefJson = {};
  if (selection !== undefined) step.selection = selection;
  if (call !== undefined) step.call = call;
  if (vid !== undefined) step.vid = vid;
  return { step };
}

function readStep(raw: unknown, what: string): { step: SequenceStepJson } | { reason: string } {
  if (typeof raw === 'string') {
    if (!isNonEmptyString(raw)) return { reason: `${what} must not be an empty call name` };
    return { step: raw };
  }
  if (isObject(raw) && 'groups' in raw) {
    if (!Array.isArray(raw.groups) || raw.groups.length === 0) return { reason: `${what}.groups must be a non-empty array` };
    const groups: { selection: string; calls: (string | StepRefJson)[] }[] = [];
    for (const [i, g] of raw.groups.entries()) {
      const at = `${what}.groups[${i}]`;
      if (!isObject(g)) return { reason: `${at} must be an object` };
      if (!isNonEmptyString(g.selection)) return { reason: `${at}.selection must be a group name` };
      if (!Array.isArray(g.calls) || g.calls.length === 0) return { reason: `${at}.calls must be a non-empty array` };
      const calls: (string | StepRefJson)[] = [];
      for (const [j, c] of g.calls.entries()) {
        if (typeof c === 'string') {
          if (!isNonEmptyString(c)) return { reason: `${at}.calls[${j}] must not be empty` };
          calls.push(c);
          continue;
        }
        const read = readStepRef(c, `${at}.calls[${j}]`);
        if ('reason' in read) return read;
        calls.push(read.step);
      }
      groups.push({ selection: g.selection.trim(), calls });
    }
    return { step: { groups } };
  }
  const read = readStepRef(raw, what);
  return 'reason' in read ? read : { step: read.step };
}

/**
 * Validate `text` as a sequence document. Shape only - a name that no call answers to, or a `sid` no catalogue holds,
 * is `resolveSequence`'s to refuse, because those questions need the engine.
 */
export function parseSequenceDoc(text: string): ParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return { ok: false, reason: `not JSON: ${(err as Error).message}` };
  }
  if (!isObject(parsed)) return { ok: false, reason: 'a sequence document is a JSON object' };
  if (parsed.format !== SEQUENCE_FORMAT) {
    return { ok: false, reason: `not a sequence document: "format" must be "${SEQUENCE_FORMAT}"` };
  }
  if (parsed.version !== SEQUENCE_VERSION) {
    return {
      ok: false,
      reason: `this app reads version ${SEQUENCE_VERSION}; the document says ${JSON.stringify(parsed.version)}`,
    };
  }
  if ('name' in parsed && typeof parsed.name !== 'string') return { ok: false, reason: '"name" must be a string' };
  if ('level' in parsed && typeof parsed.level !== 'string') return { ok: false, reason: '"level" must be a string' };
  if (!('start' in parsed)) return { ok: false, reason: 'a sequence document needs a "start"' };
  const start = readSetupRef(parsed.start, 'start');
  if ('reason' in start) return { ok: false, reason: start.reason };
  if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
    return { ok: false, reason: '"steps" must be a non-empty array' };
  }
  const steps: SequenceStepJson[] = [];
  for (const [i, raw] of parsed.steps.entries()) {
    const read = readStep(raw, `steps[${i}]`);
    if ('reason' in read) return { ok: false, reason: read.reason };
    steps.push(read.step);
  }
  let end: SetupRefJson | undefined;
  if ('end' in parsed) {
    const read = readSetupRef(parsed.end, 'end');
    if ('reason' in read) return { ok: false, reason: read.reason };
    end = read.ref;
  }
  const doc: SequenceDocJson = { format: SEQUENCE_FORMAT, version: SEQUENCE_VERSION, start: start.ref, steps };
  if (typeof parsed.name === 'string') doc.name = parsed.name;
  if (typeof parsed.level === 'string') doc.level = parsed.level;
  if (end) doc.end = end;
  return { ok: true, doc };
}

// ---------------------------------------------------------------- serialise

/** `depth` two-space indents. One definition, so every line of the document agrees. */
const indent = (depth: number): string => ' '.repeat(depth * 2);

/**
 * A board reference as the document writes it: a single line when it is ids and a caption, and one pose per line when
 * it carries the exact board (which is the case only for a board no catalogue row holds).
 */
function writeSetupRef(ref: SetupRefJson, depth: number): string {
  const fields: string[] = [];
  for (const key of ['sid', 'aid', 'fid', 'formation', 'name'] as const) {
    const value = ref[key];
    if (value !== undefined) fields.push(`${JSON.stringify(key)}: ${JSON.stringify(value)}`);
  }
  if (!ref.dancers) return `{ ${fields.join(', ')} }`;
  const dancers = ref.dancers.map(
    (d) =>
      `${indent(depth + 2)}{ "gender": ${JSON.stringify(d.gender)}, "x": ${d.x}, "y": ${d.y}, "heading": ${d.heading} }`,
  );
  return `{\n${fields.map((f) => `${indent(depth + 1)}${f}`).join(',\n')}${fields.length ? ',\n' : ''}`
    + `${indent(depth + 1)}"dancers": [\n${dancers.join(',\n')}\n${indent(depth + 1)}]\n${indent(depth)}}`;
}

function writeStepRef(ref: StepRefJson): string {
  const body: string[] = [];
  if (ref.selection !== undefined) body.push(`"selection": ${JSON.stringify(ref.selection)}`);
  if (ref.call !== undefined) body.push(`"call": ${JSON.stringify(ref.call)}`);
  if (ref.vid !== undefined) body.push(`"vid": ${JSON.stringify(ref.vid)}`);
  return `{ ${body.join(', ')} }`;
}

function writeStep(step: SequenceStepJson, depth: number): string {
  if (typeof step === 'string') return `${indent(depth)}${JSON.stringify(step)}`;
  if ('groups' in step) {
    const lanes = step.groups.map((g) => {
      const calls = g.calls.map((c) => (typeof c === 'string' ? JSON.stringify(c) : writeStepRef(c)));
      return `${indent(depth + 2)}{ "selection": ${JSON.stringify(g.selection)}, "calls": [${calls.join(', ')}] }`;
    });
    return `{\n${indent(depth + 1)}"groups": [\n${lanes.join(',\n')}\n${indent(depth + 1)}]\n${indent(depth)}}`;
  }
  return `${indent(depth)}${writeStepRef(step)}`;
}

/**
 * The document as text: a stable key order, two-space indentation, one step per line group.
 *
 * DETERMINISTIC, not merely valid: an export that changed shape between runs could not be diffed, and this tree's rule
 * is that a generated artefact has a gate that fails when it goes stale - the probe round-trips every field through
 * here and back.
 */
export function sequenceToJson(doc: SequenceDocJson): string {
  const lines: string[] = ['{'];
  lines.push(`${indent(1)}"format": ${JSON.stringify(SEQUENCE_FORMAT)},`);
  lines.push(`${indent(1)}"version": ${SEQUENCE_VERSION},`);
  if (doc.name !== undefined) lines.push(`${indent(1)}"name": ${JSON.stringify(doc.name)},`);
  if (doc.level !== undefined) lines.push(`${indent(1)}"level": ${JSON.stringify(doc.level)},`);
  lines.push(`${indent(1)}"start": ${writeSetupRef(doc.start, 1)},`);
  lines.push(`${indent(1)}"steps": [`);
  lines.push(doc.steps.map((step) => writeStep(step, 2)).join(',\n'));
  lines.push(`${indent(1)}]${doc.end ? ',' : ''}`);
  if (doc.end) lines.push(`${indent(1)}"end": ${writeSetupRef(doc.end, 1)}`);
  lines.push('}');
  return `${lines.join('\n')}\n`;
}

// ---------------------------------------------------------------- resolve

/** A catalogue row, as the setup picker holds it. */
export interface SetupRow {
  sid: string;
  fid: string;
  aid: string;
  display: string;
  dancers: SequenceDancer[];
}

/**
 * The three questions this module cannot answer alone, asked of the caller: the setup catalogue, the formation labels,
 * and the registered variants. In the app they are `availableSetups`, `resolveStartFormation`/`boardForSetup` and
 * `Sequencer.variantByVid`; in the probe they are the same three built from the real corpus.
 */
export interface SequenceResolvers {
  /** A catalogue setup by its `sid`, or null when the catalogue has no such setup. */
  setup(sid: string): SetupRow | null;
  /** A board by a start label or an engine formation name, or null when nothing answers to it. */
  formation(name: string): { dancers: SequenceDancer[]; label: string } | null;
  /** The variant a stored `vid` names, or null when the library does not hold it. */
  variant(vid: string): { title: string } | null;
}

interface ResolvedStart {
  dancers: SequenceDancer[];
  /** What the document or the catalogue calls this board, for the report. */
  label: string;
  sid: string | null;
  fid: string | null;
  aid: string | null;
}

interface ResolvedSequence {
  start: ResolvedStart;
  steps: ModuleStep[];
  /** Tolerated disagreements (`vid` unknown but a name given, a name that disagrees with the id, a broken id chain). */
  notes: string[];
}

export type SequenceResult = { ok: true; sequence: ResolvedSequence } | { ok: false; reason: string };

/** The ids a board carries, computed - the same calls the document's exporter uses. */
export function idsOf(board: Board): { sid: string | null; fid: string | null; aid: string | null } {
  return { sid: setupId(board), fid: formationId(board), aid: arrangementId(board) };
}

function labelOf(ref: SetupRefJson, fallback: string): string {
  return ref.name ?? ref.formation ?? fallback;
}

/**
 * One board reference resolved to the eight poses to stand up, or the reason it cannot be.
 *
 * EXPORTED BECAUSE A SAVED MODULE RECORDS ITS BOARDS IN THE SAME SHAPE and must resolve them the same way - the drawer's
 * load and a document's import are the same question, and a second reader of `sid`s is how the two would drift. `what`
 * names the field in the refusal, so a caller reading a message knows whether it was a document's `start` or a module's.
 *
 * Everything tolerated comes back in `notes` (an `aid`/`fid` that disagrees with the setup's own chain) rather than
 * being silently preferred or refused: the `sid` is authoritative, and the disagreement is worth saying out loud.
 */
export function resolveSetupRef(ref: SetupRefJson, r: SequenceResolvers, what = 'start'): { start: ResolvedStart; notes: string[] } | { reason: string } {
  // THE EXACT POSES WIN, because they are the only form that cannot be reinterpreted by a later catalogue.
  if (ref.dancers) {
    if (ref.dancers.length !== 8) {
      return { reason: `${what}.dancers holds ${ref.dancers.length} dancers; a sequence is 8-dancer` };
    }
    return {
      start: {
        dancers: ref.dancers,
        label: labelOf(ref, 'the given board'),
        sid: ref.sid ?? null,
        fid: ref.fid ?? null,
        aid: ref.aid ?? null,
      },
      notes: [],
    };
  }
  if (ref.sid !== undefined) {
    const row = r.setup(ref.sid);
    if (!row) return { reason: `${what}.sid ${JSON.stringify(ref.sid)} is not a setup this catalogue holds` };
    const notes: string[] = [];
    if (ref.fid !== undefined && ref.fid !== row.fid) notes.push(`${what}.fid ${ref.fid} disagrees with the setup's ${row.fid}`);
    if (ref.aid !== undefined && ref.aid !== row.aid) notes.push(`${what}.aid ${ref.aid} disagrees with the setup's ${row.aid}`);
    return {
      start: { dancers: row.dancers, label: ref.name ?? row.display, sid: row.sid, fid: row.fid, aid: row.aid },
      notes,
    };
  }
  if (ref.formation !== undefined) {
    const found = r.formation(ref.formation);
    if (!found) {
      return { reason: `${what}.formation ${JSON.stringify(ref.formation)} is not a formation this engine can stand up` };
    }
    return {
      start: {
        dancers: found.dancers,
        label: ref.name ?? found.label,
        sid: ref.sid ?? null,
        fid: ref.fid ?? null,
        aid: ref.aid ?? null,
      },
      notes: [],
    };
  }
  return { reason: `${what} needs one of "sid", "formation" or "dancers"` };
}

/** Resolve one step reference to the engine's step, by `vid` first and the name second. */
function resolveStepRef(
  ref: StepRefJson,
  r: SequenceResolvers,
  what: string,
  notes: string[],
): { step: string | CallStep } | { reason: string } {
  let call = ref.call;
  if (ref.vid !== undefined) {
    const found = r.variant(ref.vid);
    if (found) {
      if (call !== undefined && call.toLowerCase() !== found.title.toLowerCase()) {
        notes.push(`${what}: the name ${JSON.stringify(call)} is not the variant's title ${JSON.stringify(found.title)}`);
      }
      call = found.title;
    } else if (call === undefined) {
      return { reason: `${what}: vid ${JSON.stringify(ref.vid)} is not a variant this library holds, and there is no "call" to fall back on` };
    } else {
      notes.push(`${what}: vid ${JSON.stringify(ref.vid)} is not in this library, so the name was used`);
    }
  }
  if (call === undefined) return { reason: `${what} names no call` };
  return { step: ref.selection === undefined ? call : { selection: ref.selection, call } };
}

/**
 * Turn a parsed document into the board and steps the sequencer loads: the catalogue, the formation labels and the
 * variant library are consulted in the order the document's ids and names ask for, and everything tolerated is returned
 * in `notes` so the caller can say it out loud.
 */
export function resolveSequence(doc: SequenceDocJson, r: SequenceResolvers): SequenceResult {
  const startRead = resolveSetupRef(doc.start, r, 'start');
  if ('reason' in startRead) return { ok: false, reason: startRead.reason };
  const notes: string[] = [...startRead.notes];
  const steps: ModuleStep[] = [];
  for (const [i, raw] of doc.steps.entries()) {
    if (typeof raw === 'string') {
      steps.push(raw);
      continue;
    }
    if ('groups' in raw) {
      const lanes: GroupStep['groups'] = [];
      for (const [j, lane] of raw.groups.entries()) {
        const calls: string[] = [];
        for (const [k, c] of lane.calls.entries()) {
          if (typeof c === 'string') {
            calls.push(c);
            continue;
          }
          const read = resolveStepRef(c, r, `steps[${i}].groups[${j}].calls[${k}]`, notes);
          if ('reason' in read) return { ok: false, reason: read.reason };
          if (typeof read.step !== 'string') {
            return { ok: false, reason: `steps[${i}].groups[${j}].calls[${k}]: a lane's call cannot carry its own selection` };
          }
          calls.push(read.step);
        }
        lanes.push({ selection: lane.selection, calls });
      }
      steps.push({ groups: lanes });
      continue;
    }
    const read = resolveStepRef(raw, r, `steps[${i}]`, notes);
    if ('reason' in read) return { ok: false, reason: read.reason };
    steps.push(read.step);
  }
  return { ok: true, sequence: { start: startRead.start, steps, notes } };
}
