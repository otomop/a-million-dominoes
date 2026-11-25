/**
 * An orbit camera over the ground plane. World space is metres with x east,
 * y north, z up; at azimuth 0 the camera sits south of its target looking
 * north, so a top-down view has north up and x increasing to the right.
 */

export interface Pose {
  /** Ground point the camera looks at. */
  x: number;
  y: number;
  /** Distance from the target to the camera. */
  dist: number;
  /** Rotation about the vertical, anticlockwise seen from above. */
  az: number;
  /** Height angle above the ground: 0 is level, pi/2 is straight down. */
  el: number;
}

export type Vec3 = [number, number, number];

export interface View {
  /** Column-major world -> clip matrix. */
  viewProj: Float32Array;
  eye: Vec3;
  right: Vec3;
  up: Vec3;
  forward: Vec3;
  /** Six frustum planes (a, b, c, d), pointing inwards. */
  planes: Float32Array;
  /** Screen pixels covered by one metre at a distance of one metre. */
  pixelsPerMetre: number;
  tanHalfFov: number;
  aspect: number;
  /** Where the camera's centre sits on screen, in NDC (see Framing). */
  shift: [number, number];
  pose: Pose;
}

/**
 * How the scene is framed on a screen partly covered by panels: the camera's
 * centre is shifted to the middle of the free area, and anything that must fit
 * is fitted to that area rather than to the whole viewport.
 */
export interface Framing {
  /** Viewport width / height. */
  aspect: number;
  /** Centre of the free area in NDC (-1..1), relative to the viewport centre. */
  shiftX: number;
  shiftY: number;
  /** Share of the viewport's width and height that is free. */
  freeWidth: number;
  freeHeight: number;
}

export const FOV_Y = (38 * Math.PI) / 180;
export const MIN_ELEVATION = 0.07;
export const MAX_ELEVATION = Math.PI / 2 - 0.004;
export const MIN_DISTANCE = 0.35;

export interface Limits {
  /** Half-extents (metres) of the rectangle the target must stay in. */
  halfWidth: number;
  halfHeight: number;
  maxDistance: number;
}

export function clampPose(pose: Pose, limits: Limits): Pose {
  return {
    x: Math.min(limits.halfWidth, Math.max(-limits.halfWidth, pose.x)),
    y: Math.min(limits.halfHeight, Math.max(-limits.halfHeight, pose.y)),
    dist: Math.min(limits.maxDistance, Math.max(MIN_DISTANCE, pose.dist)),
    az: pose.az,
    el: Math.min(MAX_ELEVATION, Math.max(MIN_ELEVATION, pose.el)),
  };
}

/** Distance at which a circle of the given radius fills the shorter side of the free area. */
export function distanceToFit(radius: number, framing: Framing): number {
  const tanHalf = Math.tan(FOV_Y / 2);
  return radius / (tanHalf * Math.min(framing.freeHeight, framing.aspect * framing.freeWidth));
}

export function computeView(
  pose: Pose,
  framing: Framing,
  viewportHeight: number,
  sceneRadius: number,
): View {
  const { aspect } = framing;
  const { x, y, dist, az, el } = pose;
  const sinAz = Math.sin(az);
  const cosAz = Math.cos(az);
  const sinEl = Math.sin(el);
  const cosEl = Math.cos(el);

  const forward: Vec3 = [-sinAz * cosEl, cosAz * cosEl, -sinEl];
  const right: Vec3 = [cosAz, sinAz, 0];
  const up: Vec3 = [-sinAz * sinEl, cosAz * sinEl, cosEl];
  const eye: Vec3 = [x - forward[0] * dist, y - forward[1] * dist, -forward[2] * dist];

  const tanHalfFov = Math.tan(FOV_Y / 2);
  const near = Math.max(0.02, dist * 0.04);
  const far = dist + sceneRadius * 2.5 + 400;
  const f = 1 / tanHalfFov;
  const nf = 1 / (near - far);

  // viewProj = perspective * view, written out so no matrix library is needed.
  // View rows are right, up, -forward.
  const tx = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]);
  const ty = -(up[0] * eye[0] + up[1] * eye[1] + up[2] * eye[2]);
  const tz = forward[0] * eye[0] + forward[1] * eye[1] + forward[2] * eye[2];
  const px = f / aspect;
  const pz = (far + near) * nf;
  const pw = 2 * far * near * nf;
  const m = new Float32Array(16);
  for (let c = 0; c < 3; c++) {
    m[c * 4 + 0] = px * right[c];
    m[c * 4 + 1] = f * up[c];
    m[c * 4 + 2] = pz * -forward[c];
    m[c * 4 + 3] = forward[c];
  }
  m[12] = px * tx;
  m[13] = f * ty;
  m[14] = pz * tz + pw;
  m[15] = -tz;
  // Lens shift: slide the image so the camera's centre lands mid free area.
  for (let c = 0; c < 4; c++) {
    m[c * 4] += framing.shiftX * m[c * 4 + 3];
    m[c * 4 + 1] += framing.shiftY * m[c * 4 + 3];
  }

  return {
    viewProj: m,
    eye,
    right,
    up,
    forward,
    planes: frustumPlanes(m),
    pixelsPerMetre: viewportHeight / (2 * tanHalfFov),
    tanHalfFov,
    aspect,
    shift: [framing.shiftX, framing.shiftY],
    pose,
  };
}

