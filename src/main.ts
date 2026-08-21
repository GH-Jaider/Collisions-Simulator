import { Body } from "./physics/body";
import { Vec2 } from "./physics/vec";
import { World, defaultParameters } from "./physics/world";
import { Renderer } from "./render/renderer";
import { labs, type Lab, type LabHost, type Toggle } from "./labs";
import type { Panel } from "./ui/panels";

const RATES = [0.25, 0.5, 1, 2] as const;
/** Never hand the integrator a jump bigger than this, however long the tab slept. */
const MAX_FRAME = 1 / 20;
const IMPACT_LIFETIME = 0.4;
/** Fling speed is measured over this window, not from the last pointer delta. */
const THROW_WINDOW = 0.12;
const MAX_THROW = 14;

interface Flash {
  position: Vec2;
  strength: number;
  age: number;
}

class Application implements LabHost {
  private readonly world = new World(8, 5, defaultParameters());
  private readonly renderer: Renderer;
  private readonly readout = query<HTMLElement>("#readout");
  private readonly channels = query<HTMLElement>("#channels");
  private readonly togglesHost = query<HTMLElement>("#toggles");
  private readonly rateHost = query<HTMLElement>("#rate-options");
  private readonly titleEl = query<HTMLElement>("#lab-title");
  private readonly blurbEl = query<HTMLElement>("#lab-blurb");
  private readonly scaleNote = query<HTMLElement>("#scale-note");
  private readonly playButton = query<HTMLButtonElement>("#play");
  private readonly playLabel = query<HTMLElement>("#play-label");
  private readonly playGlyph = query<HTMLElement>("#play-glyph");
  private readonly statusState = query<HTMLElement>("#status-state");
  private readonly aboutDialog = query<HTMLDialogElement>("#about");
  private readonly aboutContent = query<HTMLElement>("#about-content");

  private lab: Lab = labs[0]!;
  private panels: Panel[] = [];
  paused = false;
  private rate: number = 1;
  private pendingStep = false;
  private lastFrame = performance.now();
  private flashes: Flash[] = [];

  // Pointer state
  private pointer: Vec2 | null = null;
  private held: Body | null = null;
  private grabOffset = Vec2.zero;
  private slingFrom: Vec2 | null = null;
  private dragHistory: Array<{ at: number; position: Vec2 }> = [];

  constructor() {
    this.renderer = new Renderer(query<HTMLCanvasElement>("#canvas"));
    this.buildChannels();
    this.buildRates();
    this.bindTransport();
    this.bindPointer();
    this.bindKeyboard();

    const initial = new URLSearchParams(location.search).get("lab");
    const chosen = labs.find((lab) => lab.id === initial);
    this.selectLab(chosen ?? labs[0]!);

    // Rebuilding on resize rather than merely reshaping the box: a scenario
    // lays its bodies out to fit, and stretching the world underneath a
    // running experiment moves every body and silently rewrites the potential
    // energy the drift readout is measured against.
    const observer = new ResizeObserver(() => this.handleResize());
    observer.observe(query<HTMLElement>("#viewport"));

    requestAnimationFrame(this.frame);
  }

  // -- chrome ----------------------------------------------------------

