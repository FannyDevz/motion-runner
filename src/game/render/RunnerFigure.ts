import type * as Phaser from "phaser";

export interface RunnerPose {
  /** Screen x of the centre of the runner. */
  x: number;
  /** Screen y of the ground under the runner. */
  groundY: number;
  /** How far off the ground, in pixels. */
  lift: number;
  /** Jump arc height 0..1 (tucks the legs and throws the arms up). */
  jump: number;
  crouching: boolean;
  /** Running-cycle phase in radians; the legs and arms swing with it. */
  phase: number;
  /** Whether the legs and arms swing at all (off when standing still or reducing motion). */
  running: boolean;
}

export interface RunnerLook {
  /** Body colour. */
  body: number;
  /** Colour of the sticker-like outline around the figure. */
  outline: number;
  /** Colour of the race bib on the back. */
  bib: number;
  shoe: number;
  /** Overall size multiplier. */
  scale: number;
}

const HEAD_R = 9;
const TORSO_W = 24;
const TORSO_H = 30;
const LEG_LEN = 27;
const LEG_W = 9;
const ARM_LEN = 22;
const ARM_W = 7;
const OUTLINE_PX = 3;
const FOOT_LIFT_PX = 10;

function limb(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, width: number, color: number): void {
  g.lineStyle(width, color, 1).lineBetween(x0, y0, x1, y1);
  g.fillStyle(color, 1).fillCircle(x0, y0, width / 2).fillCircle(x1, y1, width / 2);
}

/**
 * A pictogram runner seen from behind, in the style of Olympic sport icons: a head, a torso with
 * a race bib, and swinging arms and legs. Drawn twice, first fatter in the outline colour and
 * then in the body colour, so it reads as a sticker on any background.
 */
export function drawRunner(g: Phaser.GameObjects.Graphics, pose: RunnerPose, look: RunnerLook): void {
  for (const pass of [0, 1] as const) {
    const grow = pass === 0 ? OUTLINE_PX * 2 : 0;
    const color = pass === 0 ? look.outline : look.body;
    drawFigure(g, pose, look.scale, color, grow, pass === 1 ? look : null);
  }
}

function drawFigure(g: Phaser.GameObjects.Graphics, p: RunnerPose, k: number, color: number, grow: number, detail: RunnerLook | null): void {
  const crouch = p.crouching ? 1 : 0;
  const legLen = LEG_LEN * k * (1 - 0.45 * crouch);
  const torsoH = TORSO_H * k * (1 - 0.15 * crouch);
  const torsoW = TORSO_W * k;
  const headR = HEAD_R * k;

  const feetY = p.groundY - p.lift;
  const hipY = feetY - legLen;
  const shoulderY = hipY - torsoH;
  const headY = shoulderY - headR - 3 * k + crouch * 2 * k;

  // Legs: they alternate lifting a foot when running, and tuck up in a jump.
  for (const side of [-1, 1]) {
    const hx = p.x + side * 6 * k;
    const lift = p.running && p.jump === 0 ? Math.max(0, Math.sin(p.phase + (side > 0 ? Math.PI : 0))) * FOOT_LIFT_PX * k : 0;
    const tuck = legLen * 0.5 * p.jump;
    const fy = feetY - lift - tuck;
    const fx = hx + side * (2 + crouch * 7 + p.jump * 3) * k;
    limb(g, hx, hipY, fx, fy, LEG_W * k + grow, color);
    if (detail) g.fillStyle(detail.shoe, 1).fillRoundedRect(fx - 6 * k, fy - 2 * k, 12 * k, 6 * k, 3 * k);
  }

  // Torso.
  g.fillStyle(color, 1).fillRoundedRect(p.x - torsoW / 2 - grow / 2, shoulderY - grow / 2, torsoW + grow, torsoH + grow, 8 * k);

  // Arms swing opposite to the legs, and go up in a jump.
  for (const side of [-1, 1]) {
    const sx = p.x + side * (torsoW / 2 - 1 * k);
    const sy = shoulderY + 5 * k;
    const swing = p.running && p.jump === 0 ? Math.sin(p.phase + (side > 0 ? 0 : Math.PI)) : 0;
    const armLen = ARM_LEN * k;
    const downY = sy + armLen * (0.85 + 0.15 * swing);
    const downX = sx + side * (5 + swing * 3) * k;
    const upY = sy - armLen * 0.75;
    const upX = sx + side * 9 * k;
    const ex = downX + (upX - downX) * p.jump;
    const ey = downY + (upY - downY) * p.jump;
    limb(g, sx, sy, ex, ey, ARM_W * k + grow, color);
  }

  // Head.
  g.fillStyle(color, 1).fillCircle(p.x, headY, headR + grow / 2);

  // Race bib on the back (only in the body pass).
  if (detail) {
    const bw = torsoW * 0.62;
    const bh = torsoH * 0.5;
    g.fillStyle(detail.bib, 1).fillRoundedRect(p.x - bw / 2, shoulderY + torsoH * 0.18, bw, bh, 3 * k);
    g.fillStyle(detail.body, 0.9);
    for (const cx of [p.x - bw / 2 + 3 * k, p.x + bw / 2 - 3 * k]) g.fillCircle(cx, shoulderY + torsoH * 0.18 + 3 * k, 1.2 * k);
  }
}
