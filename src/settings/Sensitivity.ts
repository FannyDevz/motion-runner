import type { MovementConfig, MovementSensitivity, PresetsConfig } from "../config/gameConfig";

/**
 * Scales how big and how long a movement must be to count, on top of whatever the thresholds
 * already are (defaults or calibrated). "high" reacts to smaller, quicker movements; "low"
 * asks for bigger, more deliberate ones. Lane boundaries do not move, only how readily
 * the lane switches.
 */
export function applySensitivity(movement: MovementConfig, level: MovementSensitivity, presets: PresetsConfig): MovementConfig {
  const { threshold, time } = presets.sensitivity[level];
  if (threshold === 1 && time === 1) return movement;
  return {
    ...movement,
    lane: {
      ...movement.lane,
      hysteresis: movement.lane.hysteresis * threshold,
      minStableMs: Math.round(movement.lane.minStableMs * time),
    },
    jump: {
      ...movement.jump,
      minimumDisplacement: movement.jump.minimumDisplacement * threshold,
      confirmMs: Math.round(movement.jump.confirmMs * time),
    },
    crouch: {
      ...movement.crouch,
      enterDrop: movement.crouch.enterDrop * threshold,
      exitDrop: movement.crouch.exitDrop * threshold,
      minimumDurationMs: Math.round(movement.crouch.minimumDurationMs * time),
    },
  };
}
