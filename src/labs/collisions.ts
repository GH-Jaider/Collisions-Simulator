import { Body } from "../physics/body";
import { Vec2 } from "../physics/vec";
import { alpha } from "../render/color";
import type { CollisionRecord, World } from "../physics/world";
import { defaultParameters } from "../physics/world";
import type { Renderer } from "../render/renderer";
import { equationBlock, frac, num, op, v } from "../ui/equation";
import { fixed, percent, signed } from "../ui/format";
import { controlsPanel, customPanel, listPanel, metricsPanel, type Panel } from "../ui/panels";
import { bodyColor, theme } from "../render/theme";
import { radiusForMass } from "./scale";
import type { Lab, LabHost, PointerState, Toggle } from "./types";

/** Metres of arrow drawn per m/s of velocity. */
const VELOCITY_SCALE = 0.22;
const MAX_BODIES = 6;
const NAMES = "ABCDEF";

/** One body as the reader configured it, independent of any World. */
interface Spec {
  mass: number;
  /** Along x, in m/s. */
  velocity: number;
  /** Vertical position as a fraction of half the box height. */
  lane: number;
}

/** A named starting configuration, so the interesting cases are one click away. */
interface Preset {
  id: string;
  label: string;
  restitution: number;
  specs: Spec[];
}

const PRESETS: Preset[] = [
  {
    id: "pair",
    label: "pair",
    restitution: 1,
    specs: [
      { mass: 1, velocity: 3, lane: 0 },
      { mass: 2, velocity: -1, lane: 0 },
    ],
  },
  {
    id: "cradle",
    label: "cradle",
    restitution: 1,
    // Four at rest and touching, struck from the left. The impulse crosses the
    // row and only the far one leaves -- Newton's cradle, without the string.
    specs: [
      { mass: 1, velocity: 3, lane: 0 },
      { mass: 1, velocity: 0, lane: 0 },
      { mass: 1, velocity: 0, lane: 0 },
      { mass: 1, velocity: 0, lane: 0 },
      { mass: 1, velocity: 0, lane: 0 },
    ],
  },
  {
    id: "wall",
    label: "wall",
    restitution: 1,
    // A light body against a very heavy one: it comes back at nearly its own
    // speed, and the heavy one barely notices.
    specs: [
      { mass: 0.3, velocity: 4, lane: 0 },
      { mass: 10, velocity: 0, lane: 0 },
    ],
  },
  {
    id: "break",
    label: "spread",
    restitution: 1,
    specs: [
      { mass: 1.4, velocity: 3.5, lane: 0 },
      { mass: 1, velocity: 0, lane: -0.28 },
      { mass: 1, velocity: 0, lane: 0.28 },
      { mass: 1, velocity: 0, lane: 0 },
    ],
  },
];

/**
 * The flagship experiment: two discs, set up by hand, colliding once.
 *
 * Everything else in the project is a variation on what happens here, so this
 * lab is built to be read rather than watched. You choose the masses and the
 * speeds, the collision is captured the instant it happens, and the impulse
 * that resolved it is shown as an equation with your own numbers in it.
 */
export class CollisionsLab implements Lab {
  readonly id = "collisions";
  readonly title = "Collisions";
  readonly blurb =
    "Build a row of bodies, set their masses, and read the impulse that resolves each impact.";
  readonly worldHeight = 3.4;
  readonly interactive = false;

  readonly about = `
    <p>Add bodies with <strong>+ add</strong>, click one on the canvas or in the list to select
    it, and give it whatever mass and speed you like. The presets are quick starts.</p>
    <p>A collision does not change velocities gradually. It changes them all at once, through
    an <strong>impulse</strong> — a transfer of momentum that acts along the
    <em>contact normal</em>, the line joining the two centres at the instant they touch.</p>
    <h3>Where the formula comes from</h3>
    <p>Two conditions are imposed. First, total momentum cannot change: whatever one body
    gains, the other loses. Second, the <em>coefficient of restitution</em> e fixes how fast
    the pair separates relative to how fast it approached. Solving both together yields a
    single quantity — the impulse J — and with it, both final velocities.</p>
    <h3>What to look for</h3>
    <ul>
      <li>At <em>e</em> = 1 kinetic energy is conserved exactly. Lower e and watch how much is lost.</li>
      <li>Equal masses meeting head-on simply exchange velocities.</li>
      <li>Equal masses, e = 1, one at rest: they leave at exactly <strong>90°</strong>.</li>
      <li>With a huge <em>m</em><sub>2</sub>, the light body bounces back at nearly its own speed.</li>
      <li>Momentum is conserved <em>always</em>, whatever e is. Energy is not.</li>
      <li>Try the <strong>cradle</strong> preset: the struck row stays still and only the far
      body leaves, at exactly the incoming speed.</li>
    </ul>`;

