import * as Phaser from "phaser";
import type { Theme } from "../../ui/theme";
import { LANE_COUNT, type TrackGeometry } from "./TrackGeometry";

/** Number of mowing stripes / track bands from the horizon to the bottom of the screen. */
const GRASS_BANDS = 9;
const TRACK_BANDS = 14;
/** A pale cross-line is drawn on every Nth track band, as distance marks. */
const MARK_EVERY = 4;
const CONE_EVERY = 2;
const CONE_SIZE_PX = 15;
const CONE_GAP_PX = 22;
const DIVIDER_WIDTH_PX = 3;
const CURB_WIDTH_PX = 6;

/** Small deterministic PRNG (mulberry32) so the crowd looks the same every time. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerpColor(a: number, b: number, t: number): number {
  const ar = (a >> 16) & 255;
  const ag = (a >> 8) & 255;
  const ab = a & 255;
  const r = Math.round(ar + (((b >> 16) & 255) - ar) * t);
  const g = Math.round(ag + (((b >> 8) & 255) - ag) * t);
  const bl = Math.round(ab + ((b & 255) - ab) * t);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Paints the part of the stadium above the horizon once, into a texture: a sky, floodlights,
 * three tiers of stands full of spectators, and advertising boards along the wall. The track
 * itself is drawn every frame by drawGround().
 */
export function createBackdropTexture(scene: Phaser.Scene, key: string, width: number, height: number, theme: Theme, highContrast: boolean): void {
  if (scene.textures.exists(key)) scene.textures.remove(key);
  const g = scene.make.graphics({ x: 0, y: 0 }, false);

  if (highContrast) {
    g.fillStyle(0x000000, 1).fillRect(0, 0, width, height);
    g.generateTexture(key, width, height);
    g.destroy();
    return;
  }

  // Sky: a vertical blend painted as thin strips.
  const strips = 28;
  for (let i = 0; i < strips; i++) {
    g.fillStyle(lerpColor(theme.skyTop, theme.skyBottom, i / (strips - 1)), 1);
    g.fillRect(0, (height * i) / strips, width, height / strips + 1);
  }

  // Floodlight masts behind the stands.
  const mastTop = height * 0.04;
  for (const x of [width * 0.1, width * 0.9]) {
    g.fillStyle(theme.stand, 1).fillRect(x - 2, mastTop + 10, 4, height);
    g.fillStyle(theme.stand, 1).fillRect(x - 17, mastTop, 34, 16);
    g.fillStyle(theme.paper, 1);
    for (let col = 0; col < 3; col++) for (let row = 0; row < 2; row++) g.fillRect(x - 15 + col * 11, mastTop + 2 + row * 7, 9, 5);
  }

  // Stands: tiers that step up away from the track, with a roof line on top.
  const standTop = height * 0.3;
  const wallTop = height - 14;
  g.fillStyle(theme.stand, 1).fillRect(0, standTop, width, wallTop - standTop);
  g.fillStyle(lerpColor(theme.stand, 0x000000, 0.35), 1).fillRect(0, standTop - 5, width, 5);

  const crowdColors = [theme.chalkYellow, theme.chalkBlue, theme.chalkPink, theme.chalkGreen, theme.paper, theme.track, theme.whistle];
  const rand = seededRandom(20260401);
  const tiers = 5;
  const tierHeight = (wallTop - standTop) / tiers;
  for (let tier = 0; tier < tiers; tier++) {
    const y = standTop + tier * tierHeight;
    g.fillStyle(lerpColor(theme.stand, 0x000000, 0.12 * (tiers - tier) * 0.5), 1).fillRect(0, y, width, tierHeight - 1);
    // Spectators: a body and a head, in a few colours, a little scattered.
    for (let x = 4; x < width; x += 9) {
      if (rand() < 0.12) continue; // an empty seat
      const cx = x + (rand() - 0.5) * 3;
      const color = crowdColors[Math.floor(rand() * crowdColors.length)];
      g.fillStyle(color, 1).fillRoundedRect(cx - 3, y + tierHeight * 0.45, 7, tierHeight * 0.5, 2);
      g.fillStyle(lerpColor(0xe8c4a0, 0x8d5a3c, rand()), 1).fillCircle(cx + 0.5, y + tierHeight * 0.32, 2.6);
    }
  }

  // Advertising boards along the wall in front of the stands.
  const boardColors = [theme.whistle, theme.mat, theme.paper, theme.track, theme.chalkGreen];
  const boardW = 48;
  for (let i = 0, x = 0; x < width; i++, x += boardW) {
    g.fillStyle(boardColors[i % boardColors.length], 1).fillRect(x, wallTop, boardW - 2, 14);
    g.fillStyle(theme.ink, 0.28).fillRect(x + 6, wallTop + 5, boardW - 14, 3);
  }
  g.fillStyle(theme.ink, 1).fillRect(0, height - 2, width, 2);

  g.generateTexture(key, width, height);
  g.destroy();
}

