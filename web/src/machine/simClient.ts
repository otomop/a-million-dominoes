import { graphBuffers } from './loader';
import type { SimRequest, SimResponse } from './sim.worker';
import type { Graph, SimResult } from './types';

/** Main-thread handle on the simulation worker. */
export class SimClient {
  private readonly worker: Worker;
  private readonly pending = new Map<
    number,
    { resolve: (response: SimResponse) => void; reject: (reason: unknown) => void }
  >();
  private nextId = 1;

  /** Takes ownership of the graph: its arrays are transferred to the worker, not copied. */
  constructor(graph: Graph) {
    this.worker = new Worker(new URL('./sim.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (event: MessageEvent<SimResponse>) => {
      this.pending.get(event.data.id)?.resolve(event.data);
      this.pending.delete(event.data.id);
    };
    this.worker.onerror = (event) => {
      for (const { reject } of this.pending.values()) reject(new Error(event.message));
      this.pending.clear();
    };
    const init: SimRequest = { type: 'init', graph };
    this.worker.postMessage(init, graphBuffers(graph));
  }

  run(bits: Uint8Array): Promise<SimResult & { elapsed: number }> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      const request: SimRequest = { type: 'run', id, bits };
      this.worker.postMessage(request);
    });
  }
}
