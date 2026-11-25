/**
 * GLSL for the scene. Every domino animates in the vertex shader from one time
 * uniform: its fall time and direction are per-instance attributes, so
 * scrubbing the timeline costs nothing on the CPU.
 */

/** Attribute locations shared by the domino programs (boxes, quads and points). */
export const ATTR = {
  corner: 0,
  normal: 1,
  pos: 2,
  yaw: 3,
  rest: 4,
  tag: 5,
  fall: 6,
  run: 7,
} as const;

export const MAX_KINDS = 24;

const HEADER = `#version 300 es
precision highp float;
`;

const FOG = `
uniform vec3 uEye;
uniform vec3 uFog;
uniform vec2 uFogRange; // x: distance where fog starts, y: density per metre
float fogFactor(float dist) {
  return exp(-max(dist - uFogRange.x, 0.0) * uFogRange.y);
}
`;

/** Per-domino inputs and the state derived from them, shared by all three levels of detail. */
const DOMINO = `
const float FALL_SECONDS = 0.22;
const float HALF_PI = 1.5707963;

uniform mat4 uViewProj;
uniform float uTime;     // simulation seconds
uniform float uFlashTau; // flash decay constant in simulation seconds
uniform vec3 uSize;      // thickness, width, height in metres
uniform vec3 uIvory;
uniform vec3 uAmber;
uniform vec3 uFlashColor;
uniform vec3 uArmColor[11];
uniform vec3 uKindStyle[${MAX_KINDS}]; // standing gain, fallen gain, glow when fallen

layout(location = ${ATTR.pos}) in vec3 aPos;   // foot centre, world metres
layout(location = ${ATTR.yaw}) in float aYaw;
layout(location = ${ATTR.rest}) in vec2 aRest; // lean once fallen (along, against), 1 = flat
layout(location = ${ATTR.tag}) in vec2 aTag;   // arm (10 = shared), kind
layout(location = ${ATTR.fall}) in float aFall; // fall time in seconds, huge if standing
layout(location = ${ATTR.run}) in vec2 aRun;   // fall direction, tipped-starter flag

struct Domino {
  float ease;  // 0 standing .. 1 at rest
  float lean;  // current angle from vertical
  float flash; // 1 at the moment of falling, decaying
  float glow;  // how much the colour ignores lighting
  vec3 color;
};

Domino dominoState() {
  float since = uTime - aFall;
  float u = clamp(since / FALL_SECONDS, 0.0, 1.0);
  Domino d;
  d.ease = u * u; // accelerates like a fall, stops dead on landing
  float rest = aRun.x > 0.5 ? aRest.x : (aRun.x < -0.5 ? aRest.y : 1.0);
  d.lean = rest * HALF_PI * d.ease;
  d.flash = step(0.0, since) * exp(-max(since, 0.0) / uFlashTau);
  vec3 style = uKindStyle[int(aTag.y + 0.5)];
  d.color = mix(uIvory * style.x, uArmColor[int(aTag.x + 0.5)] * style.y, d.ease);
  d.glow = style.z * d.ease;
  // Starters tipped by the drawing stay lit.
  d.color = mix(d.color, uAmber, aRun.y * 0.92);
  d.glow = max(d.glow, aRun.y * 0.85);
  return d;
}
`;

