import type { Body } from "../physics/body";
import { Vec2 } from "../physics/vec";
import { alpha, darken, lighten } from "./color";

export interface BodyStyle {
  /** Draw a bright ring around the body, e.g. the one under the pointer. */
  highlight?: boolean;
  /** Dim it, for a "before" ghost or an inactive body. */
  ghost?: boolean;
  label?: string;
}

export interface VectorStyle {
  color: string;
  label?: string;
  /** Metres drawn per unit of the quantity. */
  scale?: number;
  dashed?: boolean;
  width?: number;
}

const GRID_DOT = "rgba(150, 160, 205, 0.3)";
const GRID_MAJOR = "rgba(150, 160, 205, 0.11)";
const TICK_TEXT = "rgba(120, 128, 160, 0.8)";

/**
 * Draws the world onto a 2-D canvas.
 *
 * The world is measured in metres and the camera keeps a fixed number of
 * metres vertically, so widening the window widens the *bench* rather than
 * magnifying it — bodies stay the same size on screen and the scale bar stays
 * honest.
 */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** Pixels per metre. */
  scale = 100;
  /** Visible world size in metres. */
  worldWidth = 8;
  worldHeight = 5;
  private cssWidth = 0;
  private cssHeight = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) throw new Error("This browser cannot provide a 2-D canvas context.");
    this.ctx = ctx;
  }

  /**
   * Match the backing store to the element and the device, and report the
   * world size that now fits. Returns true when the world dimensions changed.
   */
  resize(metresTall: number): boolean {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));

    const pixelWidth = Math.round(width * dpr);
    const pixelHeight = Math.round(height * dpr);
    if (this.canvas.width !== pixelWidth || this.canvas.height !== pixelHeight) {
      this.canvas.width = pixelWidth;
      this.canvas.height = pixelHeight;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.cssWidth = width;
    this.cssHeight = height;

    const scale = height / metresTall;
    const worldWidth = width / scale;
    const changed =
      Math.abs(scale - this.scale) > 1e-9 || Math.abs(worldWidth - this.worldWidth) > 1e-9;
    this.scale = scale;
    this.worldHeight = metresTall;
    this.worldWidth = worldWidth;
    return changed;
  }

  /** Canvas-relative client coordinates to world metres. */
  toWorld(clientX: number, clientY: number): Vec2 {
    const rect = this.canvas.getBoundingClientRect();
    return new Vec2((clientX - rect.left) / this.scale, (clientY - rect.top) / this.scale);
  }

  private x(metres: number): number {
    return metres * this.scale;
  }

  // -- frame -----------------------------------------------------------

  begin(): void {
    const { ctx } = this;
    ctx.fillStyle = "#0c0c12";
    ctx.fillRect(0, 0, this.cssWidth, this.cssHeight);
    this.drawGraticule();
  }

  /**
   * A blueprint grid with a ruler along two edges. Spacing adapts so the minor
   * division never collapses into a solid wash on a small screen.
   */
  /**
   * A lattice of dots at the minor intersections with hairlines on the
   * majors -- a terminal's cell grid rather than engineering graph paper.
   * Spacing adapts so the dots never crowd into a solid wash.
   */
  private drawGraticule(): void {
    const { ctx, scale } = this;
    const major = chooseMajorSpacing(scale);
    const minor = major / 4;

    ctx.save();
    ctx.lineWidth = 1;

    ctx.beginPath();
    for (let mx = major; mx < this.worldWidth; mx += major) {
      const px = Math.round(this.x(mx)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, this.cssHeight);
    }
    for (let my = major; my < this.worldHeight; my += major) {
      const py = Math.round(this.x(my)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(this.cssWidth, py);
    }
    ctx.strokeStyle = GRID_MAJOR;
    ctx.stroke();

    // Drawn as one path of tiny rectangles: a fill of many small paths is far
    // cheaper than an arc per dot, and at this size they read the same.
    ctx.beginPath();
    for (let my = minor; my < this.worldHeight; my += minor) {
      const py = Math.round(this.x(my));
      for (let mx = minor; mx < this.worldWidth; mx += minor) {
        ctx.rect(Math.round(this.x(mx)), py, 1, 1);
      }
    }
    ctx.fillStyle = GRID_DOT;
    ctx.fill();

    ctx.fillStyle = TICK_TEXT;
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textBaseline = "alphabetic";
    // The scale note sits over the bottom-right, so the ruler stops short of
    // it rather than printing underneath.
    const rulerLimit = this.cssWidth - 104;
    for (let m = major; m < this.worldWidth; m += major) {
      const px = this.x(m);
      if (px + 4 > rulerLimit) break;
      ctx.fillText(formatMetres(m), px + 4, this.cssHeight - 6);
    }
    ctx.restore();
  }

  // -- bodies ----------------------------------------------------------

  drawTrail(body: Body): void {
    const trail = body.trail;
    if (trail.length < 2) return;
    const { ctx, scale } = this;
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, body.radius * scale * 0.28);
    // Drawn in a few fading segments rather than one gradient stroke: canvas
    // gradients along an arbitrary path are far more expensive than this.
    const segments = 6;
    const per = Math.ceil((trail.length - 1) / segments);
    for (let s = 0; s < segments; s++) {
      const start = s * per;
      const end = Math.min(trail.length - 1, start + per);
      if (end <= start) break;
      ctx.beginPath();
      const first = trail[start]!;
      ctx.moveTo(this.x(first.x), this.x(first.y));
      for (let i = start + 1; i <= end; i++) {
        const point = trail[i]!;
        ctx.lineTo(this.x(point.x), this.x(point.y));
      }
      ctx.strokeStyle = alpha(body.color, 0.05 + 0.3 * ((s + 1) / segments));
      ctx.stroke();
    }
    ctx.restore();
  }

  drawBody(body: Body, style: BodyStyle = {}): void {
    const { ctx, scale } = this;
    const cx = this.x(body.position.x);
    const cy = this.x(body.position.y);
    const r = Math.max(1.5, body.radius * scale);

    ctx.save();
    ctx.globalAlpha = style.ghost ? 0.22 : 1;

    // A flat fill under a brighter rim. Shading a sphere would be the wrong
    // idiom here: a terminal has no light source, and the ring is what makes
    // a filled cell read as a distinct body against its neighbours.
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = darken(body.color, 0.42);
    ctx.fill();

    if (r > 2.2) {
      ctx.beginPath();
      ctx.arc(cx, cy, r - 0.75, 0, Math.PI * 2);
      ctx.strokeStyle = body.color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      ctx.fillStyle = body.color;
      ctx.fill();
    }

    if (body.spin !== 0 && r > 6) {
      // A mark that turns with the body; without it, rolling and sliding look
      // exactly the same.
      const mark = r * 0.52;
      ctx.beginPath();
      ctx.arc(
        cx + Math.cos(body.angle) * mark,
        cy + Math.sin(body.angle) * mark,
        Math.max(1, r * 0.13),
        0,
        Math.PI * 2,
      );
      ctx.fillStyle = lighten(body.color, 0.55);
      ctx.fill();
    }

    if (style.highlight) {
      // Selection as a bracketed cell, the terminal way of marking a target.
      const reach = r + 4;
      const arm = Math.max(3, r * 0.42);
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (const [sx, sy] of [
        [-1, -1],
        [1, -1],
        [-1, 1],
        [1, 1],
      ] as const) {
        ctx.moveTo(cx + sx * reach, cy + sy * reach - sy * arm);
        ctx.lineTo(cx + sx * reach, cy + sy * reach);
        ctx.lineTo(cx + sx * reach - sx * arm, cy + sy * reach);
      }
      ctx.stroke();
    }

    const label = style.label ?? body.label;
    if (label && r > 8) {
      ctx.font = `700 ${Math.min(12, r * 0.8)}px "JetBrains Mono", monospace`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = lighten(body.color, 0.7);
      ctx.fillText(label, cx, cy + r * 0.04);
    }

    ctx.restore();
  }

  // -- annotation ------------------------------------------------------

  /** An arrow from `origin` along `value`, scaled into metres. */
  drawVector(origin: Vec2, value: Vec2, style: VectorStyle): void {
    const metres = style.scale ?? 1;
    const dx = value.x * metres;
    const dy = value.y * metres;
    const lengthPx = Math.hypot(dx, dy) * this.scale;
    if (lengthPx < 5) return;

    const { ctx } = this;
    const x0 = this.x(origin.x);
    const y0 = this.x(origin.y);
    const x1 = this.x(origin.x + dx);
    const y1 = this.x(origin.y + dy);
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const head = Math.min(9, Math.max(5, lengthPx * 0.22));

    ctx.save();
    ctx.strokeStyle = style.color;
    ctx.fillStyle = style.color;
    ctx.lineWidth = style.width ?? 1.6;
    ctx.lineCap = "round";
    if (style.dashed) ctx.setLineDash([4, 4]);

    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1 - Math.cos(angle) * head * 0.7, y1 - Math.sin(angle) * head * 0.7);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(
      x1 - Math.cos(angle - 0.42) * head,
      y1 - Math.sin(angle - 0.42) * head,
    );
    ctx.lineTo(
      x1 - Math.cos(angle + 0.42) * head,
      y1 - Math.sin(angle + 0.42) * head,
    );
    ctx.closePath();
    ctx.fill();

    if (style.label && lengthPx > 26) {
      ctx.font = '600 11px "JetBrains Mono", monospace';
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const offsetX = Math.cos(angle + Math.PI / 2) * 11;
      const offsetY = Math.sin(angle + Math.PI / 2) * 11;
      ctx.fillStyle = style.color;
      ctx.fillText(style.label, (x0 + x1) / 2 + offsetX, (y0 + y1) / 2 + offsetY);
    }
    ctx.restore();
  }

  /**
   * An expanding ring marking a collision. `age` runs 0 to 1.
   *
   * Kept deliberately faint and small. In a dense gas there are thousands of
   * these a second, and at any louder setting the box fills with rings and the
   * particles themselves stop being the thing you are looking at.
   */
  drawImpact(position: Vec2, strength: number, age: number): void {
    const fade = 1 - age;
    const radius = (0.02 + Math.min(strength, 3) * 0.012 + age * 0.09) * this.scale;
    if (radius < 2) return;
    const { ctx } = this;
    ctx.save();
    ctx.beginPath();
    ctx.arc(this.x(position.x), this.x(position.y), radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(255, 200, 97, ${fade * fade * 0.42})`;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
  }

  /** A dashed guide line, for contact normals and aiming assistance. */
  drawGuide(from: Vec2, to: Vec2, color: string, dash: number[] = [5, 5]): void {
    const { ctx } = this;
    ctx.save();
    ctx.setLineDash(dash);
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(this.x(from.x), this.x(from.y));
    ctx.lineTo(this.x(to.x), this.x(to.y));
    ctx.stroke();
    ctx.restore();
  }

  drawCross(position: Vec2, color: string, size = 5): void {
    const { ctx } = this;
    const px = this.x(position.x);
    const py = this.x(position.y);
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(px - size, py);
    ctx.lineTo(px + size, py);
    ctx.moveTo(px, py - size);
    ctx.lineTo(px, py + size);
    ctx.stroke();
    ctx.restore();
  }

  /** A short caption pinned inside the viewport. */
  drawNote(text: string, x: number, y: number, color = "rgba(139, 155, 180, 0.9)"): void {
    const { ctx } = this;
    ctx.save();
    ctx.font = '11px "JetBrains Mono", monospace';
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
    ctx.restore();
  }
}

/** Pick a round grid spacing that stays legible at the current zoom. */
function chooseMajorSpacing(pixelsPerMetre: number): number {
  const candidates = [0.1, 0.25, 0.5, 1, 2, 5, 10, 25, 50, 100];
  for (const spacing of candidates) {
    if (spacing * pixelsPerMetre >= 70) return spacing;
  }
  return candidates[candidates.length - 1]!;
}

function formatMetres(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return `${rounded} m`;
}
