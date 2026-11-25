import { laneFront, laneProgress, leadingLane, type RunInfo } from '../machine/run';
import type { Panel, Rect, Scene } from '../machine/types';
import { MM, worldX, worldY, type World } from '../render/world';
import { distanceToFit, FOV_Y, type Framing, type OrbitCamera, type Pose } from './camera';

/** Spring frequency for the director's flights: slow enough to read as camera work. */
const FLIGHT_OMEGA = 1.5;
const TOUR_OMEGA = 2.4;
const IDLE_ORBIT_RADIANS_PER_SECOND = 0.035;
const RUN_ORBIT_RADIANS_PER_SECOND = 0.012;
const OVERVIEW_ELEVATION = 0.82;
/** Breathing room around the machine in the overview. */
const OVERVIEW_ROOM = 1.1;

/** Stay wide for at least this share of the show, and at most that share. */
const WIDE_SHARE_MIN = 0.15;
const WIDE_SHARE_MAX = 0.25;
/** Head for the finish this long (simulation seconds) before the winner gets there. */
const FINISH_LEAD_SECONDS = 6;
/** Leave the finish for the winner's panel this long after the result. */
const FINISH_HOLD_SECONDS = 1.5;
/** Without a picture panel, pull back out this long after the result. */
const PULL_BACK_SECONDS = 3.5;
/** A lane must be this far ahead (share of the lane) to take the camera from the current leader... */
const LEAD_CHANGE_MARGIN = 0.012;
/** ...and the camera stays with a leader at least this long (wall-clock seconds). */
const LEAD_DWELL_SECONDS = 3;

/**
 * Flies the camera while a run plays: the whole field while the starters fire,
 * then the leading lane's wavefront, then the finish, and last the winner's
 * picture panel seen from the south with the machine behind it. Every shot is
 * a function of simulation time, so it follows the scrubber too. The visitor's
 * own camera input switches the director off until they press Follow.
 */
export class Director {
  enabled = true;
  private info: RunInfo | null = null;
  private leader: number | null = null;
  private sinceLeadChange = 0;
  private orbit = 0;
  private followFrom = 0;
  private readonly idleMotion: boolean;
  private readonly outline: Float32Array;

  constructor(
    private readonly camera: OrbitCamera,
    private readonly scene: Scene,
    private readonly world: World,
    reducedMotion: boolean,
  ) {
    this.idleMotion = !reducedMotion;
    this.outline = this.outlinePoints();
  }

  setRun(info: RunInfo | null): void {
    this.info = info;
    this.leader = null;
    this.enabled = true;
    if (info) {
      // Stay wide until the lanes are racing and most of the wiring has fired,
      // within limits: the wiring can keep firing for most of the run.
      const starts = info.lanes.map((l) => l.startTime).filter((t): t is number => t !== null);
      const racing = Math.max(starts.length ? Math.min(...starts) : 0, info.logicEnd);
      this.followFrom = Math.min(
        WIDE_SHARE_MAX * info.end,
        Math.max(WIDE_SHARE_MIN * info.end, racing),
      );
    }
  }

  /**
   * The whole machine from the given side, as close as it fits. The best side
   * to start from is the one that lines the machine's long side up with the screen's.
   */
  overview(framing: Framing, turn = 0): Pose {
    const el = OVERVIEW_ELEVATION;
    const tanAcross = Math.tan(FOV_Y / 2) * framing.aspect * framing.freeWidth;
    const tanUp = Math.tan(FOV_Y / 2) * framing.freeHeight;
    // The distance at which every outline point is inside the free area. For a
    // point p (relative to the target) the view needs |p.right| <= depth * tanAcross
    // and |p.up| <= depth * tanUp, where depth = dist + p.forward.
    const fit = (az: number): number => {
      const sin = Math.sin(az);
      const cos = Math.cos(az);
      let dist = 0;
      for (let k = 0; k < this.outline.length; k += 2) {
        const across = this.outline[k] * cos + this.outline[k + 1] * sin;
        const ahead = -this.outline[k] * sin + this.outline[k + 1] * cos;
        const forward = ahead * Math.cos(el);
        const up = ahead * Math.sin(el);
        dist = Math.max(
          dist,
          Math.abs(across) / tanAcross - forward,
          Math.abs(up) / tanUp - forward,
        );
      }
      return dist * OVERVIEW_ROOM;
    };
    // North stays up unless a quarter turn fits much better (a long machine on a tall screen).
    const base = fit(Math.PI / 2) < 0.7 * fit(0) ? Math.PI / 2 : 0;
    return { x: 0, y: 0, dist: fit(base + turn), az: base + turn, el };
  }

  /**
   * A few dozen points around the edge of the machine (world metres, x then y):
   * the furthest domino in each compass direction, plus the floor labels.
   */
  private outlinePoints(): Float32Array {
    const { scene, world } = this;
    const directions = 36;
    const best = new Float32Array(directions).fill(-Infinity);
    const points = new Float32Array(directions * 2);
    const unit = Array.from({ length: directions }, (_, d) => {
      const angle = (d / directions) * 2 * Math.PI;
      return [Math.cos(angle), Math.sin(angle)];
    });
    // Every eighth domino is plenty to find the edge of a machine this size.
    for (let i = 0; i < scene.count; i += 8) {
      const x = worldX(world, scene.x[i]);
      const y = worldY(world, scene.y[i]);
      for (let d = 0; d < directions; d++) {
        const reach = x * unit[d][0] + y * unit[d][1];
        if (reach > best[d]) {
          best[d] = reach;
          points[d * 2] = x;
          points[d * 2 + 1] = y;
        }
      }
    }
    const labels = (scene.header.arms ?? []).flatMap((arm) => [
      worldX(world, arm.label[0]),
      worldY(world, arm.label[1]),
    ]);
    return Float32Array.from([...points, ...labels]);
  }

