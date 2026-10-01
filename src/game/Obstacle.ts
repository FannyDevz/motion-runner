import type { RunnerCollisionConfig } from "../config/gameConfig";
import type { Lane } from "../movement/MovementTypes";
import type { Player } from "./Player";

/**
 * BARRIER: blocks a lane, avoid by changing lane.
 * LOW: hurdle, clear it by jumping.
 * HIGH: overhead bar, clear it by crouching.
 */
export type ObstacleKind = "BARRIER" | "LOW" | "HIGH";

export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  lane: Lane;
  /** Travel progress: 0 at spawn (horizon), 1 at the player line. */
  progress: number;
  /** Set once the obstacle has been resolved against the player. */
  passed: boolean;
}

/** True when the obstacle is inside the hit zone around the player line. */
export function inHitZone(obstacle: Obstacle, config: RunnerCollisionConfig): boolean {
  return Math.abs(obstacle.progress - 1) <= config.hitHalfDepth;
}

/** True when the player avoids this obstacle at this instant. */
export function isAvoided(obstacle: Obstacle, player: Player): boolean {
  if (obstacle.lane !== player.lane) return true;
  switch (obstacle.kind) {
    case "BARRIER":
      return false;
    case "LOW":
      return player.isAirborne;
    case "HIGH":
      return player.isCrouching;
  }
}

export function collides(obstacle: Obstacle, player: Player, config: RunnerCollisionConfig): boolean {
  return inHitZone(obstacle, config) && !isAvoided(obstacle, player);
}
