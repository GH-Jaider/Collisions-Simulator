// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { World, defaultParameters } from "../src/physics";
import { labs } from "../src/labs";
import type { Lab, LabHost } from "../src/labs";

const host: LabHost = {
  paused: false,
  pause() {},
  resume() {},
  rearm() {},
};

function labById(id: string): Lab {
  const found = labs.find((lab) => lab.id === id);
  if (!found) throw new Error(`No lab with id "${id}" — was it renamed?`);
  return found;
}

function build(lab: Lab, width: number, height: number): World {
  const world = new World(width, height, defaultParameters());
  lab.setup(world, host);
  return world;
}

function run(lab: Lab, world: World, seconds: number, dt = 1 / 120): void {
  const steps = Math.round(seconds / dt);
  for (let i = 0; i < steps; i++) {
    world.step(dt);
    lab.tick?.(world, dt, host);
  }
}

// Terminal aspect ratios that a real window actually produces, including a
// phone in portrait, since the labs size themselves from the box.
const SIZES: Array<[number, number]> = [
  [8, 3.4],
  [5, 3.2],
  [12, 4.2],
  [3.6, 2.2],
];

describe.each(labs)("$title", (lab) => {
  it.each(SIZES)("stays well behaved at %s × %s m", (width, height) => {
    const world = build(lab, width, height);
    expect(world.bodies.length).toBeGreaterThan(0);
    run(lab, world, 6);

    for (const body of world.bodies) {
      expect(Number.isFinite(body.position.x)).toBe(true);
      expect(Number.isFinite(body.position.y)).toBe(true);
      expect(Number.isFinite(body.velocity.x)).toBe(true);
      if (world.params.walls) {
        expect(body.position.x).toBeGreaterThan(-0.01);
        expect(body.position.x).toBeLessThan(width + 0.01);
        expect(body.position.y).toBeGreaterThan(-0.01);
        expect(body.position.y).toBeLessThan(height + 0.01);
      }
    }

    // Resting overlap is unavoidable with an impulse solver, but it has to
    // stay small enough that nobody can see it.
    let worst = 0;
    for (let i = 0; i < world.bodies.length; i++) {
      for (let j = i + 1; j < world.bodies.length; j++) {
        const a = world.bodies[i]!;
        const b = world.bodies[j]!;
        const reach = a.radius + b.radius;
        worst = Math.max(worst, (reach - a.position.distanceTo(b.position)) / reach);
      }
    }
    expect(worst).toBeLessThan(0.2);
  });

  it("builds panels without throwing", () => {
    const world = build(lab, 8, 4);
    const panels = lab.panels(world, host);
    expect(panels.length).toBeGreaterThan(0);
  });
});

describe("gas", () => {
  const gas = labById("gas");

  it("conserves energy exactly while perfectly elastic", () => {
    const world = build(gas, 6, 3.2);
    expect(world.conservative).toBe(true);
    run(gas, world, 15);
    expect(Math.abs(world.energyDrift ?? 1)).toBeLessThan(2e-3);
  });

  it("spreads one starting speed into a distribution", () => {
    // Every particle begins at the same speed; only collisions can broaden it.
    const world = build(gas, 6, 3.2);
    const before = world.speeds();
    const spreadBefore = deviation(before);
    expect(spreadBefore).toBeLessThan(1e-9);

    run(gas, world, 20);
    const after = world.speeds();
    // A Rayleigh distribution has a coefficient of variation of about 0.523.
    const ratio = deviation(after) / mean(after);
    expect(ratio).toBeGreaterThan(0.35);
    expect(ratio).toBeLessThan(0.7);
  });
});

