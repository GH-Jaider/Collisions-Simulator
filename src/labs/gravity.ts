import { Body } from "../physics/body";
import { Vec2 } from "../physics/vec";
import type { World } from "../physics/world";
import { defaultParameters } from "../physics/world";
import type { Renderer } from "../render/renderer";
import { chartPanel } from "../ui/charts";
import { fixed, percent } from "../ui/format";
import { controlsPanel, metricsPanel, type Panel } from "../ui/panels";
import { seeded } from "./layout";
import type { Lab, LabHost, PointerState, Toggle } from "./types";

const SHELL_COLORS = ["#ffc861", "#45dd8b", "#4fe3d2", "#a98bff", "#ff5fa2"];
/**
 * Satellites are near-massless on purpose.
 *
 * At any appreciable mass they pull on *each other* as well as on the star,
 * and since neighbouring orbits have neighbouring periods those little tugs
 * accumulate every time two satellites pass. The shells shear apart within a
 * few laps and the tidy 1/r^2 demonstration turns into a chaotic scribble.
 * Keeping them at a ten-thousandth of the central mass puts them in the
 * test-particle limit, which is the regime the circular-orbit formula
 * describes in the first place.
 */
const SATELLITE_MASS = 0.02;
/**
 * A scaled gravitational constant. The real one would need planetary masses to
 * produce a visible orbit, so this is an honest model system rather than a
 * simulation of anything in particular: the 1/r² law is exact, the constant is
 * chosen so that a orbit fits on a screen.
 */
const G = 0.9;

export class GravityLab implements Lab {
  readonly id = "gravity";
  readonly title = "Gravity well";
  readonly blurb = "Inverse-square attraction. Each satellite launches at exactly its circular-orbit speed.";
  readonly worldHeight = 4.2;
  readonly interactive = true;

  readonly about = `
    <p>Every pair of bodies attracts with a force proportional to
    <em>m</em><sub>1</sub><em>m</em><sub>2</sub>/<em>r</em>². For an orbit to be circular that
    force has to be exactly the centripetal force required, which fixes the speed:
    <em>v</em> = √(<em>GM</em>/<em>r</em>). The satellites launch at precisely that speed.</p>
    <h3>The softening trick</h3>
    <p>A pure 1/r² law runs off to infinity when two bodies graze each other, and a single
    integration step is enough to fling one clean out of the system. Here the force is
    <em>softened</em>: <em>r</em>² is replaced by <em>r</em>² + <em>ε</em>². That slightly
    changes the circular-orbit speed, and this lab uses the corrected formula — with the
    textbook one, every orbit would come out elliptical from a small systematic error.</p>
    <h3>What to look for</h3>
    <p>The energy plot. Kinetic and potential trade back and forth continuously, but their sum
    is flat. That exchange <em>is</em> the orbit.</p>`;

  shells = 4;
  perShell = 3;
  starMass = 260;
  showVectors = false;
  showTrails = true;

  private random = seeded(7);
  /** Launch radius per satellite, so the panel can report orbital drift. */
  private launchRadii = new Map<number, number>();

  setup(world: World, _host: LabHost): void {
    world.clear();
    world.params = defaultParameters({
      restitution: 0.85,
      wallRestitution: 1,
      mutualGravity: G,
      iterations: 8,
    });
    this.random = seeded(7);
    this.launchRadii.clear();

    const centre = new Vec2(world.width / 2, world.height / 2);
    const starRadius = Math.min(world.width, world.height) * 0.055;
    const satelliteRadius = Math.min(world.width, world.height) * 0.016;

    world.add(
      new Body({
        position: centre,
        radius: starRadius,
        mass: this.starMass,
        color: "#ffd873",
        isStatic: true,
        label: "★",
      }),
    );

    // An orbit that reaches the wall stops being an orbit at the first bounce,
    // so the outermost shell is kept clear of it.
    const span = Math.min(world.width, world.height) * 0.5 - satelliteRadius - 0.12;
    const inner = Math.max(starRadius + satelliteRadius * 4, span * 0.34);
    const softening = (starRadius + satelliteRadius) * 0.5;

    for (let shell = 0; shell < this.shells; shell++) {
      const distance = inner + ((span - inner) * shell) / Math.max(this.shells - 1, 1);
      // The circular speed for the *softened* force the integrator applies,
      // F = GMr/(r² + ε²)^{3/2}, not for a bare inverse square. Using the
      // textbook √(GM/r) here launches everything a few percent too fast and
      // quietly turns every orbit into an ellipse.
      const speed = Math.sqrt(
        (G * this.starMass * distance * distance) /
          Math.pow(distance * distance + softening * softening, 1.5),
      );
      const phase = this.random() * Math.PI * 2;
      for (let index = 0; index < this.perShell; index++) {
        const angle = phase + (index * Math.PI * 2) / this.perShell;
        const satellite = world.add(
          new Body({
            position: centre.add(Vec2.fromPolar(distance, angle)),
            velocity: Vec2.fromPolar(speed, angle + Math.PI / 2),
            radius: satelliteRadius,
            mass: SATELLITE_MASS,
            color: SHELL_COLORS[shell % SHELL_COLORS.length]!,
          }),
        );
        this.launchRadii.set(satellite.id, distance);
      }
    }
    world.markReferenceEnergy();
  }

