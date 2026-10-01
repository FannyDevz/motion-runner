import type { MovementSnapshot } from "../movement/MovementTypes";
import type { Point2D } from "../pose/PoseTypes";

export interface DebugStats {
  status: string;
  detected: boolean;
  confidence: number;
  bodyCenter: Point2D | null;
  renderFps: number;
  inferenceFps: number;
  inferenceMs: number;
  resolution: string;
  movement: MovementSnapshot;
}

/** Text readout of pose/debug stats. Hidden when debug mode is off. */
export class DebugPanel {
  private readonly fields = new Map<string, HTMLElement>();

  constructor(private readonly root: HTMLElement) {
    const rows: Array<[string, string]> = [
      ["status", "Status"],
      ["detected", "Person"],
      ["confidence", "Confidence"],
      ["bodyCenter", "Body center"],
      ["movement", "Movement"],
      ["lane", "Lane"],
      ["jump", "Jump"],
      ["crouch", "Crouch"],
      ["displacement", "Hip lift"],
      ["knee", "Knee angle"],
      ["renderFps", "Render FPS"],
      ["inferenceFps", "Pose FPS"],
      ["inferenceMs", "Inference"],
      ["resolution", "Camera"],
    ];
    for (const [key, label] of rows) {
      const row = document.createElement("div");
      row.className = "debug-row";
      const name = document.createElement("span");
      name.textContent = label;
      const value = document.createElement("span");
      value.className = "debug-value";
      row.append(name, value);
      root.append(row);
      this.fields.set(key, value);
    }
  }

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  update(stats: DebugStats): void {
    this.set("status", stats.status);
    this.set("detected", stats.detected ? "yes" : "no");
    this.set("confidence", stats.detected ? stats.confidence.toFixed(2) : "—");
    this.set(
      "bodyCenter",
      stats.bodyCenter ? `x ${stats.bodyCenter.x.toFixed(2)}  y ${stats.bodyCenter.y.toFixed(2)}` : "—",
    );
    const m = stats.movement;
    const last = m.lastEvent;
    this.set("movement", last ? `${last.movement} (${last.confidence.toFixed(2)})` : "—");
    this.set("lane", m.lane ?? "—");
    this.set("jump", m.baselineReady ? m.jumpState : "calibrating…");
    this.set("crouch", m.baselineReady ? m.crouchState : "calibrating…");
    this.set("displacement", m.baselineReady ? m.displacement.toFixed(2) : "—");
    this.set("knee", m.kneeAngleDeg === null ? "—" : `${m.kneeAngleDeg.toFixed(0)}°`);
    this.set("renderFps", stats.renderFps.toFixed(0));
    this.set("inferenceFps", stats.inferenceFps.toFixed(0));
    this.set("inferenceMs", `${stats.inferenceMs.toFixed(1)} ms`);
    this.set("resolution", stats.resolution);
  }

  private set(key: string, text: string): void {
    const el = this.fields.get(key);
    if (el && el.textContent !== text) el.textContent = text;
  }
}
