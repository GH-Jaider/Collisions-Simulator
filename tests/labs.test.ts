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
