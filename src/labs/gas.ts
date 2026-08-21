import { Body } from "../physics/body";
import { Vec2 } from "../physics/vec";
import type { World } from "../physics/world";
import { defaultParameters } from "../physics/world";
import type { Renderer } from "../render/renderer";
import { chartPanel, histogramPanel } from "../ui/charts";
import { fixed, percent } from "../ui/format";
import { controlsPanel, metricsPanel, type Panel } from "../ui/panels";
import { bodyColor, theme } from "../render/theme";
import { scatter, seeded } from "./layout";
import type { Lab, LabHost, PointerState, Toggle } from "./types";

/**
 * A two-dimensional ideal gas.
 *
 * Every particle starts with exactly the same speed, which is not how any gas
 * ever looks. Collisions alone pull that single spike apart into the
 * Maxwell–Boltzmann distribution, and the curve drawn over the histogram is
 * not fitted to its shape — its one parameter comes from the total energy, so
 * the agreement is a prediction.
 */
export class GasLab implements Lab {
  readonly id = "gas";
  readonly title = "Gas and statistics";
  readonly blurb = "Every particle starts at the same speed. Collisions do the rest.";
  readonly worldHeight = 3.2;
  readonly interactive = true;

  readonly about = `
    <p>This is an ideal gas in two dimensions: hard discs that interact only on contact. They
    all start at the <em>same</em> speed in random directions — a completely artificial
    situation. Within seconds, purely by colliding with one another, the distribution of
    speeds broadens into the <strong>Maxwell–Boltzmann</strong> curve.</p>
    <h3>The curve is not fitted</h3>
    <p>In two dimensions the distribution is a Rayleigh: <em>f</em>(<em>v</em>) ∝
    <em>v</em>·exp(−<em>v</em>²/2σ²). Its single parameter σ follows from the mean square
    speed, which is in turn fixed by the total energy of the system. It is not fitted to the
    shape of the histogram: it is computed separately and drawn on top. That they agree is
    the result.</p>
    <h3>And the straight line</h3>
    <p>At restitution 1 with no friction, energy must be conserved <em>exactly</em>. The
    energy plot is the check: if the integrator were manufacturing or leaking energy, that
    line would bend. Lower the restitution and watch it fall.</p>`;

  particles = 140;
  speed = 2.6;
  restitution = 1;
  showTrails = false;

  private random = seeded(20250820);

  setup(world: World, _host: LabHost): void {
    world.clear();
    world.params = defaultParameters({
      restitution: this.restitution,
      wallRestitution: this.restitution,
      iterations: 8,
    });
    this.random = seeded(20250820);

    // Sized by area fraction rather than a fixed radius, so the box looks
    // equally full whether the window is a laptop or a wall.
    const area = world.width * world.height;
    const radius = Math.sqrt((0.16 * area) / (Math.PI * this.particles));
    const positions = scatter(this.particles, world.width, world.height, radius, this.random);

    positions.forEach((position, index) => {
      const angle = this.random() * Math.PI * 2;
      world.add(
        new Body({
          position,
          velocity: Vec2.fromPolar(this.speed, angle),
          radius,
          mass: 0.05,
          color: bodyColor(index),
        }),
      );
    });
    world.markReferenceEnergy();
  }

  tick(world: World, _dt: number, _host: LabHost): void {
    if (!this.showTrails) return;
    for (const body of world.bodies) {
      body.trail.push(body.position);
      if (body.trail.length > 26) body.trail.shift();
    }
  }

  annotate(renderer: Renderer, world: World, _pointer: PointerState): void {
    if (!this.showTrails) return;
    for (const body of world.bodies) renderer.drawTrail(body);
  }

  toggles(): Toggle[] {
    return [
      {
        id: "trails",
        label: "trails",
        get: () => this.showTrails,
        set: (value) => {
          this.showTrails = value;
          if (!value) return;
        },
      },
    ];
  }

  panels(world: World, host: LabHost): Panel[] {
    const controls = controlsPanel(
      "setup",
      [
        {
          label: "particles",
          min: 20,
          max: 320,
          step: 10,
          get: () => this.particles,
          set: (value) => {
            this.particles = value;
            host.rearm();
          },
          format: (value) => String(Math.round(value)),
        },
        {
          label: "initial speed",
          unit: "m/s",
          min: 0.5,
          max: 6,
          step: 0.1,
          get: () => this.speed,
          set: (value) => {
            this.speed = value;
            host.rearm();
          },
        },
        {
          label: `restitution <em>e</em>`,
          min: 0.8,
          max: 1,
          step: 0.005,
          get: () => this.restitution,
          set: (value) => {
            this.restitution = value;
            world.params.restitution = value;
            world.params.wallRestitution = value;
            world.markReferenceEnergy();
          },
          format: (value) => (value >= 0.999 ? "1.000 · elastic" : fixed(value, 3)),
          ticks: ["lossy", "lossless"],
        },
      ],
    );

    const state = metricsPanel("state", [
      { label: "particles", value: () => String(world.bodies.length) },
      { label: "collisions", value: () => world.collisions.toLocaleString("en") },
      { label: "elapsed", unit: "s", value: () => fixed(world.time, 1) },
      {
        label: `energy per particle`,
        unit: "mJ",
        value: () => fixed(world.measure().meanEnergy * 1000, 3),
      },
      {
        label: "energy drift",
        value: () => {
          const drift = world.energyDrift;
          return drift === null ? "—" : percent(drift, 4);
        },
        tone: () => {
          const drift = world.energyDrift;
          if (drift === null || !world.conservative) return "muted";
          return Math.abs(drift) < 1e-3 ? "good" : "warn";
        },
      },
    ]);

    const chart = chartPanel(
      "energy and momentum",
      [
        { label: "kinetic energy", color: () => theme().green, sample: () => world.kineticEnergy },
        { label: "|momentum|", color: () => theme().purple, sample: () => world.totalMomentum.length },
      ],
      { note: "flat at e=1" },
    );

    const distribution = histogramPanel("speed distribution", {
      values: () => world.speeds(),
      color: () => theme().cyan,
      theoryLabel: "Maxwell–Boltzmann",
      theory: () => {
        const speeds = world.speeds();
        if (speeds.length < 12) return null;
        // Uniform mass is what makes a single-species curve meaningful.
        const masses = new Set(world.bodies.map((body) => Math.round(body.mass * 1e6)));
        if (masses.size !== 1) return null;
        let meanSquare = 0;
        for (const value of speeds) meanSquare += value * value;
        meanSquare /= speeds.length;
        if (meanSquare <= 0) return null;
        const sigmaSq = meanSquare / 2;
        return (speed: number) => (speed / sigmaSq) * Math.exp(-(speed * speed) / (2 * sigmaSq));
      },
    });

    return [controls, state, chart, distribution];
  }
}