export interface GroundOptions {
  /** High contrast: plain black ground with white lines and no stripes. */
  highContrast: boolean;
}

/**
 * Draws the mown infield and the running track below the horizon. `distance` is how far the
 * runner has travelled, in the same depth units as obstacle progress (so the ground moves at
 * exactly the speed of the things on it). It is continuous and never wraps, so the stripes keep
 * a steady colour as they scroll toward the player.
 */
export function drawGround(g: Phaser.GameObjects.Graphics, geo: TrackGeometry, theme: Theme, width: number, height: number, distance: number, options: GroundOptions): void {
  const horizon = geo.horizonY;
  const bottomDepth = geo.bottomDepth;

  // Infield grass, with mowing stripes.
  g.fillStyle(theme.grass, 1).fillRect(0, horizon, width, height - horizon);
  if (!options.highContrast) {
    const u = (distance * GRASS_BANDS) / bottomDepth;
    const whole = Math.floor(u);
    const phase = u - whole;
    g.fillStyle(theme.grassLight, 1);
    for (let j = -1; j < GRASS_BANDS; j++) {
      const m = j - whole;
      if (((m % 2) + 2) % 2 !== 0) continue;
      const y0 = geo.yAt(Math.max(0, ((j + phase) / GRASS_BANDS) * bottomDepth));
      const y1 = geo.yAt(Math.min(bottomDepth, ((j + 1 + phase) / GRASS_BANDS) * bottomDepth));
      if (y1 > y0) g.fillRect(0, y0, width, y1 - y0);
    }
  }

  // The track: a base colour, with a slightly darker band every other step.
  const edge = (t: number): [number, number] => [geo.roadLeftAt(t), geo.roadLeftAt(t) + geo.roadWidthAt(t)];
  const [topL, topR] = edge(0);
  const [botL, botR] = edge(bottomDepth);
  g.fillStyle(theme.track, 1);
  g.fillTriangle(topL, horizon, topR, horizon, botR, height);
  g.fillTriangle(topL, horizon, botR, height, botL, height);

  const trackU = (distance * TRACK_BANDS) / bottomDepth;
  const whole = Math.floor(trackU);
  const phase = trackU - whole;
  if (!options.highContrast) {
    g.fillStyle(theme.trackDark, 1);
    for (let j = -1; j < TRACK_BANDS; j++) {
      const m = j - whole;
      if (((m % 2) + 2) % 2 !== 0) continue;
      const t0 = Math.max(0, ((j + phase) / TRACK_BANDS) * bottomDepth);
      const t1 = Math.min(bottomDepth, ((j + 1 + phase) / TRACK_BANDS) * bottomDepth);
      if (t1 <= t0) continue;
      const [l0, r0] = edge(t0);
      const [l1, r1] = edge(t1);
      const y0 = geo.yAt(t0);
      const y1 = geo.yAt(t1);
      g.fillTriangle(l0, y0, r0, y0, r1, y1);
      g.fillTriangle(l0, y0, r1, y1, l1, y1);
    }
  }

  // Lane lines: solid white, like a real track.
  g.lineStyle(DIVIDER_WIDTH_PX, theme.trackLine, 1);
  for (let d = 1; d < LANE_COUNT; d++) g.lineBetween(geo.dividerX(d, 0), horizon, geo.dividerX(d, bottomDepth), height);
  g.lineStyle(CURB_WIDTH_PX, theme.trackLine, 1);
  g.lineBetween(topL, horizon, botL, height);
  g.lineBetween(topR, horizon, botR, height);

  if (options.highContrast) return;

  // Distance marks across the track, and cones along both edges, scrolling with the stripes.
  for (let j = -1; j < TRACK_BANDS; j++) {
    const m = j - whole;
    const t = ((j + phase) / TRACK_BANDS) * bottomDepth;
    if (t <= 0.02 || t > bottomDepth) continue;
    const y = geo.yAt(t);
    const s = geo.scaleAt(t);
    const [l, r] = edge(t);

    if (((m % MARK_EVERY) + MARK_EVERY) % MARK_EVERY === 0) {
      g.fillStyle(theme.trackLine, 0.55).fillRect(l, y - 2 * s, r - l, 4 * s);
    }
    if (((m % CONE_EVERY) + CONE_EVERY) % CONE_EVERY === 0) {
      const size = CONE_SIZE_PX * s;
      for (const cx of [l - CONE_GAP_PX * s, r + CONE_GAP_PX * s]) {
        g.fillStyle(theme.ink, 0.25).fillEllipse(cx, y, size * 1.1, size * 0.35);
        g.fillStyle(theme.whistle, 1).fillTriangle(cx - size / 2, y, cx + size / 2, y, cx, y - size * 1.4);
        g.fillStyle(theme.paper, 1).fillRect(cx - size * 0.28, y - size * 0.72, size * 0.56, size * 0.22);
      }
    }
  }
}
