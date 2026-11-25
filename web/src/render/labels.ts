import type { Scene } from '../machine/types';
import { worldX, worldY, type World } from './world';

/** A digit painted on the floor: centre and height in world metres. */
export interface Label {
  digit: number;
  x: number;
  y: number;
  size: number;
}

const CELL = 256;
const COLUMNS = 5;
const ROWS = 2;

/** The digits 0..9 in a 5x2 grid, white on black. */
export function digitAtlas(): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = CELL * COLUMNS;
  canvas.height = CELL * ROWS;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${CELL * 0.86}px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`;
  for (let digit = 0; digit < 10; digit++) {
    const cx = ((digit % COLUMNS) + 0.5) * CELL;
    const top = Math.floor(digit / COLUMNS) * CELL;
    // Centre on the actual ink box so every digit sits in the middle of its cell.
    const m = ctx.measureText(String(digit));
    const baseline = top + CELL / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    ctx.fillText(String(digit), cx, baseline);
  }
  return canvas;
}

/**
 * Where each digit's label goes: at `arms[].label` in the final layout,
 * otherwise just behind the lane's starter domino.
 */
export function layoutLabels(scene: Scene, world: World): Label[] {
  const { header } = scene;
  const size = Math.min(10, Math.max(2, 0.07 * world.radius));
  if (header.arms?.length) {
    return header.arms.map((arm) => ({
      digit: arm.digit,
      x: worldX(world, arm.label[0]),
      y: worldY(world, arm.label[1]),
      size,
    }));
  }
  return header.lanes.map((lane) => {
    const i = lane.start;
    const back = size * 0.8;
    return {
      digit: lane.digit,
      x: worldX(world, scene.x[i]) - Math.cos(scene.yaw[i]) * back,
      y: worldY(world, scene.y[i]) - Math.sin(scene.yaw[i]) * back,
      size,
    };
  });
}
