/// <reference lib="webworker" />
import { simulate } from './sim';
import type { Graph } from './types';

/** Runs the automaton off the main thread. Messages: `init` with the graph, then `run` with bits. */
export type SimRequest =
  { type: 'init'; graph: Graph } | { type: 'run'; id: number; bits: Uint8Array };

export interface SimResponse {
  id: number;
  fallTick: Int32Array;
  fallDir: Int8Array;
  order: Uint32Array;
  /** Time the run took in the worker, in milliseconds. */
  elapsed: number;
}

const scope = self as unknown as DedicatedWorkerGlobalScope;
let graph: Graph | null = null;

scope.onmessage = (event: MessageEvent<SimRequest>) => {
  const message = event.data;
  if (message.type === 'init') {
    graph = message.graph;
    return;
  }
  if (!graph) throw new Error('Simulation worker used before init');
  const start = performance.now();
  const { fallTick, fallDir, order } = simulate(graph, message.bits);
  const response: SimResponse = {
    id: message.id,
    fallTick,
    fallDir,
    order,
    elapsed: performance.now() - start,
  };
  scope.postMessage(response, [fallTick.buffer, fallDir.buffer, order.buffer]);
};
