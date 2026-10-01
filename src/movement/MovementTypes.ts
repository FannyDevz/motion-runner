export type Lane = "LEFT" | "CENTER" | "RIGHT";

export type Movement = Lane | "JUMP" | "CROUCH";

export interface MovementEvent {
  movement: Movement;
  /** 0..1 confidence of the pose data behind this event. */
  confidence: number;
  /** Timestamp (ms) of the pose frame that triggered the event. */
  timestamp: number;
}

export type JumpState = "GROUNDED" | "AIRBORNE" | "COOLDOWN";

export type CrouchState = "STANDING" | "LOWERING" | "CROUCHING";

/** Current detector state, mainly for debug display and tuning. */
export interface MovementSnapshot {
  tracking: boolean;
  baselineReady: boolean;
  confidence: number;
  lane: Lane | null;
  /** Smoothed normalized body-center x. */
  centerX: number;
  jumpState: JumpState;
  crouchState: CrouchState;
  /** Hip height above baseline, in torso units (positive = up). */
  displacement: number;
  kneeAngleDeg: number | null;
  /** Baseline standing hip y (normalized), or null before warm-up. */
  baselineHipY: number | null;
  /** Baseline torso length (normalized image height), or null before warm-up. */
  torsoLength: number | null;
  lastEvent: MovementEvent | null;
}