  /** Fly to a place on the floor (world metres) and leave the camera with the visitor. */
  flyTo(x: number, y: number, radius: number, framing: Framing): void {
    this.enabled = false;
    const goal = this.camera.goal;
    this.camera.setGoal(
      { x, y, dist: distanceToFit(radius, framing) * 1.25, az: goal.az, el: 0.7 },
      TOUR_OMEGA,
    );
  }

  update(time: number, playing: boolean, wallSeconds: number, framing: Framing): void {
    if (!this.enabled) return;
    if (!this.info) {
      if (this.idleMotion) this.orbit += IDLE_ORBIT_RADIANS_PER_SECOND * wallSeconds;
      this.camera.setGoal(this.overview(framing, this.orbit), FLIGHT_OMEGA);
      return;
    }
    if (playing) this.orbit += RUN_ORBIT_RADIANS_PER_SECOND * wallSeconds;
    this.sinceLeadChange += wallSeconds;
    this.camera.setGoal(this.shot(this.info, time, framing), FLIGHT_OMEGA);
  }

  private shot(info: RunInfo, time: number, framing: Framing): Pose {
    const wide = this.overview(framing, this.orbit);
    if (time < this.followFrom) return wide;

    if (info.winner !== null && info.decidedAt !== null) {
      const { header } = this.scene;
      const lane = header.lanes[info.winner];
      const hasPanel = lane.panel !== undefined && info.panelFrom !== null;

      if (hasPanel && time >= info.decidedAt + FINISH_HOLD_SECONDS) {
        return this.closing(lane.panel!, framing);
      }
      if (time >= (info.coreAt ?? info.decidedAt) - FINISH_LEAD_SECONDS) {
        if (!hasPanel && time > info.decidedAt + PULL_BACK_SECONDS) return wide;
        if (header.arena) {
          // The finish core from above, north up, so lanes come in at the top
          // and the winning line leaves at the bottom towards its panel.
          return { ...this.centreOn(header.arena, framing, 1.3), az: header.arena.yaw, el: 0.95 };
        }
        return {
          x: worldX(this.world, this.scene.x[lane.finish]),
          y: worldY(this.world, this.scene.y[lane.finish]),
          dist: 9,
          az: this.chaseAzimuth(info.winner),
          el: 0.62,
        };
      }
    }

    // Follow the lane in front, changing subject only for a clear lead held for a while.
    const candidate = leadingLane(info, time);
    if (candidate !== null && candidate !== this.leader) {
      const current = this.leader === null ? -1 : laneProgress(info.lanes[this.leader], time);
      const ahead = laneProgress(info.lanes[candidate], time) > current + LEAD_CHANGE_MARGIN;
      if (this.leader === null || (ahead && this.sinceLeadChange > LEAD_DWELL_SECONDS)) {
        this.leader = candidate;
        this.sinceLeadChange = 0;
      }
    }
    const front = this.leader === null ? null : laneFront(info.lanes[this.leader], time);
    if (!front || this.leader === null) return wide;
    return {
      x: worldX(this.world, front[0]),
      y: worldY(this.world, front[1]),
      dist: Math.min(30, Math.max(14, 0.16 * this.world.radius)),
      az: this.chaseAzimuth(this.leader),
      el: 0.6,
    };
  }

  /**
   * The closing shot: low over the floor on the near side of the winner's
   * panel, looking across it at the machine. The panel's digit reads upright
   * from its local -y side (from the south, for a panel with yaw 0).
   */
  private closing(panel: Panel, framing: Framing): Pose {
    const up: [number, number] = [-Math.sin(panel.yaw), Math.cos(panel.yaw)];
    // Aim beyond the panel so it sits low in the frame, with the finish and the
    // arms above it; low enough to see them, high enough to read the digit.
    const beyond = 0.85 * panel.h;
    return {
      x: worldX(this.world, panel.cx + up[0] * beyond),
      y: worldY(this.world, panel.cy + up[1] * beyond),
      dist: distanceToFit(Math.max(panel.w, panel.h) * MM * 1.25, framing),
      az: panel.yaw,
      el: 0.46,
    };
  }

  /** Centre on a rectangle of the layout (machine mm) with some room around it. */
  private centreOn(rect: Rect, framing: Framing, room: number): Pose {
    return {
      x: worldX(this.world, rect.cx),
      y: worldY(this.world, rect.cy),
      dist: distanceToFit((Math.max(rect.w, rect.h) / 2) * MM * room, framing),
      az: 0,
      el: 0.8,
    };
  }

  /** Look along a lane's direction of travel, a little off to one side. */
  private chaseAzimuth(laneIndex: number): number {
    const { header } = this.scene;
    const lane = header.lanes[laneIndex];
    const arm = header.arms?.find((a) => a.digit === lane.digit);
    const from = arm ? arm.outer : [this.scene.x[lane.start], this.scene.y[lane.start]];
    const to = arm ? arm.inner : [this.scene.x[lane.finish], this.scene.y[lane.finish]];
    return Math.atan2(-(to[0] - from[0]), to[1] - from[1]) + 0.45;
  }
}
