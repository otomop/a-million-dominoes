import type { Scene } from '../machine/types';
import { MM, worldX, worldY, type World } from './world';

/**
 * The dominoes sorted into square ground tiles. Each tile is a contiguous
 * range of the sorted order, so a tile (or a run of neighbouring tiles) can be
 * culled and drawn with one call.
 */
export interface Tiles {
  /** Draw position -> domino index. */
  order: Uint32Array;
  count: number;
  start: Uint32Array;
  size: Uint32Array;
  /** Bounding boxes in world metres, 6 floats per tile: min x, y, z, max x, y, z. */
  box: Float32Array;
}

const TARGET_TILE_COUNT = 1200;
const MIN_TILE_METRES = 2.5;
/** A fallen domino reaches about its own height beyond its foot. */
const REACH_METRES = 0.06;

export function buildTiles(scene: Scene, world: World): Tiles {
  const n = scene.count;
  const width = world.halfWidth * 2;
  const height = world.halfHeight * 2;
  const tileSize = Math.max(MIN_TILE_METRES, Math.sqrt((width * height) / TARGET_TILE_COUNT));
  const cols = Math.max(1, Math.ceil(width / tileSize));
  const rows = Math.max(1, Math.ceil(height / tileSize));

  const cellOf = (i: number): number => {
    const cx = Math.min(
      cols - 1,
      Math.floor((worldX(world, scene.x[i]) + world.halfWidth) / tileSize),
    );
    const cy = Math.min(
      rows - 1,
      Math.floor((worldY(world, scene.y[i]) + world.halfHeight) / tileSize),
    );
    return Math.max(0, cy) * cols + Math.max(0, cx);
  };

  // Counting sort by cell keeps the original order inside each tile.
  const cellStart = new Uint32Array(cols * rows + 1);
  for (let i = 0; i < n; i++) cellStart[cellOf(i) + 1]++;
  for (let c = 0; c < cols * rows; c++) cellStart[c + 1] += cellStart[c];
  const cursor = cellStart.slice(0, cols * rows);
  const order = new Uint32Array(n);
  for (let i = 0; i < n; i++) order[cursor[cellOf(i)]++] = i;

  const used: number[] = [];
  for (let c = 0; c < cols * rows; c++) if (cellStart[c + 1] > cellStart[c]) used.push(c);

  const start = new Uint32Array(used.length);
  const size = new Uint32Array(used.length);
  const box = new Float32Array(used.length * 6);
  used.forEach((cell, t) => {
    start[t] = cellStart[cell];
    size[t] = cellStart[cell + 1] - cellStart[cell];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = 0;
    for (let k = start[t]; k < start[t] + size[t]; k++) {
      const i = order[k];
      const x = worldX(world, scene.x[i]);
      const y = worldY(world, scene.y[i]);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (scene.z0[i] > maxZ) maxZ = scene.z0[i];
    }
    box.set(
      [
        minX - REACH_METRES,
        minY - REACH_METRES,
        0,
        maxX + REACH_METRES,
        maxY + REACH_METRES,
        maxZ * MM + REACH_METRES,
      ],
      t * 6,
    );
  });

  return { order, count: used.length, start, size, box };
}
