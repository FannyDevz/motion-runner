import "./style.css";
import { gameConfig } from "../config/gameConfig";
import { DebugPanel } from "../debug/DebugPanel";
import { PoseOverlayRenderer } from "../debug/PoseOverlayRenderer";
import { MotionInput } from "../input/MotionInput";
import { POSE_CONNECTIONS } from "../pose/PoseEstimator";
import { FpsCounter } from "../utils/FpsCounter";

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element.`);
  return el as T;
}

const video = requireElement<HTMLVideoElement>("webcam");
const canvas = requireElement<HTMLCanvasElement>("overlay");
const stage = requireElement<HTMLDivElement>("stage");
const startButton = requireElement<HTMLButtonElement>("start");
const message = requireElement<HTMLParagraphElement>("message");
const movementBanner = requireElement<HTMLDivElement>("movement-banner");

const params = new URLSearchParams(location.search);
let debugEnabled = params.has("debug") ? params.get("debug") !== "0" : gameConfig.debug.enabled;
let showVideo = gameConfig.debug.showVideo;

stage.classList.toggle("mirrored", gameConfig.camera.mirror);

const motion = new MotionInput(video, {
  camera: gameConfig.camera,
  pose: gameConfig.pose,
  movement: gameConfig.movement,
  fpsSampleWindowMs: gameConfig.debug.fpsSampleWindowMs,
});
const renderer = new PoseOverlayRenderer(canvas, gameConfig.debug, POSE_CONNECTIONS, gameConfig.pose.minLandmarkVisibility);
const debugPanel = new DebugPanel(requireElement("debug"));
const renderFps = new FpsCounter(gameConfig.debug.fpsSampleWindowMs);
const laneGuides = [gameConfig.movement.lane.thresholds.left, gameConfig.movement.lane.thresholds.right];

let bannerTimer = 0;
motion.on("movement", (event) => {
  movementBanner.textContent = event.movement;
  movementBanner.dataset.movement = event.movement;
  movementBanner.classList.add("show");
  window.clearTimeout(bannerTimer);
  bannerTimer = window.setTimeout(() => movementBanner.classList.remove("show"), 900);
});

function applyVisibility(): void {
  movementBanner.hidden = !debugEnabled;
  debugPanel.setVisible(debugEnabled);
  canvas.hidden = !debugEnabled;
  video.classList.toggle("hidden-video", !(debugEnabled && showVideo));
}

function setMessage(text: string): void {
  message.textContent = text;
  message.hidden = text === "";
}

const STATUS_TEXT: Record<string, string> = {
  idle: "idle",
  "starting-camera": "starting camera",
  "loading-model": "loading model",
  ready: "no person",
  error: "error",
};

function frame(now: number): void {
  renderFps.tick(now);
  if (debugEnabled) {
    const pose = motion.pose;
    renderer.resize(motion.videoWidth, motion.videoHeight);
    renderer.render(pose, motion.bodyCenter, laneGuides);
    debugPanel.update({
      status: pose?.detected ? "tracking" : (STATUS_TEXT[motion.status] ?? motion.status),
      detected: pose?.detected ?? false,
      confidence: pose?.confidence ?? 0,
      bodyCenter: motion.bodyCenter,
      renderFps: renderFps.fps,
      inferenceFps: motion.inferenceRate,
      inferenceMs: motion.inferenceMs,
      resolution: `${motion.videoWidth}×${motion.videoHeight}`,
      movement: motion.snapshot(),
    });
  }
  requestAnimationFrame(frame);
}

async function start(): Promise<void> {
  startButton.disabled = true;
  setMessage(`Starting camera and loading pose model (${gameConfig.pose.model})…`);
  const ok = await motion.start();
  if (ok) {
    setMessage("");
    startButton.hidden = true;
    stage.hidden = false;
  } else {
    startButton.disabled = false;
    setMessage(motion.error ?? "Failed to start.");
  }
}

window.addEventListener("keydown", (e) => {
  if (e.key === "d" || e.key === "D") {
    debugEnabled = !debugEnabled;
    applyVisibility();
  } else if (e.key === "v" || e.key === "V") {
    showVideo = !showVideo;
    applyVisibility();
  }
});

window.addEventListener("beforeunload", () => motion.stop());

startButton.addEventListener("click", () => void start());
applyVisibility();
requestAnimationFrame(frame);