describe("gravity", () => {
  const gravity = labById("gravity");

  it("holds its orbits circular", () => {
    // The whole point of the lab: launching at the circular-orbit speed for
    // the *softened* force has to actually produce a circle.
    const world = build(gravity, 8, 4.2);
    const star = world.bodies.find((body) => body.isStatic)!;
    const satellites = world.bodies.filter((body) => !body.isStatic);
    const launch = satellites.map((body) => body.position.distanceTo(star.position));

    run(gravity, world, 40, 1 / 120);

    let worst = 0;
    satellites.forEach((body, index) => {
      const now = body.position.distanceTo(star.position);
      worst = Math.max(worst, Math.abs(now - launch[index]!) / launch[index]!);
    });
    expect(worst).toBeLessThan(0.05);
    expect(Math.abs(world.energyDrift ?? 1)).toBeLessThan(0.02);
  });

  it("sends bodies off along the tangent when the field is cut", () => {
    // The claim the lab makes in so many words: with no force acting, a body
    // carries straight on along the tangent it already had. Almost everyone
    // expects it to fly radially outward instead, so this is worth pinning.
    // One satellite on one shell: a body cutting straight across a populated
    // system would eventually strike another, and a collision is precisely the
    // force this check is trying to rule out.
    const lab = gravity as unknown as { shells: number; perShell: number };
    const [shells, perShell] = [lab.shells, lab.perShell];
    lab.shells = 1;
    lab.perShell = 1;
    const world = build(gravity, 8, 4.2);
    lab.shells = shells;
    lab.perShell = perShell;

    const cut = gravity.toggles!(world, host).find((t) => t.id === "gravity")!;
    const star = world.bodies.find((body) => body.isStatic)!;
    const satellite = world.bodies.filter((body) => !body.isStatic)[0]!;

    run(gravity, world, 1.5);
    const cutPosition = satellite.position;
    const cutVelocity = satellite.velocity;
    const radial = cutPosition.sub(star.position).normalized();

    // In a circular orbit the velocity is perpendicular to the radius.
    expect(Math.abs(cutVelocity.normalized().dot(radial))).toBeLessThan(0.06);

    cut.set(false);
    // Walls off for this stretch: a body that bounces has had a force applied
    // to it, which is exactly what the check is trying to rule out.
    world.params.walls = false;
    run(gravity, world, 0.5);
    cut.set(true);

    const travelled = satellite.position.sub(cutPosition);
    // It went where its velocity was already pointing…
    expect(travelled.normalized().dot(cutVelocity.normalized())).toBeGreaterThan(0.999);
    // …and its speed never changed, because nothing acted on it.
    expect(satellite.speed).toBeCloseTo(cutVelocity.length, 6);
    // The distance from the star still grows — but only because a straight
    // line departs from a circle, not because anything pushed it outward.
    expect(satellite.position.distanceTo(star.position)).toBeGreaterThan(
      cutPosition.distanceTo(star.position),
    );
    expect(world.collisions).toBe(0);
  });

  it("scales the well strength without breaking the orbits", () => {
    const lab = gravity as unknown as { strength: number };
    for (const strength of [0.5, 1, 2]) {
      lab.strength = strength;
      const world = build(gravity, 8, 4.2);
      const star = world.bodies.find((body) => body.isStatic)!;
      const satellites = world.bodies.filter((body) => !body.isStatic);
      const launch = satellites.map((body) => body.position.distanceTo(star.position));

      run(gravity, world, 20);

      let worst = 0;
      satellites.forEach((body, index) => {
        const now = body.position.distanceTo(star.position);
        worst = Math.max(worst, Math.abs(now - launch[index]!) / launch[index]!);
      });
      expect(worst, `strength ${strength}`).toBeLessThan(0.05);
    }
    lab.strength = 1;
  });

  it("keeps orbits tidy at a test mass and loses them at a heavy one", () => {
    // The circular-orbit formula assumes the satellites are too light to
    // matter. This pins both halves of that: it holds where the assumption
    // holds, and visibly stops holding where it does not.
    const lab = gravity as unknown as { satelliteMass: number };
    const saved = lab.satelliteMass;

    const spread = (satelliteMass: number): number => {
      lab.satelliteMass = satelliteMass;
      const world = build(gravity, 8, 4.2);
      const star = world.bodies.find((body) => body.isStatic)!;
      const satellites = world.bodies.filter((body) => !body.isStatic);
      const launch = satellites.map((body) => body.position.distanceTo(star.position));
      run(gravity, world, 30);
      let worst = 0;
      satellites.forEach((body, index) => {
        const now = body.position.distanceTo(star.position);
        worst = Math.max(worst, Math.abs(now - launch[index]!) / launch[index]!);
      });
      return worst;
    };

    expect(spread(0.02)).toBeLessThan(0.05);
    expect(spread(5)).toBeGreaterThan(0.05);
    lab.satelliteMass = saved;
  });

  it("sizes the star from its mass", () => {
    const lab = gravity as unknown as { starMass: number };
    const saved = lab.starMass;
    const radiusAt = (mass: number): number => {
      lab.starMass = mass;
      const world = build(gravity, 8, 4.2);
      return world.bodies.find((body) => body.isStatic)!.radius;
    };
    expect(radiusAt(600)).toBeGreaterThan(radiusAt(80));
    lab.starMass = saved;
  });

  it("completes at least one full lap", () => {
    const world = build(gravity, 8, 4.2);
    const star = world.bodies.find((body) => body.isStatic)!;
    const inner = world.bodies.filter((body) => !body.isStatic)[0]!;
    const startAngle = inner.position.sub(star.position).angle;

    let travelled = 0;
    let previous = startAngle;
    for (let i = 0; i < 40 * 120; i++) {
      world.step(1 / 120);
      const angle = inner.position.sub(star.position).angle;
      let delta = angle - previous;
      while (delta > Math.PI) delta -= Math.PI * 2;
      while (delta < -Math.PI) delta += Math.PI * 2;
      travelled += Math.abs(delta);
      previous = angle;
    }
    expect(travelled).toBeGreaterThan(Math.PI * 2);
  });
});

