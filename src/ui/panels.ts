/**
 * The readout vocabulary.
 *
 * Every panel is a small factory returning its element plus an `update`
 * function. Labs assemble the ones they need and the frame loop calls each
 * update; nothing here knows what experiment is running.
 */

import { fixed } from "./format";

export interface Panel {
  readonly element: HTMLElement;
  update(): void;
}

function panelShell(title: string, note?: string): { root: HTMLElement; body: HTMLElement; note: HTMLElement } {
  // The title and the note are absolutely positioned over the top border, so
  // the rule appears to break around them -- the CSS equivalent of a
  // box-drawing frame with its label cut in.
  const root = document.createElement("section");
  root.className = "panel";

  const heading = document.createElement("span");
  heading.className = "panel-title";
  heading.textContent = title;

  const noteEl = document.createElement("span");
  noteEl.className = "panel-note";
  if (note) noteEl.textContent = note;

  const body = document.createElement("div");
  body.className = "panel-body";

  root.append(heading, noteEl, body);
  return { root, body, note: noteEl };
}

// -- metrics --------------------------------------------------------------

export interface MetricRow {
  /** May contain markup, so that `<em>v</em>` renders as a proper variable. */
  label: string;
  unit?: string;
  /** Recomputed every frame. */
  value: () => string;
  tone?: () => "" | "good" | "warn" | "muted";
  /** Flash the value when it changes. Reserve it for genuine events. */
  flash?: boolean;
}

export function metricsPanel(title: string, rows: MetricRow[], note?: string): Panel {
  const { root, body } = panelShell(title, note);
  const list = document.createElement("div");
  list.className = "metrics";

  const cells = rows.map((row) => {
    const line = document.createElement("div");
    line.className = "metric";

    const label = document.createElement("span");
    label.className = "metric-label";
    label.innerHTML = row.label;

    const value = document.createElement("span");
    value.className = "metric-value";

    line.append(label, value);
    list.append(line);
    return { row, value, previous: "" };
  });

  body.append(list);

  return {
    element: root,
    update() {
      for (const cell of cells) {
        const text = cell.row.value();
        const unit = cell.row.unit;
        if (text !== cell.previous) {
          cell.value.innerHTML = unit
            ? `${escapeHtml(text)}<span class="unit">${escapeHtml(unit)}</span>`
            : escapeHtml(text);
          if (cell.row.flash && cell.previous !== "") {
            cell.value.classList.remove("touched");
            void cell.value.offsetWidth; // restart the animation
            cell.value.classList.add("touched");
          }
          cell.previous = text;
        }
        const tone = cell.row.tone?.() ?? "";
        cell.value.classList.toggle("good", tone === "good");
        cell.value.classList.toggle("warn", tone === "warn");
        cell.value.classList.toggle("muted", tone === "muted");
      }
    },
  };
}

// -- controls -------------------------------------------------------------

export interface ControlSpec {
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  get(): number;
  set(value: number): void;
  /** Overrides the plain numeric display, e.g. to name a regime. */
  format?: (value: number) => string;
  ticks?: [string, string];
}

export function controlsPanel(title: string, specs: ControlSpec[], note?: string): Panel {
  const { root, body } = panelShell(title, note);

  const controls = specs.map((spec) => {
    const wrap = document.createElement("div");
    wrap.className = "control";

    const head = document.createElement("div");
    head.className = "control-head";
    const name = document.createElement("span");
    name.className = "control-name";
    name.innerHTML = spec.label;
    const value = document.createElement("span");
    value.className = "control-value";
    head.append(name, value);

    const input = document.createElement("input");
    input.type = "range";
    input.min = String(spec.min);
    input.max = String(spec.max);
    input.step = String(spec.step);
    input.value = String(spec.get());
    input.addEventListener("input", () => spec.set(Number(input.value)));

    wrap.append(head, input);

    if (spec.ticks) {
      const ticks = document.createElement("div");
      ticks.className = "control-ticks";
      const [low, high] = spec.ticks;
      const a = document.createElement("span");
      a.textContent = low;
      const b = document.createElement("span");
      b.textContent = high;
      ticks.append(a, b);
      wrap.append(ticks);
    }

    body.append(wrap);
    return { spec, input, value, previous: "" };
  });

  return {
    element: root,
    update() {
      for (const control of controls) {
        const current = control.spec.get();
        // Only write back when the slider is out of step with the model, or
        // dragging fights the update every frame.
        if (document.activeElement !== control.input && Number(control.input.value) !== current) {
          control.input.value = String(current);
        }
        const text = control.spec.format
          ? control.spec.format(current)
          : fixed(current, decimalsFor(control.spec.step));
        if (text !== control.previous) {
          control.value.innerHTML = control.spec.unit
            ? `${escapeHtml(text)}<span class="unit">${escapeHtml(control.spec.unit)}</span>`
            : escapeHtml(text);
          control.previous = text;
        }
      }
    },
  };
}

function decimalsFor(step: number): number {
  if (step >= 1) return 0;
  if (step >= 0.1) return 1;
  if (step >= 0.01) return 2;
  return 3;
}

// -- prose ----------------------------------------------------------------

export function notePanel(title: string, html: string): Panel {
  const { root, body } = panelShell(title);
  body.innerHTML = html;
  return { element: root, update() {} };
}

/** A panel whose whole body a lab rewrites itself. */
export function customPanel(
  title: string,
  render: (body: HTMLElement, note: HTMLElement) => () => void,
  note?: string,
): Panel {
  const shell = panelShell(title, note);
  const update = render(shell.body, shell.note);
  return { element: shell.root, update };
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (char) =>
    char === "&" ? "&amp;" : char === "<" ? "&lt;" : char === ">" ? "&gt;" : "&quot;",
  );
}
