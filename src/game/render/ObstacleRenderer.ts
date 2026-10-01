import type * as Phaser from "phaser";
import type { Theme } from "../../ui/theme";
import type { Obstacle } from "../Obstacle";
import { LANE_COUNT, type TrackGeometry } from "./TrackGeometry";

/** Obstacle height at the player line, as a fraction of the view height. */
const BASE_HEIGHT_FRACTION = 0.09;
const HURDLE_STRIPES = 7;
const BANNER_STRIPES = 10;

/**
 * Draws one obstacle with the track's perspective:
 *  - BARRIER: a stack of gym mats you have to go around.
 *  - LOW: a track hurdle you jump over.
 *  - HIGH: a limbo bar on two poles, with a hazard-striped banner you crouch under.
 */
export function drawObstacle(
  g: Phaser.GameObjects.Graphics,
  geo: TrackGeometry,
  viewHeight: number,
  o: Pick<Obstacle, "kind" | "lane" | "progress" | "passed">,
  theme: Theme,
  outline: number | null,
): void {
  const t = Math.min(o.progress, 1.25);
  const s = geo.scaleAt(t);
  const x = geo.laneX(["LEFT", "CENTER", "RIGHT"].indexOf(o.lane), t);
  const y = geo.yAt(t);
  const w = (geo.roadWidthAt(t) / LANE_COUNT) * 0.8;
  const baseH = viewHeight * BASE_HEIGHT_FRACTION * s;
  const alpha = o.passed ? 0.5 : 1;

  // Contact shadow on the track.
  g.fillStyle(theme.ink, 0.28 * alpha).fillEllipse(x, y, w * 1.02, 10 * s);

  switch (o.kind) {
    case "BARRIER":
      drawMats(g, x, y, w, baseH, s, theme, outline, alpha);
      break;
    case "LOW":
      drawHurdle(g, x, y, w, baseH * 0.62, s, theme, outline, alpha);
      break;
    case "HIGH":
      drawLimboBar(g, x, y, w, baseH, s, theme, outline, alpha);
      break;
  }
}

function stroke(g: Phaser.GameObjects.Graphics, outline: number | null, alpha: number, width: number): void {
  if (outline !== null) g.lineStyle(width, outline, alpha);
}

function drawMats(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, s: number, theme: Theme, outline: number | null, alpha: number): void {
  const left = x - w / 2;
  const topH = h * 0.2;
  const frontTop = y - h + topH;

  // Front face, then a lighter top face that is a little narrower, which reads as depth.
  g.fillStyle(theme.mat, alpha).fillRoundedRect(left, frontTop, w, h - topH, 4 * s);
  g.fillStyle(theme.matDark, alpha).fillRect(left, y - 5 * s, w, 5 * s);
  const inset = 7 * s;
  g.fillStyle(theme.chalkBlue, alpha).fillRoundedRect(left + inset, y - h, w - inset * 2, topH + 2 * s, 4 * s);

  // Stitching and a carrying strap.
  g.lineStyle(Math.max(1, 1.5 * s), theme.matDark, 0.7 * alpha);
  const mid = frontTop + (h - topH) * 0.45;
  g.lineBetween(left + 5 * s, mid, left + w - 5 * s, mid);
  g.fillStyle(theme.paper, alpha).fillRoundedRect(x - 9 * s, frontTop + 5 * s, 18 * s, 5 * s, 2.5 * s);

  if (outline !== null) {
    stroke(g, outline, alpha, 2);
    g.strokeRoundedRect(left, frontTop, w, h - topH, 4 * s);
  }
}

function drawHurdle(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, s: number, theme: Theme, outline: number | null, alpha: number): void {
  const left = x - w / 2;
  const barH = h * 0.3;
  const legW = Math.max(3, w * 0.07);

  // Feet and uprights.
  g.fillStyle(theme.ink, alpha);
  for (const lx of [left + w * 0.06, left + w * 0.94 - legW * 2]) g.fillRect(lx - legW, y - 4 * s, legW * 4, 4 * s);
  g.fillStyle(theme.paper, alpha);
  g.fillRect(left + w * 0.06, y - h, legW, h);
  g.fillRect(left + w * 0.94 - legW, y - h, legW, h);

  // The bar, in red and white stripes.
  const stripeW = w / HURDLE_STRIPES;
  for (let i = 0; i < HURDLE_STRIPES; i++) {
    g.fillStyle(i % 2 === 0 ? theme.bad : theme.paper, alpha).fillRect(left + i * stripeW, y - h, stripeW + 0.5, barH);
  }
  if (outline !== null) {
    stroke(g, outline, alpha, 2);
    g.strokeRect(left, y - h, w, barH);
  }
}

function drawLimboBar(g: Phaser.GameObjects.Graphics, x: number, y: number, w: number, h: number, s: number, theme: Theme, outline: number | null, alpha: number): void {
  const left = x - w / 2;
  const lift = h * 1.1;
  const bannerH = h * 0.34;
  const poleW = Math.max(3, w * 0.07);
  const top = y - lift - bannerH;

  // Wooden poles on small bases.
  g.fillStyle(theme.frameDark, alpha);
  g.fillRect(left, top, poleW, lift + bannerH);
  g.fillRect(left + w - poleW, top, poleW, lift + bannerH);
  g.fillStyle(theme.ink, alpha);
  g.fillRect(left - poleW, y - 4 * s, poleW * 3, 4 * s);
  g.fillRect(left + w - poleW * 2, y - 4 * s, poleW * 3, 4 * s);

  // Hazard-striped banner.
  const stripeW = w / BANNER_STRIPES;
  for (let i = 0; i < BANNER_STRIPES; i++) {
    g.fillStyle(i % 2 === 0 ? theme.whistle : theme.ink, alpha).fillRect(left + i * stripeW, top, stripeW + 0.5, bannerH);
  }
  if (outline !== null) {
    stroke(g, outline, alpha, 2);
    g.strokeRect(left, top, w, bannerH);
  }
}