/** Gribb-Hartmann plane extraction from a column-major clip matrix. */
function frustumPlanes(m: Float32Array): Float32Array {
  const planes = new Float32Array(24);
  const row = (r: number): number[] => [m[r], m[4 + r], m[8 + r], m[12 + r]];
  const w = row(3);
  const sources = [row(0), row(1), row(2)];
  for (let axis = 0; axis < 3; axis++) {
    for (let side = 0; side < 2; side++) {
      const sign = side === 0 ? 1 : -1;
      const base = (axis * 2 + side) * 4;
      for (let k = 0; k < 4; k++) planes[base + k] = w[k] + sign * sources[axis][k];
    }
  }
  return planes;
}

/** True if the axis-aligned box (6 floats at `offset`) is at least partly inside the frustum. */
export function boxInFrustum(planes: Float32Array, box: Float32Array, offset: number): boolean {
  for (let p = 0; p < 24; p += 4) {
    const a = planes[p];
    const b = planes[p + 1];
    const c = planes[p + 2];
    // Test the box corner furthest along the plane normal.
    const x = a >= 0 ? box[offset + 3] : box[offset];
    const y = b >= 0 ? box[offset + 4] : box[offset + 1];
    const z = c >= 0 ? box[offset + 5] : box[offset + 2];
    if (a * x + b * y + c * z + planes[p + 3] < 0) return false;
  }
  return true;
}

/** Where the ray through a screen point (NDC, -1..1) meets the ground, if it does. */
export function groundPoint(view: View, ndcX: number, ndcY: number): [number, number] | null {
  const sx = (ndcX - view.shift[0]) * view.tanHalfFov * view.aspect;
  const sy = (ndcY - view.shift[1]) * view.tanHalfFov;
  const dx = view.forward[0] + view.right[0] * sx + view.up[0] * sy;
  const dy = view.forward[1] + view.right[1] * sx + view.up[1] * sy;
  const dz = view.forward[2] + view.right[2] * sx + view.up[2] * sy;
  if (dz > -1e-4) return null; // looking at the sky
  const t = -view.eye[2] / dz;
  return [view.eye[0] + dx * t, view.eye[1] + dy * t];
}

/**
 * The camera itself: a pose that follows a goal pose like a critically damped
 * spring, so every move starts and ends smoothly whoever asked for it.
 */
export class OrbitCamera {
  pose: Pose;
  goal: Pose;
  /** Spring frequency in rad/s: high for direct manipulation, low for flights. */
  omega = 12;
  private velocity: Pose = { x: 0, y: 0, dist: 0, az: 0, el: 0 };

  constructor(
    initial: Pose,
    readonly limits: Limits,
  ) {
    this.pose = { ...initial };
    this.goal = { ...initial };
  }

  setGoal(goal: Pose, omega: number): void {
    this.goal = clampPose(goal, this.limits);
    this.omega = omega;
  }

  /** Jump to the goal without animation. */
  snap(): void {
    this.pose = { ...this.goal };
    this.velocity = { x: 0, y: 0, dist: 0, az: 0, el: 0 };
  }

  update(dt: number): void {
    // Take the short way round for azimuth.
    const turns = Math.round((this.goal.az - this.pose.az) / (2 * Math.PI));
    this.goal.az -= turns * 2 * Math.PI;

    const step = (key: keyof Pose, log = false): void => {
      const to = log ? Math.log(this.goal[key]) : this.goal[key];
      const from = log ? Math.log(this.pose[key]) : this.pose[key];
      // Closed form of x'' = w^2 (goal - x) - 2 w x', stable for any dt.
      const decay = Math.exp(-this.omega * dt);
      const c1 = from - to;
      const c2 = this.velocity[key] + this.omega * c1;
      const next = to + (c1 + c2 * dt) * decay;
      this.velocity[key] = (c2 - this.omega * (c1 + c2 * dt)) * decay;
      this.pose[key] = log ? Math.exp(next) : next;
    };
    step('x');
    step('y');
    step('dist', true);
    step('az');
    step('el');
  }
}
