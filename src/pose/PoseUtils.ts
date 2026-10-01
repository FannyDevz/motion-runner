import { LandmarkIndex, type Point2D, type PoseFrame, type PoseLandmark } from "./PoseTypes";

/** Core landmarks used to judge whether the torso is reliably tracked. */
export const TORSO_LANDMARKS: readonly number[] = [
  LandmarkIndex.LEFT_SHOULDER,
  LandmarkIndex.RIGHT_SHOULDER,
  LandmarkIndex.LEFT_HIP,
  LandmarkIndex.RIGHT_HIP,
];

export function isVisible(landmark: PoseLandmark | undefined, minVisibility: number): boolean {
  return landmark !== undefined && landmark.visibility >= minVisibility;
}

export function meanVisibility(landmarks: readonly PoseLandmark[], indices: readonly number[]): number {
  if (landmarks.length === 0 || indices.length === 0) return 0;
  let sum = 0;
  for (const i of indices) sum += landmarks[i]?.visibility ?? 0;
  return sum / indices.length;
}

function midpointInto(a: PoseLandmark, b: PoseLandmark, out: Point2D): Point2D {
  out.x = (a.x + b.x) / 2;
  out.y = (a.y + b.y) / 2;
  return out;
}

/**
 * Body center in normalized coordinates. Prefers the hip midpoint, falls back
 * to the shoulder midpoint, then to a single visible hip/shoulder.
 * Returns null when no reliable torso landmark is available.
 */
export function getBodyCenter(
  pose: PoseFrame,
  minVisibility: number,
  out: Point2D = { x: 0, y: 0 },
): Point2D | null {
  if (!pose.detected) return null;
  const lm = pose.landmarks;
  const lh = lm[LandmarkIndex.LEFT_HIP];
  const rh = lm[LandmarkIndex.RIGHT_HIP];
  const ls = lm[LandmarkIndex.LEFT_SHOULDER];
  const rs = lm[LandmarkIndex.RIGHT_SHOULDER];

  if (isVisible(lh, minVisibility) && isVisible(rh, minVisibility)) return midpointInto(lh, rh, out);
  if (isVisible(ls, minVisibility) && isVisible(rs, minVisibility)) return midpointInto(ls, rs, out);

  for (const single of [lh, rh, ls, rs]) {
    if (isVisible(single, minVisibility)) {
      out.x = single.x;
      out.y = single.y;
      return out;
    }
  }
  return null;
}