  tick(world: World, _dt: number, _host: LabHost): void {
    if (!this.showTrails) return;
    for (const body of world.bodies) {
      if (body.isStatic) continue;
      body.trail.push(body.position);
      if (body.trail.length > 90) body.trail.shift();
    }
  }

  annotate(renderer: Renderer, world: World, _pointer: PointerState): void {
    if (this.showTrails) {
      for (const body of world.bodies) {
        if (!body.isStatic) renderer.drawTrail(body);
      }
      // Redrawn on top, because a hundred orbit segments otherwise cross the
      // star and turn it into a scribble.
      for (const body of world.bodies) {
        if (body.isStatic) renderer.drawBody(body);
      }
    }
    if (this.showVectors) {
      for (const body of world.bodies) {
        if (body.isStatic) continue;
        renderer.drawVector(body.position, body.velocity, { color: body.color, scale: 0.09 });
      }
    }
  }

  toggles(): Toggle[] {
    return [
      {
        id: "trails",
        label: "orbits",
        get: () => this.showTrails,
        set: (value) => {
          this.showTrails = value;
        },
      },
      {
        id: "vectors",
        label: "velocity",
        get: () => this.showVectors,
        set: (value) => {
          this.showVectors = value;
        },
      },
    ];
  }

  panels(world: World, host: LabHost): Panel[] {
    const controls = controlsPanel("setup", [
      {
        label: "central mass",
        unit: "kg",
        min: 80,
        max: 600,
        step: 10,
        get: () => this.starMass,
        set: (value) => {
          this.starMass = value;
          host.rearm();
        },
        format: (value) => String(Math.round(value)),
      },
      {
        label: "orbits",
        min: 1,
        max: 5,
        step: 1,
        get: () => this.shells,
        set: (value) => {
          this.shells = value;
          host.rearm();
        },
        format: (value) => String(Math.round(value)),
      },
      {
        label: "satellites per orbit",
        min: 1,
        max: 5,
        step: 1,
        get: () => this.perShell,
        set: (value) => {
          this.perShell = value;
          host.rearm();
        },
        format: (value) => String(Math.round(value)),
      },
    ]);

    const energy = chartPanel(
      "energy exchange",
      [
        { label: "kinetic", color: "#4fe3d2", sample: () => world.kineticEnergy },
        { label: "potential", color: "#ff5fa2", sample: () => world.potentialEnergy },
        { label: "total", color: "#45dd8b", sample: () => world.totalEnergy },
      ],
      { includeZero: false, note: "sum is flat" },
    );

    const state = metricsPanel("state", [
      { label: "satellites", value: () => String(world.bodies.length - 1) },
      {
        label: "radius deviation",
        value: () => {
          const star = world.bodies.find((body) => body.isStatic);
          if (!star || this.launchRadii.size === 0) return "—";
          let worst = 0;
          for (const body of world.bodies) {
            const launch = this.launchRadii.get(body.id);
            if (launch === undefined) continue;
            worst = Math.max(worst, Math.abs(body.position.distanceTo(star.position) - launch) / launch);
          }
          return `${fixed(worst * 100, 2)}%`;
        },
        tone: () => "good",
      },
      { label: "kinetic", unit: "J", value: () => fixed(world.kineticEnergy, 2) },
      { label: "potential", unit: "J", value: () => fixed(world.potentialEnergy, 2) },
      { label: "total", unit: "J", value: () => fixed(world.totalEnergy, 2) },
      {
        label: "drift",
        value: () => {
          const drift = world.energyDrift;
          return drift === null ? "—" : percent(drift, 4);
        },
        tone: () => {
          const drift = world.energyDrift;
          if (drift === null) return "muted";
          return Math.abs(drift) < 5e-3 ? "good" : "warn";
        },
      },
    ]);

    return [controls, energy, state];
  }
}
