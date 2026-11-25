import { groundPoint, MIN_DISTANCE, type OrbitCamera, type View } from './camera';

/** Spring frequency while the visitor is steering: quick, but still damped. */
const USER_OMEGA = 14;
const ORBIT_RADIANS_PER_PIXEL = 0.0055;
const ZOOM_PER_WHEEL_PIXEL = 0.0013;

/**
 * Mouse: drag to orbit, right-drag or shift-drag to pan, wheel to zoom towards
 * the cursor. Touch: one finger orbits, two fingers pan and pinch.
 */
export class OrbitControls {
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private panning = false;

  constructor(
    private readonly element: HTMLElement,
    private readonly camera: OrbitCamera,
    private readonly currentView: () => View,
    private readonly onUserInput: () => void,
  ) {
    element.addEventListener('pointerdown', this.onPointerDown);
    element.addEventListener('pointermove', this.onPointerMove);
    element.addEventListener('pointerup', this.onPointerUp);
    element.addEventListener('pointercancel', this.onPointerUp);
    element.addEventListener('wheel', this.onWheel, { passive: false });
    element.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  private onPointerDown = (event: PointerEvent): void => {
    this.element.setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.panning = event.pointerType === 'mouse' && (event.button !== 0 || event.shiftKey);
    this.touch();
  };

  private onPointerUp = (event: PointerEvent): void => {
    this.pointers.delete(event.pointerId);
  };

  private onPointerMove = (event: PointerEvent): void => {
    const previous = this.pointers.get(event.pointerId);
    if (!previous) return;
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;

    if (this.pointers.size === 1) {
      if (this.panning) this.pan(dx, dy);
      else this.orbit(dx, dy);
    } else if (this.pointers.size === 2) {
      // Two fingers: the midpoint pans, the spread zooms.
      const other = [...this.pointers.entries()].find(([id]) => id !== event.pointerId)![1];
      const before = Math.hypot(previous.x - other.x, previous.y - other.y);
      const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
      this.pan(dx / 2, dy / 2);
      if (before > 0 && after > 0) {
        this.zoom(before / after, (event.clientX + other.x) / 2, (event.clientY + other.y) / 2);
      }
    }
    previous.x = event.clientX;
    previous.y = event.clientY;
    this.touch();
  };

  private onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const pixels = event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 32 : event.deltaY;
    this.zoom(Math.exp(pixels * ZOOM_PER_WHEEL_PIXEL), event.clientX, event.clientY);
    this.touch();
  };

  private orbit(dx: number, dy: number): void {
    const goal = this.camera.goal;
    this.camera.setGoal(
      {
        ...goal,
        az: goal.az - dx * ORBIT_RADIANS_PER_PIXEL,
        el: goal.el + dy * ORBIT_RADIANS_PER_PIXEL,
      },
      USER_OMEGA,
    );
  }

  /** Slide the floor with the pointer. */
  private pan(dx: number, dy: number): void {
    const goal = this.camera.goal;
    const view = this.currentView();
    const metresPerPixel = (2 * goal.dist * view.tanHalfFov) / this.element.clientHeight;
    const across = -dx * metresPerPixel;
    // Movement up the screen is foreshortened by the viewing angle.
    const ahead = (dy * metresPerPixel) / Math.max(0.25, Math.sin(goal.el));
    this.camera.setGoal(
      {
        ...goal,
        x: goal.x + Math.cos(goal.az) * across - Math.sin(goal.az) * ahead,
        y: goal.y + Math.sin(goal.az) * across + Math.cos(goal.az) * ahead,
      },
      USER_OMEGA,
    );
  }

  /** Scale the viewing distance, keeping the floor under the cursor where it is. */
  private zoom(factor: number, clientX: number, clientY: number): void {
    const goal = this.camera.goal;
    const { maxDistance } = this.camera.limits;
    const dist = Math.min(maxDistance, Math.max(MIN_DISTANCE, goal.dist * factor));
    const ratio = dist / goal.dist;
    const rect = this.element.getBoundingClientRect();
    const ndcX = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ndcY = 1 - ((clientY - rect.top) / rect.height) * 2;
    const anchor = groundPoint(this.currentView(), ndcX, ndcY);
    let { x, y } = goal;
    if (anchor && Math.hypot(anchor[0] - x, anchor[1] - y) < 4 * goal.dist) {
      x = anchor[0] + (x - anchor[0]) * ratio;
      y = anchor[1] + (y - anchor[1]) * ratio;
    }
    this.camera.setGoal({ ...goal, x, y, dist }, USER_OMEGA);
  }

  private touch(): void {
    this.onUserInput();
  }
}