  /** The experiment as configured, independent of any running World. */
  specs: Spec[] = PRESETS[0]!.specs.map((spec) => ({ ...spec }));
  restitution = 1;
  /** Index into `specs`; the body the detail panel edits. */
  selected = 0;

  showVectors = true;
  showGhosts = true;
  pauseOnImpact = false;

  private bodies: Body[] = [];
  private armedAt: Vec2[] = [];
  private captured: CollisionRecord | null = null;
  private lastSignature = "";
  private seenRecords = 0;
  private idleAfterImpact = 0;
  private momentumBefore = 0;
  private energyBefore = 0;

  /** Identifies the experiment, so a replay can be told from a new setup. */
  private signature(): string {
    return this.specs.map((s) => `${s.mass}/${s.velocity}/${s.lane}`).join("|");
  }

  /** The spec the detail panel is editing; never undefined. */
  private get current(): Spec {
    return this.specs[Math.min(this.selected, this.specs.length - 1)] ?? this.specs[0]!;
  }

  private radiusOf(spec: Spec): number {
    return radiusForMass(spec.mass, 0.13);
  }

  setup(world: World, _host: LabHost): void {
    const sameSetup = this.signature() === this.lastSignature;
    world.clear();
    world.params = defaultParameters({
      restitution: this.restitution,
      walls: false,
      iterations: 12,
    });

    const midY = world.height / 2;
    const radii = this.specs.map((spec) => this.radiusOf(spec));

    // Laid out left to right, each just clear of its neighbour. Bodies that
    // start at rest are placed touching, so a row of them passes an impulse
    // along the chain rather than drifting into one.
    const gap = 0.02;
    let cursor = 0;
    const offsets = radii.map((radius, index) => {
      const previous = radii[index - 1];
      cursor += index === 0 ? 0 : previous! + radius + gap;
      return cursor;
    });
    const span = offsets[offsets.length - 1]! + radii[0]! + radii[radii.length - 1]!;
    // The whole train is centred, then pushed left by the room the first body
    // needs to build up speed before it reaches the others.
    const runway = Math.min(world.width * 0.3, 1.5);
    const left = Math.max(radii[0]! + 0.05, (world.width - span) / 2 - runway * 0.5);

    this.bodies = this.specs.map((spec, index) => {
      const body = new Body({
        position: new Vec2(
          left + offsets[index]! + (index === 0 ? 0 : runway),
          midY + spec.lane * (world.height / 2 - radii[index]! - 0.05),
        ),
        velocity: new Vec2(spec.velocity, 0),
        radius: radii[index]!,
        mass: spec.mass,
        color: bodyColor(index),
        label: NAMES[index] ?? "",
      });
      world.add(body);
      return body;
    });

    world.markReferenceEnergy();
    this.armedAt = this.bodies.map((body) => body.position);
    // On a replay of the *same* setup the previous reading stays on screen, so
    // the numbers remain readable while the bodies fly back in. Only a genuine
    // change of the experiment clears it.
    if (!sameSetup) this.captured = null;
    this.lastSignature = this.signature();
    this.seenRecords = 0;
    this.idleAfterImpact = 0;
    this.momentumBefore = this.specs.reduce((sum, s) => sum + s.mass * s.velocity, 0);
    this.energyBefore = this.specs.reduce((sum, s) => sum + 0.5 * s.mass * s.velocity ** 2, 0);
    if (this.selected >= this.specs.length) this.selected = this.specs.length - 1;
  }

  tick(world: World, dt: number, host: LabHost): void {
    if (world.log.length > this.seenRecords) {
      this.captured = world.log[world.log.length - 1] ?? null;
      this.seenRecords = world.log.length;
      this.idleAfterImpact = 0;
      if (this.pauseOnImpact) host.pause();
    }

    // Replay once the box is empty. Bodies left at rest keep it from ever
    // emptying, which is the right outcome: nothing is going to happen, so
    // there is nothing to replay.
    const anyVisible = this.bodies.some((body) => !outside(body.position, world, 0.35));
    if (!anyVisible && !host.paused) {
      this.idleAfterImpact += dt;
      if (this.idleAfterImpact > 0.12) host.rearm();
    } else {
      this.idleAfterImpact = 0;
    }
  }

  onPick(body: Body | null): void {
    if (!body) return;
    const index = this.bodies.indexOf(body);
    if (index >= 0) this.selected = index;
  }

