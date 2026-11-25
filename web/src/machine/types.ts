/** Shapes of the machine file's JSON header (see docs/format.md) and of the decoded machine. */

export interface Rect {
  cx: number;
  cy: number;
  w: number;
  h: number;
  yaw: number;
}

/** A lane's picture panel: a contiguous range of dominoes and its rectangle in mm. */
export interface Panel extends Rect {
  first: number;
  count: number;
}

export interface Lane {
  digit: number;
  start: number;
  /** The lane's race time is this domino's fall tick plus `finishBias`. */
  finish: number;
  /** Ticks that make the ten lanes' finish times comparable; absent means 0. */
  finishBias?: number;
  /** Checkpoints in order along the lane; may be empty or missing. */
  marks?: number[];
  /** Falls only if this lane wins; without it the winner is the best race time. */
  win?: number | null;
  panel?: Panel;
}

export interface Arm {
  digit: number;
  angle: number;
  /** The lane runs from `outer` to `inner`. */
  inner: [number, number];
  outer: [number, number];
  /** Where the arm's big floor digit goes. */
  label: [number, number];
  width?: number;
  length?: number;
}

/** Totals for display. Every field is optional: older files have none of this. */
export interface Counts {
  dominoes?: number;
  edges?: number;
  starters?: number;
  byKind?: Record<string, number>;
  gates?: Record<string, number>;
}

export interface TourStop {
  name: string;
  x: number;
  y: number;
  r: number;
}

export interface Section {
  dtype: string;
  offset: number;
  count: number;
}

export interface Header {
  version: number;
  count: number;
  edges: number;
  units: { xy_mm: number; z_mm: number; tick_s: number };
  domino: { h: number; w: number; t: number };
  kinds: string[];
  sections: Record<string, Section>;
  model: { grid: number; thresholds: number[]; bits: number; layers?: number[] };
  lanes: Lane[];
  bounds: { minX: number; maxX: number; minY: number; maxY: number };
  timing?: Record<string, number>;
  layout: string;
  // Everything below is optional; the page copes without it.
  arms?: Arm[];
  hub?: { radius: number };
  counts?: Counts;
  /** The finish core and its gates, where the first lane home blocks the others. */
  arena?: Rect;
  /** The rectangle holding the picture panels. */
  stage?: Rect;
  tour?: TourStop[];
}

/**
 * Everything the automaton needs and nothing else, so it can be handed to a
 * worker. Slot `2i` is "domino i falls along its yaw", slot `2i + 1` is
 * "against its yaw"; `rowPtr[s] .. rowPtr[s + 1]` are the edges leaving slot s.
 */
export interface Graph {
  count: number;
  rowPtr: Uint32Array;
  dst: Int32Array;
  dly: Uint16Array;
  edir: Int8Array;
  pushIdx: Uint32Array;
  pushBit: Uint8Array;
  pushVal: Uint8Array;
  alwaysIdx: Uint32Array;
  alwaysTick: Int32Array;
}

/** What the page needs to draw the machine. Lengths in millimetres, angles in radians. */
export interface Scene {
  header: Header;
  count: number;
  x: Float32Array;
  y: Float32Array;
  yaw: Float32Array;
  /** Base height of each domino (stairs and bridge decks are above zero). */
  z0: Float32Array;
  arm: Uint8Array;
  kind: Uint8Array;
  /** Lean from vertical once fallen, per slot (2 per domino: along yaw, against yaw). */
  rest: Float32Array;
  /** Fixed boxes, 7 floats each: centre x, y, z, half-sizes x, y, z, yaw. */
  statics: Float32Array;
}

export interface Machine {
  scene: Scene;
  graph: Graph;
}

/** One run of the automaton. */
export interface SimResult {
  /** Tick at which each domino fell, or -1 if it is still standing. */
  fallTick: Int32Array;
  /** +1 fell along its yaw, -1 against it, 0 knocked aside (or standing). */
  fallDir: Int8Array;
  /** The fallen dominoes in the order they fell. */
  order: Uint32Array;
}

export const ARM_SHARED = 255;
