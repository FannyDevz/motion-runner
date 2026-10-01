import type { RunnerViewConfig } from "../../config/gameConfig";

/** Number of lanes the road is divided into. */
export const LANE_COUNT = 3;

/**
 * The simple perspective used for everything on the road: depth `t` runs from 0 at the horizon
 * to 1 at the player line, and keeps going past 1 towards the bottom of the screen. Obstacles,
 * gates, lane lines and the runner all use the same mapping so they agree on where things are.
 */
export class TrackGeometry {
  constructor(private readonly view: RunnerViewConfig) {}

  get horizonY(): number {
    return this.view.height * this.view.horizonY;
  }

  get playerY(): number {
    return this.view.height * this.view.playerY;
  }

  /** Screen y at depth t. */
  yAt(t: number): number {
    return this.horizonY + (this.playerY - this.horizonY) * t;
  }

  /** The depth that sits at screen y (inverse of yAt). */
  depthAtY(y: number): number {
    return (y - this.horizonY) / (this.playerY - this.horizonY);
  }

  /** Depth of the bottom edge of the screen. */
  get bottomDepth(): number {
    return this.depthAtY(this.view.height);
  }

  /** Width of the track at depth t. */
  roadWidthAt(t: number): number {
    const { width, roadWidthTop, roadWidthBottom } = this.view;
    return width * (roadWidthTop + (roadWidthBottom - roadWidthTop) * t);
  }

  /** Left edge of the track at depth t. */
  roadLeftAt(t: number): number {
    return this.view.width / 2 - this.roadWidthAt(t) / 2;
  }

  /** Screen x of the centre of a (possibly fractional) lane at depth t. */
  laneX(lane: number, t: number): number {
    const laneW = this.roadWidthAt(t) / LANE_COUNT;
    return this.roadLeftAt(t) + laneW * (lane + 0.5);
  }

  /** Screen x of the line between lane `divider - 1` and lane `divider` (0 = left edge, LANE_COUNT = right edge). */
  dividerX(divider: number, t: number): number {
    return this.roadLeftAt(t) + (this.roadWidthAt(t) / LANE_COUNT) * divider;
  }

  /** How big things look at depth t, from `minScale` at the horizon to 1 at the player line. */
  scaleAt(t: number): number {
    const min = this.view.obstacleMinScale;
    return min + (1 - min) * t;
  }
}
