import type { Graph, Header, Machine, Scene, Section } from './types';

const MAGIC = 0x31444d41; // "AMD1", little-endian

type TypedArrayConstructor<T> = new (buffer: ArrayBuffer, byteOffset: number, length: number) => T;

/**
 * Decode an uncompressed machine file. Every array in the result is a fresh
 * copy, so the 25 MB input buffer can be dropped afterwards.
 */
export function parseMachine(buffer: ArrayBuffer): Machine {
  const view = new DataView(buffer);
  if (buffer.byteLength < 8 || view.getUint32(0, true) !== MAGIC) {
    throw new Error('Not a machine file (bad magic)');
  }
  const headerLength = view.getUint32(4, true);
  const headerText = new TextDecoder().decode(new Uint8Array(buffer, 8, headerLength));
  const header = JSON.parse(headerText) as Header;
  if (header.version !== 1) throw new Error(`Unsupported machine version ${header.version}`);
  const blob = 8 + headerLength;

  const section = <T>(name: string, ctor: TypedArrayConstructor<T>, dtype: string): T => {
    const s: Section | undefined = header.sections[name];
    if (!s) throw new Error(`Machine file has no "${name}" section`);
    if (s.dtype !== dtype) throw new Error(`Section "${name}" is ${s.dtype}, expected ${dtype}`);
    return new ctor(buffer, blob + s.offset, s.count);
  };

  const n = header.count;
  const edges = header.edges;

  // Positions are delta-coded integers; the running sum is exact in a double.
  const dx = section('dx', Int32Array, 'int32');
  const dy = section('dy', Int32Array, 'int32');
  const x = new Float32Array(n);
  const y = new Float32Array(n);
  let ax = 0;
  let ay = 0;
  for (let i = 0; i < n; i++) {
    ax += dx[i];
    ay += dy[i];
    x[i] = ax * header.units.xy_mm;
    y[i] = ay * header.units.xy_mm;
  }

  const yawRaw = section('yaw', Int16Array, 'int16');
  const zRaw = section('z', Uint8Array, 'uint8');
  const yaw = new Float32Array(n);
  const z0 = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    yaw[i] = (yawRaw[i] * Math.PI) / 32768;
    z0[i] = zRaw[i] * header.units.z_mm;
  }

  // Hit graph: `deg` becomes a CSR offset array, `edst` becomes absolute targets.
  const deg = section('deg', Uint8Array, 'uint8');
  const edst = section('edst', Int32Array, 'int32');
  const rowPtr = new Uint32Array(2 * n + 1);
  const dst = new Int32Array(edges);
  let e = 0;
  for (let slot = 0; slot < 2 * n; slot++) {
    rowPtr[slot] = e;
    const source = slot >> 1;
    for (const end = e + deg[slot]; e < end; e++) dst[e] = edst[e] + source;
  }
  rowPtr[2 * n] = e;
  if (e !== edges) throw new Error('Machine file is inconsistent: deg does not sum to edges');

  // How far each domino leans once fallen: it rests on the next one in line.
  const thickness = header.domino.t;
  const rest = new Float32Array(2 * n);
  for (let slot = 0; slot < 2 * n; slot++) {
    if (rowPtr[slot + 1] === rowPtr[slot]) {
      rest[slot] = Math.PI / 2; // nothing to land on: flat on the floor
    } else {
      const i = slot >> 1;
      const j = dst[rowPtr[slot]];
      const d = Math.hypot(x[j] - x[i], y[j] - y[i]);
      rest[slot] = Math.acos(Math.min(1, Math.max(0, thickness / d)));
    }
  }

  const graph: Graph = {
    count: n,
    rowPtr,
    dst,
    dly: section('edly', Uint16Array, 'uint16').slice(),
    edir: section('edir', Int8Array, 'int8').slice(),
    pushIdx: section('pushIdx', Uint32Array, 'uint32').slice(),
    pushBit: section('pushBit', Uint8Array, 'uint8').slice(),
    pushVal: section('pushVal', Uint8Array, 'uint8').slice(),
    alwaysIdx: section('alwaysIdx', Uint32Array, 'uint32').slice(),
    alwaysTick: section('alwaysTick', Int32Array, 'int32').slice(),
  };

  const scene: Scene = {
    header,
    count: n,
    x,
    y,
    yaw,
    z0,
    arm: section('arm', Uint8Array, 'uint8').slice(),
    kind: section('kind', Uint8Array, 'uint8').slice(),
    rest,
    statics: section('statics', Float32Array, 'float32').slice(),
  };

  return { scene, graph };
}

/** Download the machine file and return its uncompressed bytes. */
export async function fetchMachineBytes(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Could not download the machine (${response.status})`);
  const bytes = await response.arrayBuffer();
  // Some hosts serve *.gz with Content-Encoding: gzip, in which case the
  // browser has already unpacked it; only gunzip when the gzip magic is there.
  const head = new Uint8Array(bytes, 0, 2);
  if (head[0] !== 0x1f || head[1] !== 0x8b) return bytes;
  const unpacked = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(unpacked).arrayBuffer();
}

/** The arrays of a graph, for transferring it to a worker. */
export function graphBuffers(graph: Graph): ArrayBuffer[] {
  return [
    graph.rowPtr,
    graph.dst,
    graph.dly,
    graph.edir,
    graph.pushIdx,
    graph.pushBit,
    graph.pushVal,
    graph.alwaysIdx,
    graph.alwaysTick,
  ].map((a) => a.buffer as ArrayBuffer);
}
