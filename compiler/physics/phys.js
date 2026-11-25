// Rigid-body domino runner (Rapier 3D, WASM).  Reads a JSON list of scenes,
// writes per-domino first-fall times and directions.
// Scene units: millimetres, plane coordinates (x, y), base height z0.
// Sim units: mm * S with gravity scaled by the same factor, so time is real.
const R = require('@dimforge/rapier3d-compat');
const fs = require('fs');

const S = 0.01;                 // 48 mm -> 0.48 sim units
const G = 9.81 * 1000 * S;      // gravity in sim units / s^2 (time stays real)

function quatYaw(theta) {        // plane yaw theta -> rotation about +Y by -theta
  const phi = -theta;
  return { x: 0, y: Math.sin(phi / 2), z: 0, w: Math.cos(phi / 2) };
}
function rotY(q, v) {            // rotate vector v by quaternion q (general)
  // t = 2 q.xyz x v ; v' = v + w t + q.xyz x t
  const tx = 2 * (q.y * v.z - q.z * v.y), ty = 2 * (q.z * v.x - q.x * v.z), tz = 2 * (q.x * v.y - q.y * v.x);
  return { x: v.x + q.w * tx + (q.y * tz - q.z * ty),
           y: v.y + q.w * ty + (q.z * tx - q.x * tz),
           z: v.z + q.w * tz + (q.x * ty - q.y * tx) };
}

function runScene(sc) {
  const P = Object.assign({ h: 48, w: 24, t: 7.5, mu: 0.35, muGround: 0.5, rest: 0.05,
                            dt: 1 / 2000, T: 3.0, iters: 8, pushSpeed: 300, tiltDeg: 20,
                            density: 1.0 }, sc.params || {});
  const world = new R.World({ x: 0, y: -G, z: 0 });
  world.timestep = P.dt;
  world.numSolverIterations = P.iters;
  // ground
  const gb = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, -0.5, 0));
  world.createCollider(R.ColliderDesc.cuboid(1e4, 0.5, 1e4).setFriction(P.muGround).setRestitution(P.rest), gb);
  for (const st of (sc.statics || [])) {
    const b = world.createRigidBody(R.RigidBodyDesc.fixed()
      .setTranslation(st.cx * S, st.cz * S, st.cy * S).setRotation(quatYaw(st.yaw || 0)));
    world.createCollider(R.ColliderDesc.cuboid(st.hx * S, st.hz * S, st.hy * S)
      .setFriction(st.mu || P.muGround).setRestitution(P.rest), b);
  }
  const bodies = [];
  for (const d of sc.dominoes) {
    const h = d.h || P.h, w = d.w || P.w, t = d.t || P.t;
    const b = world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation(d.x * S, ((d.z0 || 0) + h / 2) * S, d.y * S)
      .setRotation(quatYaw(d.yaw)).setCcdEnabled(false));
    world.createCollider(R.ColliderDesc.cuboid(t / 2 * S, h / 2 * S, w / 2 * S)
      .setFriction(P.mu).setRestitution(P.rest).setDensity(P.density), b);
    bodies.push({ b, h, yaw: d.yaw });
  }
  const pushes = (sc.pushes || []).slice().sort((a, b) => a.t - b.t);
  const n = bodies.length;
  const fallT = new Array(n).fill(-1), fallDir = new Array(n).fill(null);
  const cosT = Math.cos(P.tiltDeg * Math.PI / 180);
  let pi = 0, time = 0;
  const steps = Math.round(P.T / P.dt);
  for (let s = 0; s < steps; s++) {
    while (pi < pushes.length && pushes[pi].t <= time + 1e-12) {
      const p = pushes[pi++]; const B = bodies[p.i];
      const yaw = B.yaw + (p.dir < 0 ? Math.PI : 0) + (p.dyaw || 0);
      const fx = Math.cos(yaw), fz = Math.sin(yaw);
      const om = (p.speed || P.pushSpeed) * S / (B.h * S);   // top speed / height
      B.b.setAngvel({ x: om * fz, y: 0, z: -om * fx }, true);
      const c = B.h / 2 * S * om;
      B.b.setLinvel({ x: c * fx, y: 0, z: c * fz }, true);
    }
    world.step();
    time += P.dt;
    if (s % 4 === 0) {
      for (let i = 0; i < n; i++) {
        if (fallT[i] >= 0) continue;
        const q = bodies[i].b.rotation();
        const up = rotY(q, { x: 0, y: 1, z: 0 });
        if (up.y < cosT) {
          fallT[i] = +time.toFixed(5);
          const l = Math.hypot(up.x, up.z) || 1;
          fallDir[i] = [+(up.x / l).toFixed(3), +(up.z / l).toFixed(3)];
        }
      }
    }
  }
  // final resting tilt (for debris checks)
  const finalUp = bodies.map(B => { const u = rotY(B.b.rotation(), { x: 0, y: 1, z: 0 }); return +u.y.toFixed(3); });
  world.free();
  return { fallT, fallDir, finalUp };
}

async function main() {
  await R.init();
  const scenes = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
  const out = scenes.map(runScene);
  fs.writeFileSync(process.argv[3], JSON.stringify(out));
}
main();
