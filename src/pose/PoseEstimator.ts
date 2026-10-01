import {
  FilesetResolver,
  PoseLandmarker,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";
import type { PoseConfig } from "../config/gameConfig";
import { LANDMARK_COUNT, type PoseFrame, type PoseLandmark } from "./PoseTypes";
import { TORSO_LANDMARKS, meanVisibility } from "./PoseUtils";

/** Pairs of landmark indices forming the skeleton, for drawing. */
export const POSE_CONNECTIONS: ReadonlyArray<readonly [number, number]> =
  PoseLandmarker.POSE_CONNECTIONS.map((c) => [c.start, c.end] as const);

/**
 * Wraps MediaPipe PoseLandmarker and converts its output into engine-agnostic
 * PoseFrame objects. Runs fully on the client; no frames leave the device.
 */
export class PoseEstimator {
  private landmarker: PoseLandmarker | null = null;
  private lastVideoTimestampMs = -1;
  private readonly frame: PoseFrame;

  constructor(
    private readonly config: PoseConfig,
    private readonly mirror: boolean,
  ) {
    const landmarks: PoseLandmark[] = [];
    for (let i = 0; i < LANDMARK_COUNT; i++) landmarks.push({ x: 0, y: 0, z: 0, visibility: 0 });
    this.frame = { detected: false, landmarks, confidence: 0, timestamp: 0 };
  }

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(this.config.wasmBaseUrl);
    const modelAssetPath = this.config.modelUrlTemplate.replaceAll("{model}", this.config.model);
    const baseOptions = { modelAssetPath, delegate: this.config.delegate };
    const options = {
      runningMode: "VIDEO" as const,
      numPoses: 1,
      minPoseDetectionConfidence: this.config.minPoseDetectionConfidence,
      minPosePresenceConfidence: this.config.minPosePresenceConfidence,
      minTrackingConfidence: this.config.minTrackingConfidence,
    };

    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, { baseOptions, ...options });
    } catch (err) {
      if (this.config.delegate !== "GPU") throw err;
      console.warn("GPU delegate unavailable, falling back to CPU.", err);
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { ...baseOptions, delegate: "CPU" },
        ...options,
      });
    }
  }

  get ready(): boolean {
    return this.landmarker !== null;
  }

  /**
   * Run inference on the current video frame. Returns the shared PoseFrame
   * (mutated in place), or null if the frame could not be processed.
   */
  estimate(video: HTMLVideoElement, timestampMs: number): PoseFrame | null {
    if (!this.landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return null;
    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    if (timestampMs <= this.lastVideoTimestampMs) return null;
    this.lastVideoTimestampMs = timestampMs;

    const result = this.landmarker.detectForVideo(video, timestampMs);
    const detected = result.landmarks[0];
    this.frame.timestamp = timestampMs;

    if (!detected || detected.length < LANDMARK_COUNT) {
      this.frame.detected = false;
      this.frame.confidence = 0;
      return this.frame;
    }

    this.copyLandmarks(detected);
    this.frame.detected = true;
    this.frame.confidence = meanVisibility(this.frame.landmarks, TORSO_LANDMARKS);
    return this.frame;
  }

  private copyLandmarks(source: NormalizedLandmark[]): void {
    const target = this.frame.landmarks;
    for (let i = 0; i < LANDMARK_COUNT; i++) {
      const s = source[i];
      const t = target[i];
      t.x = this.mirror ? 1 - s.x : s.x;
      t.y = s.y;
      t.z = s.z;
      t.visibility = s.visibility ?? 0;
    }
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
