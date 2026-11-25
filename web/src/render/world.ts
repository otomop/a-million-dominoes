import type { Header } from '../machine/types';

/**
 * World space: metres, x east, y north, z up, with the origin at the centre of
 * the machine's bounds (so 32-bit floats keep sub-millimetre precision).
 */
export interface World {
  /** Machine coordinates (mm) of the world origin. */
  originX: number;
  originY: number;
  /** Half-extents of the machine in metres. */
  halfWidth: number;
  halfHeight: number;
  /** Radius of the circle around the origin that contains the machine. */
  radius: number;
}

export function worldFromHeader(header: Header): World {
  const { minX, maxX, minY, maxY } = header.bounds;
  const halfWidth = (maxX - minX) / 2000;
  const halfHeight = (maxY - minY) / 2000;
  return {
    originX: (minX + maxX) / 2,
    originY: (minY + maxY) / 2,
    halfWidth,
    halfHeight,
    radius: Math.hypot(halfWidth, halfHeight),
  };
}

export const MM = 0.001;

export function worldX(world: World, mm: number): number {
  return (mm - world.originX) * MM;
}

export function worldY(world: World, mm: number): number {
  return (mm - world.originY) * MM;
}
