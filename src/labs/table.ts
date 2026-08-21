import { Body } from "../physics/body";
import { Vec2 } from "../physics/vec";
import type { World } from "../physics/world";
import { defaultParameters } from "../physics/world";
import type { Renderer } from "../render/renderer";
import { fixed } from "../ui/format";
import { controlsPanel, metricsPanel, notePanel, type Panel } from "../ui/panels";
import { seeded } from "./layout";
import type { Lab, LabHost, PointerState, Toggle } from "./types";

const RACK_COLORS = [
  "#ffc861", "#4fe3d2", "#ff5fa2", "#a98bff", "#45dd8b",
  "#ff9f5f", "#6fa8ff", "#ff6b8f", "#cdfa54", "#c39bff",
  "#ffd873", "#5fd8e8", "#ff7a7a", "#8f7bff", "#5fe0a8",
];

/**
 * A pool break, and the sandbox where the pointer is allowed to interfere.
 *
 * Where the other labs are controlled experiments, this one exists to be
 * poked: friction and drag are on, so it behaves like a real table, and every
 * body can be picked up and thrown.
 */
export class TableLab implements Lab {
  readonly id = "table";
  readonly title = "Pool table";
  readonly blurb = "Friction, spin and rolling. Grab any ball and throw it.";
  readonly worldHeight = 2.2;
  readonly interactive = true;

  readonly about = `
    <p>A real table is neither elastic nor frictionless, and both are here. Restitution below
    1 takes energy out at every impact, <em>drag</em> stands in for the cloth, and contact
    friction applies a tangential impulse that creates <strong>spin</strong>.</p>
    <h3>Why the balls spin</h3>
    <p>Coulomb's law caps the tangential force at <em>μ</em> times the normal one. Below that
    limit the surfaces grip; past it, they slide. That tangential impulse exerts a torque
    about the centre, and the spin follows. The dark mark on each ball turns with it: without
    it, rolling and sliding look exactly the same.</p>
    <h3>To play</h3>
    <ul>
      <li><strong>Drag</strong> a ball to move it; releasing throws it.</li>
      <li>While held it is immovable, so it shoves the others instead of being shoved.</li>
      <li><strong>Drag from empty felt</strong> to catapult a new ball in.</li>
      <li><strong>Right-click</strong> a ball to remove it.</li>
    </ul>`;

  friction = 0.22;
  // Light enough that a break still has life in it after several seconds;
  // a real cloth is slower, but a table that stops dead is a table nobody
  // watches for long.
  drag = 0.16;
  restitution = 0.95;
  power = 4.2;

  private random = seeded(4);

  setup(world: World, _host: LabHost): void {
    world.clear();
    world.params = defaultParameters({
      restitution: this.restitution,
      wallRestitution: 0.86,
      friction: this.friction,
      drag: this.drag,
      restitutionThreshold: 0.12,
      iterations: 10,
    });
    this.random = seeded(4);

    const radius = Math.min(world.width, world.height) * 0.028;
    const gap = radius * 2.04;
    const apexX = world.width * 0.62;
    const midY = world.height * 0.5;

    let index = 0;
    for (let row = 0; row < 5; row++) {
      for (let slot = 0; slot <= row; slot++) {
        world.add(
          new Body({
            position: new Vec2(apexX + row * gap * 0.866, midY + (slot - row * 0.5) * gap),
            radius,
            mass: 0.17,
            color: RACK_COLORS[index % RACK_COLORS.length]!,
          }),
        );
        index++;
      }
    }

    world.add(
      new Body({
        position: new Vec2(world.width * 0.16, midY + (this.random() - 0.5) * 0.02),
        velocity: new Vec2(this.power, (this.random() - 0.5) * 0.05),
        radius,
        mass: 0.17,
        color: "#f2f2f8",
        label: "",
      }),
    );
    world.markReferenceEnergy();
  }

  annotate(renderer: Renderer, world: World, pointer: PointerState): void {
    if (pointer.held) {
      renderer.drawBody(pointer.held, { highlight: true });
    }
    void world;
  }

  toggles(): Toggle[] {
    return [];
  }

  panels(world: World, host: LabHost): Panel[] {
    const controls = controlsPanel("table", [
      {
        label: `friction <em>μ</em>`,
        min: 0,
        max: 0.6,
        step: 0.01,
        get: () => this.friction,
        set: (value) => {
          this.friction = value;
          world.params.friction = value;
        },
        ticks: ["ice", "rough"],
      },
      {
        label: "cloth drag",
        min: 0,
        max: 1.5,
        step: 0.05,
        get: () => this.drag,
        set: (value) => {
          this.drag = value;
          world.params.drag = value;
        },
        ticks: ["none", "slow"],
      },
      {
        label: `restitution <em>e</em>`,
        min: 0.5,
        max: 1,
        step: 0.01,
        get: () => this.restitution,
        set: (value) => {
          this.restitution = value;
          world.params.restitution = value;
        },
      },
      {
        label: "break power",
        unit: "m/s",
        min: 1,
        max: 8,
        step: 0.1,
        get: () => this.power,
        set: (value) => {
          this.power = value;
          host.rearm();
        },
      },
    ]);

    const state = metricsPanel("state", [
      { label: "balls", value: () => String(world.bodies.length) },
      { label: "collisions", value: () => world.collisions.toLocaleString("en") },
      { label: "energy", unit: "J", value: () => fixed(world.kineticEnergy, 3) },
      {
        label: "peak spin",
        unit: "rad/s",
        value: () => {
          let top = 0;
          for (const body of world.bodies) top = Math.max(top, Math.abs(body.spin));
          return fixed(top, 1);
        },
      },
    ]);

    const help = notePanel(
      "with the mouse",
      `<p class="inspector-empty">
        <strong>Drag</strong> a ball to move it; releasing throws it.<br />
        <strong>Drag empty felt</strong> to catapult a new ball in.<br />
        <strong>Right-click</strong> to remove one.
      </p>`,
    );

    return [controls, state, help];
  }
}
