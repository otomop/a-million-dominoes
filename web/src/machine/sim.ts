import type { Graph, SimResult } from './types';

/**
 * The domino automaton (docs/format.md, "The automaton"). A run is fully
 * determined by the input bits:
 *
 *  1. Seed a min-heap of events (tick, domino, dir) with the starters whose bit
 *     matches, then the always-tipped dominoes.
 *  2. Pop the earliest event; if its domino already fell, drop it. Otherwise
 *     the domino falls now, in that direction.
 *  3. Unless it was knocked aside (dir 0), schedule every edge leaving its slot
 *     whose target is still standing.
 *
 * Events with equal ticks are ordered by the heap's own layout, so the heap
 * must behave exactly like the reference (compiler/dominoes/eventsim.py):
 * sift-up while the parent is strictly greater; sift-down taking the left child
 * if strictly smaller, then the right child if strictly smaller than that.
 * Moving a "hole" instead of swapping gives the same array and is faster.
 */
export function simulate(graph: Graph, bits: ArrayLike<number>): SimResult {
  const { count, rowPtr, dst, dly, edir } = graph;
  const fallTick = new Int32Array(count).fill(-1);
  const fallDir = new Int8Array(count);
  const order = new Uint32Array(count);
  let fallen = 0;

  // Each edge is scheduled at most once, so this bounds the heap. An event's
  // domino and direction share one int: (domino << 2) | (dir + 1).
  const { heapTick, heapWho } = scratchFor(graph);
  let size = 0;

  const push = (tick: number, who: number): void => {
    let c = size++;
    while (c > 0) {
      const parent = (c - 1) >> 1;
      if (heapTick[parent] <= tick) break;
      heapTick[c] = heapTick[parent];
      heapWho[c] = heapWho[parent];
      c = parent;
    }
    heapTick[c] = tick;
    heapWho[c] = who;
  };

  const { pushIdx, pushBit, pushVal, alwaysIdx, alwaysTick } = graph;
  for (let k = 0; k < pushIdx.length; k++) {
    if ((bits[pushBit[k]] ? 1 : 0) === pushVal[k]) push(0, (pushIdx[k] << 2) | 2);
  }
  for (let k = 0; k < alwaysIdx.length; k++) push(alwaysTick[k], (alwaysIdx[k] << 2) | 2);

  while (size > 0) {
    const tick = heapTick[0];
    const who = heapWho[0];

    // Pop: move the last event to the root and sift it down.
    size--;
    const lastTick = heapTick[size];
    const lastWho = heapWho[size];
    let c = 0;
    for (;;) {
      const left = 2 * c + 1;
      const right = left + 1;
      let smallest = c;
      let smallestTick = lastTick;
      if (left < size && heapTick[left] < smallestTick) {
        smallest = left;
        smallestTick = heapTick[left];
      }
      if (right < size && heapTick[right] < smallestTick) smallest = right;
      if (smallest === c) break;
      heapTick[c] = heapTick[smallest];
      heapWho[c] = heapWho[smallest];
      c = smallest;
    }
    heapTick[c] = lastTick;
    heapWho[c] = lastWho;

    const domino = who >> 2;
    if (fallTick[domino] >= 0) continue; // already down: first hit wins
    const dir = (who & 3) - 1;
    fallTick[domino] = tick;
    fallDir[domino] = dir;
    order[fallen++] = domino;
    if (dir === 0) continue; // knocked aside: passes nothing on

    const slot = 2 * domino + (dir < 0 ? 1 : 0);
    for (let e = rowPtr[slot], end = rowPtr[slot + 1]; e < end; e++) {
      const target = dst[e];
      if (fallTick[target] >= 0) continue;
      push(tick + dly[e], (target << 2) | (edir[e] + 1));
    }
  }

  return { fallTick, fallDir, order: order.slice(0, fallen) };
}

interface Scratch {
  heapTick: Int32Array;
  heapWho: Int32Array;
}

// The heap is 14 MB for a million dominoes; keep one per graph between runs.
const scratch = new WeakMap<Graph, Scratch>();

function scratchFor(graph: Graph): Scratch {
  let s = scratch.get(graph);
  if (!s) {
    const capacity = graph.dst.length + graph.pushIdx.length + graph.alwaysIdx.length + 16;
    s = { heapTick: new Int32Array(capacity), heapWho: new Int32Array(capacity) };
    scratch.set(graph, s);
  }
  return s;
}