/** Near and middle distance: a real box, or its broad face alone as a two-sided quad. */
export const SOLID_VS = `${HEADER}${DOMINO}${FOG}
uniform vec3 uLight;
layout(location = ${ATTR.corner}) in vec3 aCorner; // unit box corner, -0.5..0.5
layout(location = ${ATTR.normal}) in vec3 aNormal;
out vec3 vColor;
out vec3 vFlash;
out float vFog;

// Tip (along, up) by the angle whose cos/sin are given, about the foot edge at along = +half.
void tip(inout float along, inout float up, float half_, float c, float s) {
  float q = along - half_;
  along = q * c + up * s + half_;
  up = -q * s + up * c;
}

void main() {
  Domino d = dominoState();
  vec3 p = aCorner * uSize;
  p.z += 0.5 * uSize.z;
  vec3 n = aNormal;
  float c = cos(d.lean);
  float s = sin(d.lean);
  float dir = aRun.x;
  if (abs(dir) > 0.5) {
    // Falls along (+1) or against (-1) its heading.
    float along = p.x * dir;
    tip(along, p.z, 0.5 * uSize.x, c, s);
    p.x = along * dir;
    float nAlong = n.x * dir;
    tip(nAlong, n.z, 0.0, c, s);
    n.x = nAlong * dir;
  } else {
    // Knocked aside: tips over sideways and passes nothing on.
    float side = fract(aPos.x * 3.7 + aPos.y * 5.3) < 0.5 ? -1.0 : 1.0;
    float along = p.y * side;
    tip(along, p.z, 0.5 * uSize.y, c, s);
    p.y = along * side;
    float nAlong = n.y * side;
    tip(nAlong, n.z, 0.0, c, s);
    n.y = nAlong * side;
  }

  float cy = cos(aYaw);
  float sy = sin(aYaw);
  vec3 world = aPos + vec3(p.x * cy - p.y * sy, p.x * sy + p.y * cy, p.z);
  vec3 normal = vec3(n.x * cy - n.y * sy, n.x * sy + n.y * cy, n.z);
  gl_Position = uViewProj * vec4(world, 1.0);

  vec3 toEye = uEye - world;
  if (dot(normal, toEye) < 0.0) normal = -normal; // the quad is seen from both sides

  // Broad faces carry the colour; the thin edges stay closer to ivory.
  float broad = abs(aNormal.x);
  vec3 base = mix(mix(d.color, uIvory, 0.45 * (1.0 - d.glow)), d.color, broad);
  float key = max(dot(normal, uLight), 0.0);
  float sky = 0.5 + 0.5 * normal.z;
  // Standing dominoes darken towards the foot, which grounds them without shadows.
  float foot = mix(0.6, 1.0, smoothstep(-0.5, 0.3, aCorner.z));
  vec3 lit = base * (0.42 + 0.22 * sky + 0.6 * key) * mix(foot, 1.0, d.ease);
  vColor = mix(lit, base * 1.12, d.glow);
  vFog = fogFactor(length(toEye));
  vFlash = uFlashColor * d.flash;
}
`;

export const SOLID_FS = `${HEADER}
uniform vec3 uFog;
in vec3 vColor;
in vec3 vFlash;
in float vFog;
out vec4 outColor;
void main() {
  // The flash cuts through fog so a distant wavefront still reads.
  outColor = vec4(mix(uFog, vColor, vFog) + vFlash * (0.4 + 0.6 * vFog), 1.0);
}
`;

/** Far distance: one point per domino, blended so sub-pixel dominoes fade instead of shimmering. */
export const POINT_VS = `${HEADER}${DOMINO}${FOG}
uniform float uPixelsPerMetre;
uniform vec2 uPointSize; // apparent size in metres: standing, fallen
uniform float uThinning;  // this point stands for itself and this many minus one neighbours
out vec4 vColor;  // premultiplied
out vec3 vFlash;
out float vCore;  // fraction of the sprite that is the domino itself

void main() {
  Domino d = dominoState();
  vec2 heading = vec2(cos(aYaw), sin(aYaw)) * aRun.x;
  vec3 centre = aPos + vec3(heading * 0.45 * uSize.z * d.ease, uSize.z * (0.5 - 0.42 * d.ease));
  gl_Position = uViewProj * vec4(centre, 1.0);

  float apparent = mix(uPointSize.x, uPointSize.y, d.ease) * uPixelsPerMetre / max(gl_Position.w, 0.001);
  float core = max(apparent, 1.0);
  float halo = d.flash * max(2.2, 1.5 * apparent);
  float size = core + 2.0 * halo;
  gl_PointSize = size;
  vCore = core / size;

  // Below one pixel, coverage stands in for size; a thinned point carries its neighbours' share.
  float alpha = min(apparent * uThinning, 1.0);
  float fog = fogFactor(distance(uEye, centre));
  vec3 lit = d.color * mix(0.8, 1.0, max(d.ease, d.glow));
  vColor = vec4(mix(uFog, lit, fog) * alpha, alpha);
  vFlash = uFlashColor * d.flash * (0.4 + 0.6 * fog) * mix(0.55, 1.0, min(apparent, 1.0)) * sqrt(uThinning);
}
`;

export const POINT_FS = `${HEADER}
in vec4 vColor;
in vec3 vFlash;
in float vCore;
out vec4 outColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float inCore = step(max(abs(d.x), abs(d.y)), vCore);
  float glow = max(0.0, 1.0 - dot(d, d));
  outColor = vColor * inCore + vec4(vFlash * glow * glow, 0.0);
}
`;

export const GROUND_VS = `${HEADER}
uniform mat4 uViewProj;
uniform vec3 uCentre; // xy: where the quad is centred, z: its half-size
layout(location = 0) in vec2 aQuad;
out vec3 vWorld;
void main() {
  vWorld = vec3(uCentre.xy + aQuad * uCentre.z, 0.0);
  gl_Position = uViewProj * vec4(vWorld, 1.0);
}
`;

