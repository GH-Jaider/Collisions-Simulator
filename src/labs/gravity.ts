import { Body } from "../physics/body";
import { Vec2 } from "../physics/vec";
import type { World } from "../physics/world";
import { defaultParameters } from "../physics/world";
import type { Renderer } from "../render/renderer";
import { chartPanel } from "../ui/charts";
import { fixed, percent } from "../ui/format";
import { controlsPanel, metricsPanel, type Panel } from "../ui/panels";
import { seeded } from "./layout";
import { radiusForMass } from "./scale";
import type { Lab, LabHost, PointerState, Toggle } from "./types";

const SHELL_COLORS = ["#ffc861", "#45dd8b", "#4fe3d2", "#a98bff", "#ff5fa2"];
/**
 * Satellites default to near-massless, and it matters.
 *
 * At any appreciable mass they pull on *each other* as well as on the star,
 * and since neighbouring orbits have neighbouring periods those little tugs
 * accumulate every time two satellites pass. The shells shear apart within a
 * few laps and the tidy 1/r² demonstration turns into a chaotic scribble.
 * Keeping them light puts them in the test-particle limit, which is the regime
 * the circular-orbit formula describes in the first place -- but the slider
 * runs well past it on purpose, because watching the tidy picture fall apart
 * is the clearest way to see what that assumption was buying.
 */
const DEFAULT_SATELLITE_MASS = 0.02;
/**
 * A scaled gravitational constant. The real one would need planetary masses to
 * produce a visible orbit, so this is an honest model system rather than a
 * simulation of anything in particular: the 1/r² law is exact, the constant is
 * chosen so that an orbit both fits on a screen and takes long enough to watch.
 * At this value the innermost shell comes round in about a second and the
 * outermost takes four, which also puts Kepler's third law on display.
 */
