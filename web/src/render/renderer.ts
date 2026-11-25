import { boxInFrustum, type View } from '../camera/camera';
import type { Scene, SimResult } from '../machine/types';
import { ARM_SHARED } from '../machine/types';
import { boxAndQuad, BOX_VERTEX_COUNT, QUAD_VERTEX_COUNT } from './geometry';
import { createBuffer, createProgram, type Program } from './gl';
import { digitAtlas, layoutLabels } from './labels';
import { AMBER, ARM_COLORS, FOG, GROUND, IVORY, SHARED_COLOR } from './palette';
import {
  ATTR,
  GROUND_FS,
  GROUND_VS,
  LABEL_FS,
  LABEL_VS,
  MAX_KINDS,
  POINT_FS,
  POINT_VS,
  SOLID_FS,
  SOLID_VS,
  STATIC_FS,
  STATIC_VS,
} from './shaders';
import { buildTiles, type Tiles } from './tiles';
import { MM, worldX, worldY, type World } from './world';

/** Thrown when the browser cannot give us a WebGL2 context. */
export class WebGL2Unavailable extends Error {
  constructor() {
    super('WebGL2 is not available');
  }
}

/** What one frame cost, for the ?debug readout. */
export interface FrameStats {
  triangles: number;
  boxes: number;
  quads: number;
  points: number;
  drawCalls: number;
  tilesVisible: number;
}

const STATIC_STRIDE = 20; // x, y, z, yaw (float32) + rest along, rest against, arm, kind (uint8)
const RUN_STRIDE = 8; // fall time (float32) + direction (int8), tipped flag (uint8), 2 unused
const STANDING = 1e30;

/** A domino is drawn as a box when it is taller than this on screen, in pixels. */
const BOX_ABOVE_PX = 9;
/** ...as a single quad down to this height, and as a point below it. */
const QUAD_ABOVE_PX = 2.6;
/**
 * Far away, many dominoes share each pixel, so only every 2nd, 4th or 8th is
 * drawn (brighter, to keep the look): enough that neighbours in a line stay
 * within about half a pixel of each other. Lines are typically spaced at half
 * a domino's height.
 */
const POINT_THINNING = [1, 2, 4, 8];
const THINNED_SPACING_PX = 0.5;
const LEVELS = 2 + POINT_THINNING.length; // boxes, quads, then one per thinning
/** The flash fades over about 0.35 s of wall-clock time: three time constants. */
const FLASH_TAU_SECONDS = 0.35 / 3;

/** Close-ups fog as if seen from at least this far, so the rest of the machine stays in the picture. */
const FOG_MIN_REACH = 28;

const LIGHT: [number, number, number] = [-0.42, -0.5, 0.757];

const DOMINO_UNIFORMS = [
  'uViewProj',
  'uTime',
  'uFlashTau',
  'uSize',
  'uIvory',
  'uAmber',
  'uFlashColor',
  'uArmColor',
  'uKindStyle',
  'uEye',
  'uFog',
  'uFogRange',
  'uLight',
  'uPixelsPerMetre',
  'uPointSize',
  'uThinning',
] as const;
type DominoUniform = (typeof DOMINO_UNIFORMS)[number];

/** How each kind of domino looks: standing brightness, fallen brightness, glow when fallen. */
function kindStyles(kinds: string[]): Float32Array {
  const wiring = [0.8, 0.9, 0];
  const byName: Record<string, number[]> = {
    input: [1, 1, 0],
    lane: [1, 1.06, 0],
    'lane-start': [1, 1.06, 0],
    feeder: [0.95, 1, 0],
    arena: [1, 1.06, 0],
    // Lit and unlit pixels of a picture panel look alike until they topple.
    'panel-on': [0.9, 1.2, 1],
    'panel-off': [0.9, 0.13, 0],
  };
  const styles = new Float32Array(MAX_KINDS * 3);
  for (let k = 0; k < MAX_KINDS; k++) styles.set(byName[kinds[k]] ?? wiring, k * 3);
  return styles;
}

export class Renderer {
  readonly tiles: Tiles;
  readonly stats: FrameStats = {
    triangles: 0,
    boxes: 0,
    quads: 0,
    points: 0,
    drawCalls: 0,
    tilesVisible: 0,
  };
  /** Digit whose floor label is lit, or -1. */
  winner = -1;