  annotate(renderer: Renderer, world: World, _pointer: PointerState): void {
    if (this.showGhosts) {
      this.bodies.forEach((body, index) => {
        const from = this.armedAt[index];
        if (!from) return;
        renderer.drawGuide(from, body.position, alpha(body.color, 0.22), [3, 5]);
      });
    }

    const record = this.captured;
    if (record) {
      // The contact normal: the line every impulse in this engine acts along.
      const extent = 0.5;
      renderer.drawGuide(
        record.point.sub(record.normal.scale(extent)),
        record.point.add(record.normal.scale(extent)),
        alpha(theme().amber, 0.6),
        [4, 4],
      );
      renderer.drawCross(record.point, theme().amber, 4);
    }

    if (this.showVectors) {
      for (const body of world.bodies) {
        renderer.drawVector(body.position, body.velocity, {
          color: body.color,
          scale: VELOCITY_SCALE,
        });
      }
    }

    // The body the panel is editing, bracketed on the canvas so the two views
    // never disagree about which one is selected.
    const active = this.bodies[this.selected];
    if (active) renderer.drawBody(active, { highlight: true });
  }

  toggles(): Toggle[] {
    return [
      {
        id: "vectors",
        label: "vectors",
        get: () => this.showVectors,
        set: (value) => {
          this.showVectors = value;
        },
      },
      {
        id: "ghosts",
        label: "paths",
        get: () => this.showGhosts,
        set: (value) => {
          this.showGhosts = value;
        },
      },
      {
        id: "freeze",
        label: "pause on impact",
        get: () => this.pauseOnImpact,
        set: (value) => {
          this.pauseOnImpact = value;
        },
      },
    ];
  }

  panels(world: World, host: LabHost): Panel[] {
    const rebuild = () => host.rearm();

    const roster = listPanel("bodies", {
      rows: () =>
        this.specs.map((spec, index) => ({
          key: String(index),
          swatch: bodyColor(index),
          name: NAMES[index] ?? "?",
          detail: `${fixed(spec.mass, 2)} kg  ${signed(spec.velocity, 2)} m/s`,
        })),
      selectedKey: () => String(this.selected),
      select: (key) => {
        this.selected = Number(key);
      },
      onAdd: {
        label: "+ add",
        enabled: () => this.specs.length < MAX_BODIES,
        run: () => {
          if (this.specs.length >= MAX_BODIES) return;
          // A new body arrives at rest in the middle of the pack, which is the
          // only starting state that never invalidates the run already set up.
          this.specs.push({ mass: 1, velocity: 0, lane: 0 });
          this.selected = this.specs.length - 1;
          rebuild();
        },
      },
      onRemove: {
        label: "− remove",
        enabled: () => this.specs.length > 2,
        run: () => {
          if (this.specs.length <= 2) return;
          this.specs.splice(this.selected, 1);
          this.selected = Math.min(this.selected, this.specs.length - 1);
          rebuild();
        },
      },
    });

    const detail = controlsPanel(
      "selected",
      [
        {
          label: `mass <em>m</em>`,
          unit: "kg",
          min: 0.2,
          max: 10,
          step: 0.1,
          get: () => this.current.mass,
          set: (value) => {
            this.current.mass = value;
            rebuild();
          },
        },
        {
          label: `velocity <em>v</em>`,
          unit: "m/s",
          min: -6,
          max: 6,
          step: 0.1,
          get: () => this.current.velocity,
          set: (value) => {
            this.current.velocity = value;
            rebuild();
          },
        },
        {
          label: "lane",
          min: -0.9,
          max: 0.9,
          step: 0.05,
          get: () => this.current.lane,
          set: (value) => {
            this.current.lane = value;
            rebuild();
          },
          format: (value) => (Math.abs(value) < 0.03 ? "centre" : fixed(value, 2)),
          ticks: ["above", "below"],
        },
      ],
      () => NAMES[this.selected] ?? "",
    );

    const table = controlsPanel(
      "conditions",
      [
        {
          label: `restitution <em>e</em>`,
          min: 0,
          max: 1,
          step: 0.01,
          get: () => this.restitution,
          set: (value) => {
            this.restitution = value;
            world.params.restitution = value;
          },
          format: (value) =>
            value >= 0.999 ? "1.00 · elastic" : value <= 0.001 ? "0.00 · plastic" : fixed(value, 2),
          ticks: ["they stick", "perfect bounce"],
        },
      ],
      "applies live",
    );

    const starters = customPanel("presets", (body) => {
      const row = document.createElement("div");
      row.className = "preset-row";
      for (const preset of PRESETS) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "list-action";
        button.textContent = preset.label;
        button.addEventListener("click", () => {
          this.specs = preset.specs.map((spec) => ({ ...spec }));
          this.restitution = preset.restitution;
          this.selected = 0;
          rebuild();
        });
        row.append(button);
      }
      body.append(row);
      return () => {};
    });