  private buildChannels(): void {
    labs.forEach((lab, index) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "channel";
      button.setAttribute("role", "tab");
      button.dataset["lab"] = lab.id;
      button.innerHTML = `<span class="index">${index + 1}</span>${lab.title}`;
      button.addEventListener("click", () => this.selectLab(lab));
      this.channels.append(button);
    });
  }

  private buildRates(): void {
    for (const rate of RATES) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "rate-option";
      button.textContent = rate === 1 ? "1x" : `${rate}x`;
      button.addEventListener("click", () => {
        this.rate = rate;
        this.syncRates();
      });
      this.rateHost.append(button);
    }
    this.syncRates();
  }

  private syncRates(): void {
    Array.from(this.rateHost.children).forEach((child, index) => {
      child.setAttribute("aria-pressed", String(RATES[index] === this.rate));
    });
  }

  private bindTransport(): void {
    this.playButton.addEventListener("click", () => (this.paused ? this.resume() : this.pause()));
    query<HTMLButtonElement>("#step").addEventListener("click", () => this.singleStep());
    query<HTMLButtonElement>("#reset").addEventListener("click", () => this.rearm());
    query<HTMLButtonElement>("#about-button").addEventListener("click", () => this.aboutDialog.showModal());
    query<HTMLButtonElement>("#about-close").addEventListener("click", () => this.aboutDialog.close());
  }

  private bindKeyboard(): void {
    window.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if (this.aboutDialog.open && event.key !== "Escape") return;

      if (event.key === " ") {
        event.preventDefault();
        this.paused ? this.resume() : this.pause();
      } else if (event.key === ".") {
        this.singleStep();
      } else if (event.key === "r" || event.key === "R") {
        this.rearm();
      } else if (event.key === "?") {
        this.aboutDialog.open ? this.aboutDialog.close() : this.aboutDialog.showModal();
      } else if (/^[1-9]$/.test(event.key)) {
        const lab = labs[Number(event.key) - 1];
        if (lab) this.selectLab(lab);
      }
    });
  }

  // -- lab lifecycle ---------------------------------------------------

  private selectLab(lab: Lab): void {
    this.lab = lab;
    this.releasePointer();
    this.flashes = [];

    this.titleEl.textContent = lab.title;
    this.blurbEl.textContent = lab.blurb;
    this.aboutContent.innerHTML = lab.about;
    for (const child of Array.from(this.channels.children)) {
      child.setAttribute("aria-selected", String((child as HTMLElement).dataset["lab"] === lab.id));
    }

    const url = new URL(location.href);
    url.searchParams.set("lab", lab.id);
    history.replaceState(null, "", url);

    this.fit();
    lab.setup(this.world, this);

    this.panels = lab.panels(this.world, this);
    this.readout.replaceChildren(...this.panels.map((panel) => panel.element));
    for (const panel of this.panels) panel.update();

    this.buildToggles(lab.toggles?.(this.world, this) ?? []);
    this.resume();
  }

  private buildToggles(toggles: Toggle[]): void {
    this.togglesHost.replaceChildren();
    for (const toggle of toggles) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "toggle";
      button.textContent = toggle.label;
      button.setAttribute("aria-pressed", String(toggle.get()));
      button.addEventListener("click", () => {
        toggle.set(!toggle.get());
        button.setAttribute("aria-pressed", String(toggle.get()));
        if (!toggle.get()) {
          for (const body of this.world.bodies) body.trail.length = 0;
        }
      });
      this.togglesHost.append(button);
    }
  }

  /** Resize the camera and tell the world about its new bounds. */
  private fit(): void {
    this.renderer.resize(this.lab.worldHeight);
    this.world.resize(this.renderer.worldWidth, this.renderer.worldHeight);
    this.scaleNote.textContent = `${this.renderer.worldWidth.toFixed(2)} × ${this.renderer.worldHeight.toFixed(2)} m`;
  }

  private handleResize(): void {
    const before = this.renderer.worldWidth;
    this.fit();
    // Only rebuild on a real change; the observer also fires on the initial
    // layout pass, and on sub-pixel jitter while a window is being dragged.
    if (Math.abs(before - this.renderer.worldWidth) > 0.01) this.rearm();
  }

  // -- LabHost ---------------------------------------------------------

  pause(): void {
    this.paused = true;
    this.syncTransport();
  }

  resume(): void {
    this.paused = false;
    this.syncTransport();
  }

  rearm(): void {
    this.releasePointer();
    this.flashes = [];
    this.fit();
    this.lab.setup(this.world, this);
    for (const panel of this.panels) panel.update();
  }

  private singleStep(): void {
    this.pause();
    this.pendingStep = true;
  }

  private syncTransport(): void {
    this.playLabel.textContent = this.paused ? "play" : "pause";
    this.playGlyph.textContent = this.paused ? "▶" : "❚❚";
    this.statusState.textContent = this.paused ? "paused" : "running";
    this.statusState.dataset["state"] = this.paused ? "paused" : "running";
  }

  // -- pointer ---------------------------------------------------------

  private bindPointer(): void {
    const canvas = this.renderer.canvas;

    canvas.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      if (!this.lab.interactive) return;
      const point = this.renderer.toWorld(event.clientX, event.clientY);
      const target = this.world.bodyAt(point);
      if (target && !target.isStatic) this.world.remove(target);
    });

    canvas.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      if (!this.lab.interactive) {
        if (this.lab.onPick) {
          const point = this.renderer.toWorld(event.clientX, event.clientY);
          this.lab.onPick(this.world.bodyAt(point));
        }
        return;
      }
      canvas.setPointerCapture(event.pointerId);
      canvas.classList.add("grabbing");
      const point = this.renderer.toWorld(event.clientX, event.clientY);
      this.pointer = point;

      const target = this.world.bodyAt(point);
      if (target && !target.isStatic) {
        // Held bodies go infinite-mass rather than merely being moved, so they
        // shoulder others aside instead of being shoved back by the contacts
        // they create.
        this.held = target;
        target.pinned = true;
        this.grabOffset = target.position.sub(point);
        this.dragHistory = [{ at: performance.now() / 1000, position: target.position }];
      } else {
        this.slingFrom = point;
      }
    });

    canvas.addEventListener("pointermove", (event) => {
      const point = this.renderer.toWorld(event.clientX, event.clientY);
      this.pointer = point;
      const held = this.held;
      if (!held) return;
      const target = point.add(this.grabOffset);
      held.position = target;
      held.velocity = Vec2.zero;
      this.dragHistory.push({ at: performance.now() / 1000, position: target });
      if (this.dragHistory.length > 16) this.dragHistory.shift();
    });

    const finish = (event: PointerEvent) => {
      if (event.button !== 0 && event.type === "pointerup") return;
      canvas.classList.remove("grabbing");
      const point = this.renderer.toWorld(event.clientX, event.clientY);

      if (this.held) {
        this.held.pinned = false;
        this.held.velocity = this.flingVelocity();
        this.held = null;
        this.dragHistory = [];
        return;
      }

      if (this.slingFrom) {
        const start = this.slingFrom;
        this.slingFrom = null;
        // Pull back and release, like a catapult: the body flies opposite the
        // drag, at a speed set by how far it was pulled.
        const velocity = start.sub(point).scale(3.2).clamped(MAX_THROW);
        if (velocity.length > 0.2) this.spawn(start, velocity);
      }
    };

    canvas.addEventListener("pointerup", finish);
    canvas.addEventListener("pointercancel", finish);
    canvas.addEventListener("pointerleave", () => {
      this.pointer = null;
    });
  }

  /**
   * Pointer velocity over the tail of a drag.
   *
   * Differencing the last two samples looks right until the final event of a
   * drag repeats the previous position -- which pointer streams do routinely
   * -- and the throw comes out as zero. So: walk forward, skip anything that
   * did not actually move, and stop at the oldest sample inside the window.
   */
  private flingVelocity(): Vec2 {
    const history = this.dragHistory;
    if (history.length < 2) return Vec2.zero;
    const latest = history[history.length - 1]!;

    let reference: { at: number; position: Vec2 } | null = null;
    for (const sample of history.slice(0, -1)) {
      const gap = latest.at - sample.at;
      if (gap > 0.4 || sample.position.equals(latest.position, 1e-9)) continue;
      reference = sample;
      if (gap <= THROW_WINDOW) break;
    }
    if (!reference) return Vec2.zero;
    const span = latest.at - reference.at;
    if (span < 1e-4) return Vec2.zero;
    return latest.position.sub(reference.position).scale(1 / span).clamped(MAX_THROW);
  }

  private spawn(position: Vec2, velocity: Vec2): void {
    const radius = Math.min(this.world.width, this.world.height) * 0.03;
    this.world.add(
      new Body({
        position,
        velocity,
        radius,
        // Constant density, so a bigger body is genuinely heavier.
        mass: radius * radius * 18,
        color: "#8ad4ff",
      }),
    );
    this.world.markReferenceEnergy();
  }

  private releasePointer(): void {
    if (this.held) {
      this.held.pinned = false;
      this.held = null;
    }
    this.slingFrom = null;
    this.dragHistory = [];
  }

  // -- frame loop ------------------------------------------------------

  private frame = (now: number): void => {
    const elapsed = Math.min((now - this.lastFrame) / 1000, MAX_FRAME);
    this.lastFrame = now;

    let step = elapsed * this.rate;
    if (this.pendingStep) {
      this.pendingStep = false;
      step = 1 / 120;
    } else if (this.paused) {
      step = 0;
    }

    if (step > 0) {
      this.world.step(step);
      this.lab.tick?.(this.world, step, this);
      for (const impact of this.world.impacts) {
        this.flashes.push({ position: impact.position, strength: impact.strength, age: 0 });
      }
      if (this.flashes.length > 60) this.flashes.splice(0, this.flashes.length - 60);
    }

    this.draw(elapsed);
    for (const panel of this.panels) panel.update();

    requestAnimationFrame(this.frame);
  };

  private draw(elapsed: number): void {
    const renderer = this.renderer;
    renderer.begin();

    for (const body of this.world.bodies) {
      renderer.drawBody(body, this.held === body ? { highlight: true } : {});
    }

    this.lab.annotate?.(renderer, this.world, { position: this.pointer, held: this.held });

    const surviving: Flash[] = [];
    for (const flash of this.flashes) {
      flash.age += elapsed;
      if (flash.age >= IMPACT_LIFETIME) continue;
      surviving.push(flash);
      renderer.drawImpact(flash.position, flash.strength, flash.age / IMPACT_LIFETIME);
    }
    this.flashes = surviving;

    if (this.slingFrom && this.pointer) {
      renderer.drawGuide(this.slingFrom, this.pointer, "rgba(255, 255, 255, 0.45)", [4, 4]);
      renderer.drawCross(this.slingFrom, "rgba(243, 181, 69, 0.9)", 5);
    }
  }
}

function query<T extends Element>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Missing element: ${selector}`);
  return element;
}

new Application();
