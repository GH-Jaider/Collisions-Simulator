import { Body } from "../physics/body";
import { Vec2 } from "../physics/vec";
import type { CollisionRecord, World } from "../physics/world";
import { defaultParameters } from "../physics/world";
import type { Renderer } from "../render/renderer";
import { equationBlock, frac, num, op, v } from "../ui/equation";
import { fixed, percent, signed } from "../ui/format";
import { controlsPanel, customPanel, metricsPanel, type Panel } from "../ui/panels";
import type { Lab, LabHost, PointerState, Toggle } from "./types";

const COLOR_A = "#f4736f";
const COLOR_B = "#57cff0";
/** Metres of arrow drawn per m/s of velocity. */
const VELOCITY_SCALE = 0.22;

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
  readonly blurb = "Two bodies, one impact, and the impulse that resolves it — with your own numbers in it.";
  readonly worldHeight = 3.4;
  readonly interactive = false;

  readonly about = `
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
    </ul>`;

  // Setup, in SI units. These persist across rebuilds so the experiment can be
  // re-armed with the same numbers.
  massA = 1;
  massB = 2;
  speedA = 3;
  speedB = -1;
  /** Vertical offset of B, in radii. Zero is a head-on hit. */
  offset = 0;
  restitution = 1;

  showVectors = true;
  showGhosts = true;
  pauseOnImpact = false;

  private bodyA: Body | null = null;
  private bodyB: Body | null = null;
  private armedAt = { a: Vec2.zero, b: Vec2.zero };
  private captured: CollisionRecord | null = null;
  private lastSignature = "";
  private seenRecords = 0;
  private idleAfterImpact = 0;
  private momentumBefore = 0;
  private energyBefore = 0;

  /** Identifies the experiment, so a replay can be told from a new setup. */
  private signature(): string {
    return [this.massA, this.massB, this.speedA, this.speedB, this.offset].join("|");
  }

  setup(world: World, _host: LabHost): void {
    const sameSetup = this.signature() === this.lastSignature;
    world.clear();
    world.params = defaultParameters({
      restitution: this.restitution,
      walls: false,
      iterations: 12,
    });

    const radiusA = radiusFor(this.massA);
    const radiusB = radiusFor(this.massB);
    const midY = world.height / 2;
    const midX = world.width / 2;
    // Started far enough apart that the approach is visible before contact,
    // and offset vertically by a share of the radii to set the impact angle.
    // Far enough apart that the approach reads as an approach, but no further:
    // the interesting instant is the contact, and a long glide to reach it is
    // just waiting.
    const closing = Math.max(Math.abs(this.speedA - this.speedB), 0.4);
    const gap = Math.min(world.width * 0.34, Math.max(0.55, closing * 0.34));

    this.bodyA = new Body({
      position: new Vec2(midX - gap, midY),
      velocity: new Vec2(this.speedA, 0),
      radius: radiusA,
      mass: this.massA,
      color: COLOR_A,
      label: "A",
    });
    this.bodyB = new Body({
      position: new Vec2(midX + gap, midY + this.offset * (radiusA + radiusB)),
      velocity: new Vec2(this.speedB, 0),
      radius: radiusB,
      mass: this.massB,
      color: COLOR_B,
      label: "B",
    });

    world.add(this.bodyA);
    world.add(this.bodyB);
    world.markReferenceEnergy();

    this.armedAt = { a: this.bodyA.position, b: this.bodyB.position };
    // On a replay of the *same* setup the previous reading stays on screen, so
    // the numbers remain readable while the pair flies back in. Only a genuine
    // change of the experiment clears it.
    if (!sameSetup) this.captured = null;
    this.lastSignature = this.signature();
    this.seenRecords = 0;
    this.idleAfterImpact = 0;
    this.momentumBefore = this.massA * this.speedA + this.massB * this.speedB;
    this.energyBefore = 0.5 * this.massA * this.speedA ** 2 + 0.5 * this.massB * this.speedB ** 2;
  }

  tick(world: World, dt: number, host: LabHost): void {
    if (world.log.length > this.seenRecords) {
      this.captured = world.log[world.log.length - 1] ?? null;
      this.seenRecords = world.log.length;
      this.idleAfterImpact = 0;
      if (this.pauseOnImpact) host.pause();
    }

    if (!this.captured) return;
    // Once the pair has drifted out of sight, re-arm so the experiment loops
    // without the viewer having to reach for the reset button.
    const a = this.bodyA;
    const b = this.bodyB;
    if (!a || !b) return;
    const margin = 0.35;
    // Either body leaving ends the run. Waiting for both means staring at one
    // slow straggler crossing an otherwise empty box.
    const gone = outside(a.position, world, margin) || outside(b.position, world, margin);
    if (gone && !host.paused) {
      this.idleAfterImpact += dt;
      // Barely a beat: an empty box is dead air, and the reading the viewer
      // came for stays in the panel across the replay anyway.
      if (this.idleAfterImpact > 0.12) host.rearm();
    }
  }

  annotate(renderer: Renderer, world: World, _pointer: PointerState): void {
    const a = this.bodyA;
    const b = this.bodyB;
    if (!a || !b) return;

    if (this.showGhosts && this.captured) {
      // Where each body started, so the deflection is measurable against it.
      renderer.drawGuide(this.armedAt.a, a.position, "rgba(244, 115, 111, 0.2)", [3, 5]);
      renderer.drawGuide(this.armedAt.b, b.position, "rgba(87, 207, 240, 0.2)", [3, 5]);
    }

    if (this.captured) {
      const record = this.captured;
      // The contact normal: the line every impulse in this engine acts along.
      const extent = 0.55;
      renderer.drawGuide(
        record.point.sub(record.normal.scale(extent)),
        record.point.add(record.normal.scale(extent)),
        "rgba(243, 181, 69, 0.55)",
        [4, 4],
      );
      renderer.drawCross(record.point, "rgba(243, 181, 69, 0.9)", 4);
    }

    if (this.showVectors) {
      for (const body of world.bodies) {
        renderer.drawVector(body.position, body.velocity, {
          color: body.color,
          scale: VELOCITY_SCALE,
          label: "v",
        });
      }
    }
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

    const setup = controlsPanel(
      "setup",
      [
        {
          label: `mass <em>m</em><span class="sub">1</span>`,
          unit: "kg",
          min: 0.2,
          max: 10,
          step: 0.1,
          get: () => this.massA,
          set: (value) => {
            this.massA = value;
            rebuild();
          },
        },
        {
          label: `mass <em>m</em><span class="sub">2</span>`,
          unit: "kg",
          min: 0.2,
          max: 10,
          step: 0.1,
          get: () => this.massB,
          set: (value) => {
            this.massB = value;
            rebuild();
          },
        },
        {
          label: `velocity <em>v</em><span class="sub">1</span>`,
          unit: "m/s",
          min: -6,
          max: 6,
          step: 0.1,
          get: () => this.speedA,
          set: (value) => {
            this.speedA = value;
            rebuild();
          },
        },
        {
          label: `velocity <em>v</em><span class="sub">2</span>`,
          unit: "m/s",
          min: -6,
          max: 6,
          step: 0.1,
          get: () => this.speedB,
          set: (value) => {
            this.speedB = value;
            rebuild();
          },
        },
        {
          label: "offset",
          min: -0.98,
          max: 0.98,
          step: 0.02,
          get: () => this.offset,
          set: (value) => {
            this.offset = value;
            rebuild();
          },
          format: (value) => (Math.abs(value) < 0.02 ? "head-on" : fixed(value, 2)),
          ticks: ["glancing", "glancing"],
        },
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
      "re-arms when changed",
    );

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
          side(record.a, "A", COLOR_A) +
          `<div class="impact-pair" style="margin:6px 0 8px">
             <span class="impact-velocity">approaching at ${fixed(record.approachSpeed, 3)} m/s</span>
             <span class="impact-glyph">→‖←</span>
             <span class="impact-velocity" style="text-align:right">separating at ${fixed(
               Math.abs(record.separationSpeed),
               3,
             )} m/s</span>
           </div>` +
          side(record.b, "B", COLOR_B);
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
      "momentum is conserved always",
    );

    return [setup, equation, inspector, conservation];
  }
}

function side(part: CollisionRecord["a"], name: string, color: string): string {
  return `<div class="impact-pair">
      <div class="impact-body">
        <span class="impact-name"><i class="impact-swatch" style="background:${color}"></i>${name} · ${fixed(
          part.mass,
          2,
        )} kg</span>
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

/** Discs keep a constant density, so a heavier body is visibly bigger. */
function radiusFor(mass: number): number {
  return 0.12 * Math.cbrt(mass) + 0.04;
}

function outside(position: Vec2, world: World, margin: number): boolean {
  return (
    position.x < -margin ||
    position.x > world.width + margin ||
    position.y < -margin ||
    position.y > world.height + margin
  );
}