    const equation = customPanel("the impulse", (body) => {
      const formula = document.createElement("div");
      const substituted = document.createElement("div");
      substituted.className = "substituted";
      body.append(formula, substituted);

      formula.innerHTML = equationBlock(
        `${v("J")} ${op("=")} ${frac(
          `(1 ${op("+")} ${v("e")}) · ${v("v", "rel")}`,
          `1/${v("m", "1")} ${op("+")} 1/${v("m", "2")}`,
        )}`,
        "impulse along the contact normal",
      );

      return () => {
        const record = this.captured;
        if (!record) {
          substituted.innerHTML =
            '<p class="inspector-empty">Waiting for the impact…</p>';
          return;
        }
        const invSum = 1 / record.a.mass + 1 / record.b.mass;
        substituted.innerHTML = equationBlock(
          `${v("J")} ${op("=")} ${frac(
            `(1 ${op("+")} ${num(fixed(record.restitution, 2))}) · ${num(fixed(record.approachSpeed, 3))}`,
            `1/${num(fixed(record.a.mass, 2))} ${op("+")} 1/${num(fixed(record.b.mass, 2))}`,
          )} ${op("=")} ${num(fixed(record.impulse, 3))}`,
          `${fixed(record.impulse, 3)} kg·m/s · the same impulse on both, in opposite directions`,
        ) +
          equationBlock(
            `${v("v", "1")}′ ${op("=")} ${v("v", "1")} ${op("−")} (${v("J")}${op("/")}${v("m", "1")}) n̂` +
              `<br />` +
              `${v("v", "2")}′ ${op("=")} ${v("v", "2")} ${op("+")} (${v("J")}${op("/")}${v("m", "2")}) n̂`,
            "the same J splits the change in inverse proportion to mass",
          );
        void invSum;
      };
    });

    const inspector = customPanel("before and after", (body, note) => {
      const pair = document.createElement("div");
      body.append(pair);
      return () => {
        const record = this.captured;
        if (!record) {
          note.textContent = "";
          pair.innerHTML =
            '<p class="inspector-empty">No impact has happened yet. Adjust the setup and ' +
            "press <strong>Restart</strong> to launch it again.</p>";
          return;
        }
        note.textContent = `t = ${fixed(record.time, 2)} s`;
        pair.innerHTML =
          side(record.a) +
          `<div class="impact-pair" style="margin:6px 0 8px">
             <span class="impact-velocity">approaching at ${fixed(record.approachSpeed, 3)} m/s</span>
             <span class="impact-glyph">→‖←</span>
             <span class="impact-velocity" style="text-align:right">separating at ${fixed(
               Math.abs(record.separationSpeed),
               3,
             )} m/s</span>
           </div>` +
          side(record.b);
      };
    });

    const conservation = metricsPanel(
      "conservation",
      [
        {
          label: `total momentum <em>p</em>`,
          unit: "kg·m/s",
          value: () => signed(world.totalMomentum.x, 3),
        },
        {
          label: "initial momentum",
          unit: "kg·m/s",
          value: () => signed(this.momentumBefore, 3),
          tone: () => "muted",
        },
        {
          label: "kinetic energy",
          unit: "J",
          value: () => fixed(world.kineticEnergy, 3),
        },
        {
          label: "initial energy",
          unit: "J",
          value: () => fixed(this.energyBefore, 3),
          tone: () => "muted",
        },
        {
          label: "energy lost",
          value: () => {
            if (this.energyBefore <= 0) return "—";
            const lost = (this.energyBefore - world.kineticEnergy) / this.energyBefore;
            return percent(-lost, 2);
          },
          tone: () => {
            const lost = (this.energyBefore - world.kineticEnergy) / Math.max(this.energyBefore, 1e-9);
            if (Math.abs(lost) < 1e-6) return "good";
            return "warn";
          },
        },
      ],
      "p always conserved",
    );

    return [starters, roster, detail, table, equation, inspector, conservation];
  }
}

function side(part: CollisionRecord["a"]): string {
  return `<div class="impact-pair">
      <div class="impact-body">
        <span class="impact-name"><i class="impact-swatch" style="background:${part.color}"></i>${
          part.label || "?"
        } · ${fixed(part.mass, 2)} kg</span>
        <span class="impact-velocity">
          ${signed(part.before.x, 3)}
          <span class="arrow">→</span>
          <span class="after">${signed(part.after.x, 3)}</span> m/s
        </span>
      </div>
      <span></span>
      <div class="impact-body right">
        <span class="impact-velocity">Δp = ${signed(part.mass * (part.after.x - part.before.x), 3)}</span>
        <span class="impact-velocity" style="color:var(--text-faint)">kg·m/s</span>
      </div>
    </div>`;
}

function outside(position: Vec2, world: World, margin: number): boolean {
  return (
    position.x < -margin ||
    position.x > world.width + margin ||
    position.y < -margin ||
    position.y > world.height + margin
  );
}