const G = 0.07;

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
    is flat. That exchange <em>is</em> the orbit.</p>
    <h3>Cut the string</h3>
    <p>Switch <strong>gravity</strong> off mid-orbit. Almost everyone expects the satellites to
    fly outwards, away from the centre — and they do not. With no force acting, each one carries
    straight on along the <em>tangent</em> it already had, exactly as Newton's first law says.
    The orbit was never something pushing them out; it was gravity continuously bending a
    straight line.</p>
    <p>Turn it back on and they are captured again, though rarely onto the circle they left:
    they now arrive with the wrong speed for wherever they happen to be.</p>
    <h3>Give the satellites some weight</h3>
    <p>The circular-orbit formula quietly assumes the satellites are too light to matter. Push
    <strong>satellite mass</strong> up and watch that assumption fail: they begin pulling on
    each other as well as on the star, and because neighbouring orbits keep neighbouring time,
    those small tugs land in the same direction lap after lap until the shells shear apart. The
    <em>mass ratio</em> readout turns amber when you cross into that regime.</p>
    <p>Both masses drive the radii on screen, so a heavier body really is a bigger one.</p>`;

  shells = 4;
  perShell = 3;
  starMass = 260;
  satelliteMass = DEFAULT_SATELLITE_MASS;
  showVectors = false;

  showTrails = true;

  /** Whether the central attraction is switched on at all. */
  gravityOn = true;
  /** Multiplier on the gravitational constant, so the well can be tuned. */
  strength = 1;

  /** Seconds since gravity was cut, for the on-canvas explanation. */
  private sinceCut = 0;
  private random = seeded(7);
  /** Launch radius per satellite, so the panel can report orbital drift. */
  private launchRadii = new Map<number, number>();

  /** The constant actually handed to the solver. */
  private get effectiveG(): number {
    return this.gravityOn ? G * this.strength : 0;
  }

  /** Push the current gravity setting into the world, live. */
  private applyGravity(world: World): void {
    world.params.mutualGravity = this.effectiveG;
    // Changing the field changes what potential energy is measured against,
    // so the reference is re-taken; otherwise the drift readout would report
    // a jump that never physically happened.
    world.markReferenceEnergy();
  }

  setup(world: World, _host: LabHost): void {
    world.clear();
    world.params = defaultParameters({
      restitution: 0.85,
      wallRestitution: 1,
      mutualGravity: this.effectiveG,
      iterations: 8,
    });
    this.sinceCut = 0;
    this.random = seeded(7);
    this.launchRadii.clear();

    const centre = new Vec2(world.width / 2, world.height / 2);
    // One density for everything, so the drawn sizes carry the same
    // information the mass ratio does: at 360 to 1 the star really is about
    // seven times the radius, because that is what the cube root of 360 is.
    // Giving the satellites their own scale, as an earlier version did, made a
    // 2 kg satellite look like a companion star.
    const unit = Math.min(world.width, world.height);
    const density = unit * 0.0098;
    const starRadius = radiusForMass(this.starMass, density);
    // A test mass is a point particle; below a pixel or two it stops being
    // drawable, so the floor is a rendering necessity rather than a claim
    // about its size.
    const satelliteRadius = Math.max(unit * 0.012, radiusForMass(this.satelliteMass, density));

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
    // Clear of the star's surface with room to spare: an inner orbit that
    // grazes it looks like a mistake, and one bad step turns it into one.
    const inner = Math.max(starRadius * 1.75 + satelliteRadius * 2, span * 0.34);
    const softening = (starRadius + satelliteRadius) * 0.5;

    for (let shell = 0; shell < this.shells; shell++) {
      const distance = inner + ((span - inner) * shell) / Math.max(this.shells - 1, 1);
      // The circular speed for the *softened* force the integrator applies,
      // F = GMr/(r² + ε²)^{3/2}, not for a bare inverse square. Using the
      // textbook √(GM/r) here launches everything a few percent too fast and
      // quietly turns every orbit into an ellipse.
      const launchG = G * this.strength;
      const speed = Math.sqrt(
        (launchG * this.starMass * distance * distance) /
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
            mass: this.satelliteMass,
            color: SHELL_COLORS[shell % SHELL_COLORS.length]!,
          }),
        );
        this.launchRadii.set(satellite.id, distance);
      }
    }
    world.markReferenceEnergy();
  }

  tick(world: World, dt: number, _host: LabHost): void {
    if (world.params.mutualGravity !== this.effectiveG) this.applyGravity(world);
    this.sinceCut = this.gravityOn ? 0 : this.sinceCut + dt;
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
    if (this.showVectors || !this.gravityOn) {
      // With the force cut, the velocity arrows are the whole point: they show
      // each body leaving along the tangent it already had.
      for (const body of world.bodies) {
        if (body.isStatic) continue;
        renderer.drawVector(body.position, body.velocity, { color: body.color, scale: 0.09 });
      }
    }

    if (!this.gravityOn) {
      renderer.drawNote("gravity off · no force, so no curve", 12, 12, "#ffc861");
      if (this.sinceCut > 0.7) {
        renderer.drawNote(
          "each body leaves along its tangent, not outward from the centre",
          12,
          28,
          "#9494ab",
        );
      }
    }
  }

  toggles(world: World): Toggle[] {
    return [
      {
        id: "gravity",
        label: "gravity",
        get: () => this.gravityOn,
        set: (value) => {
          this.gravityOn = value;
          this.applyGravity(world);
        },
      },
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
        // Live rather than a rebuild: turning the well up and watching the
        // circles wind inwards is a better demonstration than being handed a
        // fresh set of circles at the new strength.
        label: `well strength <em>G</em>`,
        min: 0,
        max: 2.5,
        step: 0.05,
        get: () => this.strength,
        set: (value) => {
          this.strength = value;
          this.applyGravity(world);
        },
        format: (value) =>
          !this.gravityOn ? "off" : value === 0 ? "0.00 · none" : `${fixed(value, 2)}x`,
        ticks: ["none", "strong"],
      },
      {
        label: "central mass",
        unit: "kg",
        min: 40,
        max: 900,
        step: 10,
        get: () => this.starMass,
        set: (value) => {
          this.starMass = value;
          host.rearm();
        },
        format: (value) => String(Math.round(value)),
      },
      {
        label: "satellite mass",
        unit: "kg",
        min: 0.01,
        max: 6,
        step: 0.01,
        get: () => this.satelliteMass,
        set: (value) => {
          this.satelliteMass = value;
          host.rearm();
        },
        format: (value) =>
          value <= 0.05 ? `${fixed(value, 2)} · test mass` : fixed(value, 2),
        ticks: ["negligible", "they perturb"],
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
        label: "mass ratio",
        value: () => {
          const ratio = this.starMass / Math.max(this.satelliteMass, 1e-9);
          return ratio >= 1000 ? `${Math.round(ratio / 1000)}k : 1` : `${Math.round(ratio)} : 1`;
        },
        // Below roughly a hundred to one the satellites pull on each other
        // hard enough to shear the shells apart within a few laps.
        tone: () => (this.starMass / Math.max(this.satelliteMass, 1e-9) >= 100 ? "" : "warn"),
      },
      {
        label: "field",
        value: () =>
          !this.gravityOn || this.strength === 0 ? "off" : `1/r² · ${fixed(this.strength, 2)}x`,
        tone: () => (this.gravityOn && this.strength > 0 ? "" : "warn"),
      },
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
        // Only a verdict while a well is actually holding the orbits; with the
        // force cut, a growing radius is the expected result, not a fault.
        tone: () => (this.gravityOn && this.strength > 0 ? "good" : "muted"),
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