  private readonly gl: WebGL2RenderingContext;
  private readonly solid: Program<DominoUniform>;
  private readonly point: Program<DominoUniform>;
  private readonly ground: Program<
    'uViewProj' | 'uCentre' | 'uEye' | 'uFog' | 'uFogRange' | 'uGround' | 'uField' | 'uGridOrigin'
  >;
  private readonly statics: Program<'uViewProj' | 'uEye' | 'uFog' | 'uFogRange' | 'uLight'>;
  private readonly label: Program<
    'uViewProj' | 'uEye' | 'uFog' | 'uFogRange' | 'uTurn' | 'uArmColor' | 'uWinner' | 'uAtlas'
  >;

  private readonly staticBuffer: WebGLBuffer;
  private readonly runBuffer: WebGLBuffer;
  private readonly solidVao: WebGLVertexArrayObject;
  private readonly pointVaos: WebGLVertexArrayObject[];
  private readonly groundVao: WebGLVertexArrayObject;
  private readonly staticsVao: WebGLVertexArrayObject;
  private readonly labelVao: WebGLVertexArrayObject;
  private readonly atlas: WebGLTexture;
  private readonly staticsCount: number;
  private readonly labelCount: number;
  private readonly kindStyle: Float32Array;
  private readonly armColors: Float32Array;
  private readonly size: [number, number, number];
  private readonly inputKind: number;
  private readonly runData: ArrayBuffer;