export const GROUND_FS = `${HEADER}${FOG}
uniform vec3 uGround;
uniform vec3 uField; // half-width, half-height of the machine, falloff distance
uniform vec2 uGridOrigin;
in vec3 vWorld;
out vec4 outColor;

// Anti-aliased grid lines every 'step' metres that fade out before they would shimmer.
float grid(vec2 w, float step_, float pixel) {
  vec2 g = w / step_;
  vec2 a = abs(fract(g - 0.5) - 0.5) / fwidth(g);
  float line = 1.0 - min(min(a.x, a.y), 1.0);
  return line * (1.0 - smoothstep(0.06 * step_, 0.3 * step_, pixel));
}

void main() {
  vec2 w = vWorld.xy - uGridOrigin;
  vec2 fw = fwidth(w);
  float pixel = max(fw.x, fw.y);
  float lines = max(0.45 * grid(w, 1.0, pixel), max(0.8 * grid(w, 10.0, pixel), grid(w, 100.0, pixel)));

  // A soft pool of light over the machine; the floor falls away into the dark around it.
  vec2 outside = max(abs(vWorld.xy) - uField.xy, 0.0);
  float pool = 1.0 - smoothstep(0.0, uField.z, length(outside));
  vec3 color = uGround * (0.5 + 0.5 * pool) + vec3(0.9, 0.95, 1.0) * lines * 0.045 * (0.3 + 0.7 * pool);
  outColor = vec4(mix(uFog, color, fogFactor(distance(uEye, vWorld))), 1.0);
}
`;

/** Stairs and bridge decks. */
export const STATIC_VS = `${HEADER}${FOG}
uniform mat4 uViewProj;
uniform vec3 uLight;
layout(location = 0) in vec3 aCorner;
layout(location = 1) in vec3 aNormal;
layout(location = 2) in vec3 aCentre;
layout(location = 3) in vec3 aHalf;
layout(location = 4) in float aYaw;
out vec3 vColor;
out float vFog;
void main() {
  vec3 p = aCorner * 2.0 * aHalf;
  float c = cos(aYaw);
  float s = sin(aYaw);
  vec3 world = aCentre + vec3(p.x * c - p.y * s, p.x * s + p.y * c, p.z);
  vec3 normal = vec3(aNormal.x * c - aNormal.y * s, aNormal.x * s + aNormal.y * c, aNormal.z);
  gl_Position = uViewProj * vec4(world, 1.0);
  float key = max(dot(normal, uLight), 0.0);
  vColor = vec3(0.17, 0.18, 0.21) * (0.45 + 0.25 * normal.z + 0.6 * key);
  vFog = fogFactor(distance(uEye, world));
}
`;

export const STATIC_FS = `${HEADER}
uniform vec3 uFog;
in vec3 vColor;
in float vFog;
out vec4 outColor;
void main() {
  outColor = vec4(mix(uFog, vColor, vFog), 1.0);
}
`;

/** Digit labels painted on the floor, turned to stay upright for the viewer. */
export const LABEL_VS = `${HEADER}${FOG}
uniform mat4 uViewProj;
uniform float uTurn;
uniform vec3 uArmColor[11];
uniform float uWinner; // digit to brighten, or -1
layout(location = 0) in vec2 aQuad;  // -1..1
layout(location = 1) in vec4 aLabel; // x, y, half-size, digit
out vec2 vUv;
out vec4 vColor;
void main() {
  float c = cos(uTurn);
  float s = sin(uTurn);
  vec2 offset = vec2(aQuad.x * c - aQuad.y * s, aQuad.x * s + aQuad.y * c) * aLabel.z;
  vec3 world = vec3(aLabel.xy + offset, 0.0);
  gl_Position = uViewProj * vec4(world, 1.0);
  float digit = aLabel.w;
  vUv = (vec2(mod(digit, 5.0), floor(digit / 5.0)) + vec2(0.5 + 0.5 * aQuad.x, 0.5 - 0.5 * aQuad.y)) / vec2(5.0, 2.0);
  float strength = digit == uWinner ? 1.0 : 0.7;
  vColor = vec4(uArmColor[int(digit + 0.5)], strength * fogFactor(distance(uEye, world)));
}
`;

export const LABEL_FS = `${HEADER}
uniform sampler2D uAtlas;
in vec2 vUv;
in vec4 vColor;
out vec4 outColor;
void main() {
  float ink = texture(uAtlas, vUv).r * vColor.a;
  outColor = vec4(vColor.rgb * ink, ink);
}
`;