describe("collisions", () => {
  const collisions = labById("collisions");

  it("records exactly one collision with the impulse the formula predicts", () => {
    const world = build(collisions, 8, 3.4);
    run(collisions, world, 3, 1 / 240);

    expect(world.log.length).toBeGreaterThanOrEqual(1);
    const record = world.log[0]!;
    const expected =
      ((1 + record.restitution) * record.approachSpeed) / (1 / record.a.mass + 1 / record.b.mass);
    expect(record.impulse).toBeCloseTo(expected, 6);
  });

  it("builds as many bodies as it is given, sized by their masses", () => {
    const lab = collisions as unknown as {
      specs: Array<{ mass: number; velocity: number; lane: number }>;
    };
    const saved = lab.specs;
    lab.specs = [
      { mass: 0.4, velocity: 3, lane: 0 },
      { mass: 1, velocity: 0, lane: 0 },
      { mass: 4, velocity: 0, lane: 0.3 },
      { mass: 8, velocity: -1, lane: -0.3 },
    ];
    const world = build(collisions, 8, 3.4);
    expect(world.bodies).toHaveLength(4);

    // Radius has to be monotonic in mass, or "heavier is bigger" is a lie.
    const bySpec = [...world.bodies].sort((a, b) => a.mass - b.mass);
    for (let i = 1; i < bySpec.length; i++) {
      expect(bySpec[i]!.radius).toBeGreaterThan(bySpec[i - 1]!.radius);
    }
    // And nothing may start already overlapping, whatever the sizes.
    for (let i = 0; i < world.bodies.length; i++) {
      for (let j = i + 1; j < world.bodies.length; j++) {
        const a = world.bodies[i]!;
        const b = world.bodies[j]!;
        expect(a.position.distanceTo(b.position)).toBeGreaterThanOrEqual(a.radius + b.radius - 1e-9);
      }
    }

    const momentum = world.totalMomentum;
    run(collisions, world, 4, 1 / 240);
    expect(world.totalMomentum.sub(momentum).length).toBeLessThan(1e-9);
    lab.specs = saved;
  });

  it("passes the impulse down a cradle to the far body alone", () => {
    // Five equal bodies touching, struck from one end: the classic result is
    // that the row stays put and only the last one leaves, at the incoming
    // speed. It is the sharpest test of the whole contact solver.
    const lab = collisions as unknown as {
      specs: Array<{ mass: number; velocity: number; lane: number }>;
    };
    const saved = lab.specs;
    lab.specs = Array.from({ length: 5 }, (_, index) => ({
      mass: 1,
      velocity: index === 0 ? 3 : 0,
      lane: 0,
    }));
    const world = build(collisions, 8, 3.4);
    run(collisions, world, 2.5, 1 / 240);

    const ordered = [...world.bodies].sort((a, b) => a.position.x - b.position.x);
    for (const body of ordered.slice(0, -1)) {
      expect(body.speed).toBeLessThan(1e-6);
    }
    expect(ordered[ordered.length - 1]!.velocity.x).toBeCloseTo(3, 6);
    lab.specs = saved;
  });

  it("conserves momentum whatever the restitution", () => {
    const lab = collisions as unknown as { restitution: number };
    for (const e of [0, 0.35, 0.8, 1]) {
      lab.restitution = e;
      const world = build(collisions, 8, 3.4);
      const before = world.totalMomentum;
      run(collisions, world, 2, 1 / 240);
      expect(world.totalMomentum.sub(before).length).toBeLessThan(1e-9);
    }
    lab.restitution = 1;
  });
});

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function deviation(values: number[]): number {
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}
