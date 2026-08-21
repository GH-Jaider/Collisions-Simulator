/** Small canvas readouts: a rolling time series and a distribution. */

import type { Panel } from "./panels";

interface Shell {
  root: HTMLElement;
  body: HTMLElement;
  note: HTMLElement;
}

function shell(title: string, note?: string): Shell {
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

function fitCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  const rect = canvas.getBoundingClientRect();
  if (rect.width === 0) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  const width = Math.round(rect.width * dpr);
  const height = Math.round(rect.height * dpr);
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, rect.width, rect.height);
  return ctx;
}

// -- time series ----------------------------------------------------------

export interface Series {
  label: string;
  color: string;
  sample: () => number;
}

/**
 * A rolling plot of a few quantities against time.
 *
 * All series share one vertical scale so they can be compared directly, and
 * the scale only ever grows within a window — a plot that rescales every frame
 * makes a constant look like it is wandering.
 */
export function chartPanel(
  title: string,
  series: Series[],
  options: { capacity?: number; includeZero?: boolean; note?: string } = {},
): Panel {
  const capacity = options.capacity ?? 260;
  const { root, body } = shell(title, options.note);

  const canvas = document.createElement("canvas");
  canvas.className = "chart";
  body.append(canvas);

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  for (const item of series) {
    const entry = document.createElement("span");
    const swatch = document.createElement("i");
    swatch.style.background = item.color;
    entry.append(swatch, document.createTextNode(item.label));
    legend.append(entry);
  }
  body.append(legend);

  const buffers = series.map(() => [] as number[]);
  let ceiling = 0;
  let floor = 0;

  return {
    element: root,
    update() {
      for (let i = 0; i < series.length; i++) {
        const buffer = buffers[i]!;
        buffer.push(series[i]!.sample());
        if (buffer.length > capacity) buffer.shift();
      }

      const ctx = fitCanvas(canvas);
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;

      let high = options.includeZero === false ? -Infinity : 0;
      let low = options.includeZero === false ? Infinity : 0;
      for (const buffer of buffers) {
        for (const value of buffer) {
          if (value > high) high = value;
          if (value < low) low = value;
        }
      }
      if (!Number.isFinite(high) || !Number.isFinite(low)) return;
      if (high === low) high = low + 1;
      const pad = (high - low) * 0.22;
      // Ease the bounds rather than snapping, so a passing spike does not make
      // every other trace jump.
      ceiling = ceiling === 0 ? high + pad : ceiling + (high + pad - ceiling) * 0.08;
      floor = floor === 0 && low === 0 ? 0 : floor + (low - pad - floor) * 0.08;
      const span = Math.max(ceiling - floor, 1e-9);

      ctx.strokeStyle = "rgba(140, 150, 190, 0.09)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 1; i < 4; i++) {
        const y = Math.round((height * i) / 4) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      if (floor < 0 && ceiling > 0) {
        const zero = height - ((0 - floor) / span) * height;
        ctx.strokeStyle = "rgba(140, 150, 190, 0.3)";
        ctx.beginPath();
        ctx.moveTo(0, Math.round(zero) + 0.5);
        ctx.lineTo(width, Math.round(zero) + 0.5);
        ctx.stroke();
      }

      for (let i = 0; i < series.length; i++) {
        const buffer = buffers[i]!;
        if (buffer.length < 2) continue;
        ctx.beginPath();
        for (let index = 0; index < buffer.length; index++) {
          const x = (index / (capacity - 1)) * width;
          const y = height - ((buffer[index]! - floor) / span) * height;
          if (index === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = series[i]!.color;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = "round";
        ctx.stroke();
      }
    },
  };
}

// -- distribution ---------------------------------------------------------

export interface HistogramSource {
  values: () => number[];
  /**
   * The predicted density at a given speed, or null when no prediction
   * applies. Fitted from the data's own mean square speed, so agreement is a
   * real prediction rather than a curve fit.
   */
  theory?: () => ((speed: number) => number) | null;
  theoryLabel?: string;
  color: string;
}

/**
 * A speed distribution.
 *
 * The bars are a running average rather than an instantaneous count. A few
 * hundred bodies across a couple of dozen bins is a handful of samples each,
 * and the raw histogram jitters far too much to compare against anything.
 * Averaging over time is legitimate here for the same reason the comparison is
 * interesting at all: the gas is ergodic, so its time average is its ensemble
 * average.
 */
export function histogramPanel(title: string, source: HistogramSource, note?: string): Panel {
  const { root, body, note: noteEl } = shell(title, note);
  const canvas = document.createElement("canvas");
  canvas.className = "histogram";
  body.append(canvas);

  const legend = document.createElement("div");
  legend.className = "chart-legend";
  body.append(legend);

  const smoothing = 0.08;
  let levels: number[] = [];
  let peak = 0;

  return {
    element: root,
    update() {
      const ctx = fitCanvas(canvas);
      if (!ctx) return;
      const rect = canvas.getBoundingClientRect();
      const width = rect.width;
      const height = rect.height;
      const bins = Math.max(10, Math.min(Math.round(width / 9), 34));

      const values = source.values();
      if (values.length === 0) return;
      let top = 0;
      for (const value of values) if (value > top) top = value;
      if (top <= 0) return;

      const target = top * 1.15;
      peak = peak === 0 ? target : peak + (target - peak) * smoothing;
      const binWidth = peak / bins;

      const counts = new Array<number>(bins).fill(0);
      for (const value of values) {
        counts[Math.min(bins - 1, Math.floor(value / binWidth))]!++;
      }
      let tallest = 1;
      for (const count of counts) if (count > tallest) tallest = count;
      const fresh = counts.map((count) => count / tallest);
      if (levels.length === bins) {
        for (let i = 0; i < bins; i++) {
          levels[i] = levels[i]! * (1 - smoothing) + fresh[i]! * smoothing;
        }
      } else {
        levels = fresh;
      }

      const barWidth = width / bins;
      ctx.fillStyle = source.color;
      for (let i = 0; i < bins; i++) {
        // Quantised to whole pixels so every bar has the same crisp edge --
        // a half-covered pixel is the one thing a cell grid cannot express.
        const barHeight = Math.round(levels[i]! * (height - 2));
        if (barHeight <= 0) continue;
        const x = Math.round(i * barWidth);
        const w = Math.max(1, Math.round((i + 1) * barWidth) - x - 1);
        ctx.fillRect(x, height - barHeight, w, barHeight);
      }

      const theory = source.theory?.() ?? null;
      if (theory) {
        let apex = 0;
        const samples: number[] = [];
        for (let i = 0; i < bins; i++) {
          const density = theory((i + 0.5) * binWidth);
          samples.push(density);
          if (density > apex) apex = density;
        }
        if (apex > 0) {
          ctx.beginPath();
          for (let i = 0; i < bins; i++) {
            const x = (i + 0.5) * barWidth;
            const y = height - (samples[i]! / apex) * (height - 2);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = "#ffc861";
          ctx.lineWidth = 1.6;
          ctx.lineJoin = "round";
          ctx.stroke();
        }
        if (!legend.childElementCount && source.theoryLabel) {
          const entry = document.createElement("span");
          const swatch = document.createElement("i");
          swatch.style.background = "#ffc861";
          entry.append(swatch, document.createTextNode(source.theoryLabel));
          legend.append(entry);
        }
      } else if (legend.childElementCount) {
        legend.replaceChildren();
      }

      noteEl.textContent = `0 – ${peak.toFixed(1)} m/s`;
    },
  };
}