  // Per-frame scratch: runs of consecutive tiles (first, count pairs) at each level of detail.
  private readonly runs: number[][] = Array.from({ length: LEVELS }, () => []);

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly scene: Scene,
    private readonly world: World,
  ) {
    const gl = canvas.getContext('webgl2', {
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new WebGL2Unavailable();
    this.gl = gl;

    const { header } = scene;
    this.size = [header.domino.t * MM, header.domino.w * MM, header.domino.h * MM];
    this.inputKind = header.kinds.indexOf('input');
    this.kindStyle = kindStyles(header.kinds);
    this.armColors = new Float32Array([...ARM_COLORS.flat(), ...SHARED_COLOR]);

    this.solid = createProgram(gl, SOLID_VS, SOLID_FS, DOMINO_UNIFORMS);
    this.point = createProgram(gl, POINT_VS, POINT_FS, DOMINO_UNIFORMS);
    this.ground = createProgram(gl, GROUND_VS, GROUND_FS, [
      'uViewProj',
      'uCentre',
      'uEye',
      'uFog',
      'uFogRange',
      'uGround',
      'uField',
      'uGridOrigin',
    ]);
    this.statics = createProgram(gl, STATIC_VS, STATIC_FS, [
      'uViewProj',
      'uEye',
      'uFog',
      'uFogRange',
      'uLight',
    ]);
    this.label = createProgram(gl, LABEL_VS, LABEL_FS, [
      'uViewProj',
      'uEye',
      'uFog',
      'uFogRange',
      'uTurn',
      'uArmColor',
      'uWinner',
      'uAtlas',
    ]);

    this.tiles = buildTiles(scene, world);
    this.staticBuffer = createBuffer(gl, this.packStatic());
    this.runData = new ArrayBuffer(scene.count * RUN_STRIDE);
    this.runBuffer = gl.createBuffer()!;
    this.setRun(null, 1);

    const mesh = createBuffer(gl, boxAndQuad());
    const quad = createBuffer(gl, new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]));

    // Boxes and quads: one instance per domino. The instance pointers are
    // re-aimed for every run of tiles, because WebGL2 has no base instance.
    this.solidVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.solidVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
    gl.enableVertexAttribArray(ATTR.corner);
    gl.vertexAttribPointer(ATTR.corner, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(ATTR.normal);
    gl.vertexAttribPointer(ATTR.normal, 3, gl.FLOAT, false, 24, 12);
    for (const location of [ATTR.pos, ATTR.yaw, ATTR.rest, ATTR.tag, ATTR.fall, ATTR.run]) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribDivisor(location, 1);
    }

    // Points: the same buffers read as plain vertices, so any range is one
    // drawArrays. Reading them with a multiplied stride skips dominoes.
    this.pointVaos = POINT_THINNING.map((every) => {
      const vao = gl.createVertexArray()!;
      gl.bindVertexArray(vao);
      for (const location of [ATTR.pos, ATTR.yaw, ATTR.rest, ATTR.tag, ATTR.fall, ATTR.run]) {
        gl.enableVertexAttribArray(location);
      }
      this.aimInstances(0, every);
      return vao;
    });

    this.groundVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.groundVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Stairs and bridge decks, converted to world metres.
    const boxes = scene.statics.slice();
    this.staticsCount = boxes.length / 7;
    for (let k = 0; k < boxes.length; k += 7) {
      boxes[k] = worldX(world, boxes[k]);
      boxes[k + 1] = worldY(world, boxes[k + 1]);
      for (let j = 2; j < 6; j++) boxes[k + j] *= MM;
    }
    this.staticsVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.staticsVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 24, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 12);
    gl.bindBuffer(gl.ARRAY_BUFFER, createBuffer(gl, boxes));
    [3, 3, 1].forEach((components, k) => {
      gl.enableVertexAttribArray(2 + k);
      gl.vertexAttribPointer(2 + k, components, gl.FLOAT, false, 28, k * 12);
      gl.vertexAttribDivisor(2 + k, 1);
    });

    const labels = layoutLabels(scene, world);
    this.labelCount = labels.length;
    this.labelVao = gl.createVertexArray()!;
    gl.bindVertexArray(this.labelVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const labelData = new Float32Array(labels.flatMap((l) => [l.x, l.y, l.size / 2, l.digit]));
    gl.bindBuffer(gl.ARRAY_BUFFER, createBuffer(gl, labelData));
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);

    this.atlas = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, digitAtlas());
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  }

  /** The GPU's own name for itself, if the browser reveals it. */
  gpuName(): string {
    const gl = this.gl;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  }

  /** Block until the GPU has finished the frame (debug timing only). */
  finish(): void {
    this.gl.finish();
  }

  /** Upload one run's fall times and directions, or stand everything up again with null. */
  setRun(result: SimResult | null, tickSeconds: number): void {
    const { order } = this.tiles;
    const view = new DataView(this.runData);
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const tick = result ? result.fallTick[i] : -1;
      const at = k * RUN_STRIDE;
      view.setFloat32(at, tick < 0 ? STANDING : tick * tickSeconds, true);
      view.setInt8(at + 4, tick < 0 ? 0 : result!.fallDir[i]);
      view.setUint8(at + 5, tick === 0 && this.scene.kind[i] === this.inputKind ? 1 : 0);
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.runBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.runData, gl.DYNAMIC_DRAW);
  }

  /** Match the drawing buffer to the canvas's size on screen. Returns true if it changed. */
  resize(pixelRatio: number): boolean {
    const width = Math.max(1, Math.round(this.canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.round(this.canvas.clientHeight * pixelRatio));
    if (this.canvas.width === width && this.canvas.height === height) return false;
    this.canvas.width = width;
    this.canvas.height = height;
    return true;
  }

  /**
   * Draw one frame. `time` is simulation seconds; `speed` is simulation seconds
   * per wall-clock second, used to keep the flash the same length on screen.
   */
  render(view: View, time: number, speed: number): void {
    const gl = this.gl;
    const stats = this.stats;
    stats.triangles = stats.boxes = stats.quads = stats.points = stats.drawCalls = 0;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Fog is relative to the viewing distance, so it gives depth at every zoom
    // level without ever hiding what the camera is looking at.
    const reach = Math.max(view.pose.dist, FOG_MIN_REACH);
    const fogStart = 0.6 * reach;
    const fogDensity = 0.3 / reach;
    const common = (p: Program<'uViewProj' | 'uEye' | 'uFog' | 'uFogRange'>): void => {
      gl.useProgram(p.program);
      gl.uniformMatrix4fv(p.uniforms.uViewProj, false, view.viewProj);
      gl.uniform3fv(p.uniforms.uEye, view.eye);
      gl.uniform3fv(p.uniforms.uFog, FOG);
      gl.uniform2f(p.uniforms.uFogRange, fogStart, fogDensity);
    };

    // Floor, then the labels painted on it. Neither writes depth: everything else is above them.
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.BLEND);
    common(this.ground);
    gl.uniform3f(this.ground.uniforms.uCentre, view.pose.x, view.pose.y, 6000);
    gl.uniform3fv(this.ground.uniforms.uGround, GROUND);
    gl.uniform3f(
      this.ground.uniforms.uField,
      this.world.halfWidth,
      this.world.halfHeight,
      0.9 * this.world.radius,
    );
    gl.uniform2f(this.ground.uniforms.uGridOrigin, -this.world.halfWidth, -this.world.halfHeight);
    gl.bindVertexArray(this.groundVao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    common(this.label);
    gl.uniform1f(this.label.uniforms.uTurn, view.pose.az);
    gl.uniform3fv(this.label.uniforms.uArmColor, this.armColors);
    gl.uniform1f(this.label.uniforms.uWinner, this.winner);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.atlas);
    gl.uniform1i(this.label.uniforms.uAtlas, 0);
    gl.bindVertexArray(this.labelVao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.labelCount);
    gl.disable(gl.BLEND);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.enable(gl.CULL_FACE);

    if (this.staticsCount > 0) {
      common(this.statics);
      gl.uniform3fv(this.statics.uniforms.uLight, LIGHT);
      gl.bindVertexArray(this.staticsVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, BOX_VERTEX_COUNT, this.staticsCount);
      stats.triangles += this.staticsCount * 12;
      stats.drawCalls++;
    }

    this.chooseDetail(view);
    const flashTau = FLASH_TAU_SECONDS * Math.max(speed, 0.25);
    const dominoUniforms = (p: Program<DominoUniform>): void => {
      common(p);
      gl.uniform1f(p.uniforms.uTime, time);
      gl.uniform1f(p.uniforms.uFlashTau, flashTau);
      gl.uniform3fv(p.uniforms.uSize, this.size);
      gl.uniform3fv(p.uniforms.uIvory, IVORY);
      gl.uniform3fv(p.uniforms.uAmber, AMBER);
      gl.uniform3f(p.uniforms.uFlashColor, 1.0, 0.94, 0.8);
      gl.uniform3fv(p.uniforms.uArmColor, this.armColors);
      gl.uniform3fv(p.uniforms.uKindStyle, this.kindStyle);
      gl.uniform3fv(p.uniforms.uLight, LIGHT);
      gl.uniform1f(p.uniforms.uPixelsPerMetre, view.pixelsPerMetre);
      gl.uniform2f(p.uniforms.uPointSize, 0.03, 0.044);
    };

    const [boxRuns, quadRuns, ...pointRuns] = this.runs;
    if (boxRuns.length + quadRuns.length > 0) {
      dominoUniforms(this.solid);
      gl.bindVertexArray(this.solidVao);
      for (let r = 0; r < boxRuns.length; r += 2) {
        this.aimInstances(boxRuns[r]);
        gl.drawArraysInstanced(gl.TRIANGLES, 0, BOX_VERTEX_COUNT, boxRuns[r + 1]);
        stats.boxes += boxRuns[r + 1];
      }
      gl.disable(gl.CULL_FACE);
      for (let r = 0; r < quadRuns.length; r += 2) {
        this.aimInstances(quadRuns[r]);
        gl.drawArraysInstanced(gl.TRIANGLES, BOX_VERTEX_COUNT, QUAD_VERTEX_COUNT, quadRuns[r + 1]);
        stats.quads += quadRuns[r + 1];
      }
    }

    if (pointRuns.some((runs) => runs.length > 0)) {
      // Points blend (premultiplied) and leave depth alone; they are far away and near the floor.
      dominoUniforms(this.point);
      gl.enable(gl.BLEND);
      gl.depthMask(false);
      pointRuns.forEach((runs, level) => {
        if (runs.length === 0) return;
        const every = POINT_THINNING[level];
        gl.uniform1f(this.point.uniforms.uThinning, every);
        gl.bindVertexArray(this.pointVaos[level]);
        for (let r = 0; r < runs.length; r += 2) {
          // Vertex j of this array is domino j * every.
          const from = Math.ceil(runs[r] / every);
          const to = Math.ceil((runs[r] + runs[r + 1]) / every);
          gl.drawArrays(gl.POINTS, from, to - from);
          stats.points += to - from;
        }
        stats.drawCalls += runs.length / 2;
      });
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);

    stats.drawCalls += (boxRuns.length + quadRuns.length) / 2 + 2;
    stats.triangles += stats.boxes * 12 + stats.quads * 2 + 2 + this.labelCount * 2;
  }

  /** Cull tiles against the frustum and merge the survivors into runs per level of detail. */
  private chooseDetail(view: View): void {
    const { count, start, size, box } = this.tiles;
    const runs = this.runs;
    for (const run of runs) run.length = 0;
    const [ex, ey, ez] = view.eye;
    const heightPx = this.size[2] * view.pixelsPerMetre;
    let visible = 0;
    for (let t = 0; t < count; t++) {
      const o = t * 6;
      if (!boxInFrustum(view.planes, box, o)) continue;
      visible++;
      const dx = Math.max(box[o] - ex, 0, ex - box[o + 3]);
      const dy = Math.max(box[o + 1] - ey, 0, ey - box[o + 4]);
      const dz = Math.max(ez - box[o + 5], 0);
      const px = heightPx / Math.max(0.01, Math.hypot(dx, dy, dz));
      let level = px > BOX_ABOVE_PX ? 0 : px > QUAD_ABOVE_PX ? 1 : 2;
      if (level === 2) {
        const spacing = px / 2;
        while (level < LEVELS - 1 && spacing * POINT_THINNING[level - 1] <= THINNED_SPACING_PX) {
          level++;
        }
      }
      const run = runs[level];
      const last = run.length - 2;
      if (last >= 0 && run[last] + run[last + 1] === start[t]) run[last + 1] += size[t];
      else run.push(start[t], size[t]);
    }
    this.stats.tilesVisible = visible;
  }

  /**
   * Point the per-domino attributes of the bound vertex array at the range
   * starting at `first`, reading every `every`-th domino from there.
   */
  private aimInstances(first: number, every = 1): void {
    const gl = this.gl;
    const s = first * STATIC_STRIDE;
    const staticStride = STATIC_STRIDE * every;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.staticBuffer);
    gl.vertexAttribPointer(ATTR.pos, 3, gl.FLOAT, false, staticStride, s);
    gl.vertexAttribPointer(ATTR.yaw, 1, gl.FLOAT, false, staticStride, s + 12);
    gl.vertexAttribPointer(ATTR.rest, 2, gl.UNSIGNED_BYTE, true, staticStride, s + 16);
    gl.vertexAttribPointer(ATTR.tag, 2, gl.UNSIGNED_BYTE, false, staticStride, s + 18);
    const r = first * RUN_STRIDE;
    const runStride = RUN_STRIDE * every;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.runBuffer);
    gl.vertexAttribPointer(ATTR.fall, 1, gl.FLOAT, false, runStride, r);
    gl.vertexAttribPointer(ATTR.run, 2, gl.BYTE, false, runStride, r + 4);
  }

  /** Everything about a domino that never changes, in tile order. */
  private packStatic(): ArrayBuffer {
    const { scene, world } = this;
    const { order } = this.tiles;
    const data = new ArrayBuffer(scene.count * STATIC_STRIDE);
    const view = new DataView(data);
    const quarterTurn = Math.PI / 2;
    for (let k = 0; k < order.length; k++) {
      const i = order[k];
      const at = k * STATIC_STRIDE;
      view.setFloat32(at, worldX(world, scene.x[i]), true);
      view.setFloat32(at + 4, worldY(world, scene.y[i]), true);
      view.setFloat32(at + 8, scene.z0[i] * MM, true);
      view.setFloat32(at + 12, scene.yaw[i], true);
      view.setUint8(at + 16, Math.round((scene.rest[2 * i] / quarterTurn) * 255));
      view.setUint8(at + 17, Math.round((scene.rest[2 * i + 1] / quarterTurn) * 255));
      view.setUint8(at + 18, scene.arm[i] === ARM_SHARED ? 10 : Math.min(scene.arm[i], 10));
      view.setUint8(at + 19, Math.min(scene.kind[i], MAX_KINDS - 1));
    }
    return data;
  }
}
