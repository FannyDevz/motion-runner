import { LANDMARK_COUNT, LandmarkIndex, type PoseFrame } from "../../pose/PoseTypes";

export interface SyntheticPoseOptions {
  /** Hip-midpoint x, normalized. */
  x?: number;
  /** Hip-midpoint y, normalized. */
  hipY?: number;
  torsoLength?: number;
  /** Distance from hip to knee and knee to ankle, normalized. */
  legLength?: number;
  /** Horizontal knee offset (forward bend); 0 = straight legs. */
  kneeOffset?: number;
  visibility?: number;
  detected?: boolean;
  timestamp?: number;
}

/** Builds a standing-person PoseFrame for detector tests. */
export function makePose(options: SyntheticPoseOptions = {}): PoseFrame {
  const {
    x = 0.5,
    hipY = 0.6,
    torsoLength = 0.25,
    legLength = 0.2,
    kneeOffset = 0,
    visibility = 0.95,
    detected = true,
    timestamp = 0,
  } = options;

  const landmarks = Array.from({ length: LANDMARK_COUNT }, () => ({ x, y: hipY, z: 0, visibility }));
  const set = (index: number, px: number, py: number): void => {
    landmarks[index] = { x: px, y: py, z: 0, visibility };
  };
  const half = 0.06;
  const shoulderY = hipY - torsoLength;
  set(LandmarkIndex.LEFT_SHOULDER, x - half, shoulderY);
  set(LandmarkIndex.RIGHT_SHOULDER, x + half, shoulderY);
  set(LandmarkIndex.LEFT_HIP, x - half / 2, hipY);
  set(LandmarkIndex.RIGHT_HIP, x + half / 2, hipY);
  set(LandmarkIndex.LEFT_KNEE, x - half / 2 + kneeOffset, hipY + legLength);
  set(LandmarkIndex.RIGHT_KNEE, x + half / 2 + kneeOffset, hipY + legLength);
  set(LandmarkIndex.LEFT_ANKLE, x - half / 2, hipY + legLength * 2);
  set(LandmarkIndex.RIGHT_ANKLE, x + half / 2, hipY + legLength * 2);

  return { detected, landmarks, confidence: visibility, timestamp };
}
