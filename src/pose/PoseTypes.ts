/**
 * Engine-agnostic pose types. Nothing outside src/pose should depend on
 * MediaPipe types directly.
 */

/** BlazePose 33-landmark topology (MediaPipe Pose indices). */
export const LandmarkIndex = {
  NOSE: 0,
  LEFT_EYE_INNER: 1,
  LEFT_EYE: 2,
  LEFT_EYE_OUTER: 3,
  RIGHT_EYE_INNER: 4,
  RIGHT_EYE: 5,
  RIGHT_EYE_OUTER: 6,
  LEFT_EAR: 7,
  RIGHT_EAR: 8,
  MOUTH_LEFT: 9,
  MOUTH_RIGHT: 10,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_PINKY: 17,
  RIGHT_PINKY: 18,
  LEFT_INDEX: 19,
  RIGHT_INDEX: 20,
  LEFT_THUMB: 21,
  RIGHT_THUMB: 22,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
  LEFT_HEEL: 29,
  RIGHT_HEEL: 30,
  LEFT_FOOT_INDEX: 31,
  RIGHT_FOOT_INDEX: 32,
} as const;

export type LandmarkName = keyof typeof LandmarkIndex;

export const LANDMARK_COUNT = 33;

/**
 * A single landmark in normalized image coordinates.
 * x: 0 (left of the displayed image) → 1 (right). y: 0 (top) → 1 (bottom).
 * When the camera is mirrored, x is already flipped so it matches what the player sees.
 */
export interface PoseLandmark {
  x: number;
  y: number;
  z: number;
  /** 0..1 likelihood that the landmark is visible. */
  visibility: number;
}

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Latest pose estimate. The estimator reuses this object between frames to
 * avoid per-frame allocations; copy values if you need to keep history.
 */
export interface PoseFrame {
  /** True when a person was detected in this frame. */
  detected: boolean;
  landmarks: PoseLandmark[];
  /** Overall pose confidence (mean visibility of core torso landmarks). */
  confidence: number;
  /** performance.now() timestamp of the source video frame. */
  timestamp: number;
}
