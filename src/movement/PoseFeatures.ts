import { LandmarkIndex, type PoseFrame, type PoseLandmark } from "../pose/PoseTypes";
import { isVisible } from "../pose/PoseUtils";

/** Per-frame body measurements derived from landmarks. */
export interface PoseFeatures {
  valid: boolean;
  timestamp: number;
  /** Mean visibility of the four torso landmarks. */
  confidence: number;
  /** Hip-midpoint x, normalized. */
  centerX: number;
  /** Hip-midpoint y, normalized (0 = top). */
  hipY: number;
  /** Vertical shoulder-mid → hip-mid distance, normalized to image height. */
  torsoLength: number;
  /** Mean visible knee angle in degrees (180 = straight), or null if knees are not visible. */
  kneeAngleDeg: number | null;
}

export function createPoseFeatures(): PoseFeatures {
  return { valid: false, timestamp: 0, confidence: 0, centerX: 0, hipY: 0, torsoLength: 0, kneeAngleDeg: null };
}

/**
 * Angle at `b` formed by a-b-c, in degrees. `aspectRatio` (width / height)
 * converts normalized x into the same scale as y so angles are not distorted.
 */
export function jointAngleDeg(a: PoseLandmark, b: PoseLandmark, c: PoseLandmark, aspectRatio: number): number {
  const abx = (a.x - b.x) * aspectRatio;
  const aby = a.y - b.y;
  const cbx = (c.x - b.x) * aspectRatio;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag === 0) return 180;
  const cos = Math.min(1, Math.max(-1, dot / mag));
  return (Math.acos(cos) * 180) / Math.PI;
}

function kneeAngle(
  lm: readonly PoseLandmark[],
  hip: number,
  knee: number,
  ankle: number,
  minVisibility: number,
  aspectRatio: number,
): number | null {
  const h = lm[hip];
  const k = lm[knee];
  const a = lm[ankle];
  if (!isVisible(h, minVisibility) || !isVisible(k, minVisibility) || !isVisible(a, minVisibility)) return null;
  return jointAngleDeg(h, k, a, aspectRatio);
}

/**
 * Extracts features into `out` (reused to avoid allocations). The result is
 * invalid when the torso is not fully visible or confidence is too low.
 */
export function extractPoseFeatures(
  pose: PoseFrame,
  minLandmarkVisibility: number,
  minPoseConfidence: number,
  aspectRatio: number,
  out: PoseFeatures,
): PoseFeatures {
  out.timestamp = pose.timestamp;
  out.valid = false;
  out.kneeAngleDeg = null;
  if (!pose.detected) {
    out.confidence = 0;
    return out;
  }

  const lm = pose.landmarks;
  const ls = lm[LandmarkIndex.LEFT_SHOULDER];
  const rs = lm[LandmarkIndex.RIGHT_SHOULDER];
  const lh = lm[LandmarkIndex.LEFT_HIP];
  const rh = lm[LandmarkIndex.RIGHT_HIP];

  out.confidence = (ls.visibility + rs.visibility + lh.visibility + rh.visibility) / 4;
  const torsoVisible =
    isVisible(ls, minLandmarkVisibility) &&
    isVisible(rs, minLandmarkVisibility) &&
    isVisible(lh, minLandmarkVisibility) &&
    isVisible(rh, minLandmarkVisibility);
  if (!torsoVisible || out.confidence < minPoseConfidence) return out;

  const shoulderY = (ls.y + rs.y) / 2;
  out.centerX = (lh.x + rh.x) / 2;
  out.hipY = (lh.y + rh.y) / 2;
  out.torsoLength = out.hipY - shoulderY;
  // Upside-down or degenerate torso: treat as unreliable.
  if (out.torsoLength <= 0) return out;

  const left = kneeAngle(lm, LandmarkIndex.LEFT_HIP, LandmarkIndex.LEFT_KNEE, LandmarkIndex.LEFT_ANKLE, minLandmarkVisibility, aspectRatio);
  const right = kneeAngle(lm, LandmarkIndex.RIGHT_HIP, LandmarkIndex.RIGHT_KNEE, LandmarkIndex.RIGHT_ANKLE, minLandmarkVisibility, aspectRatio);
  if (left !== null && right !== null) out.kneeAngleDeg = (left + right) / 2;
  else out.kneeAngleDeg = left ?? right;

  out.valid = true;
  return out;
}
