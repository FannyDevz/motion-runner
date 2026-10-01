import type { DebugConfig } from "../config/gameConfig";
import type { Point2D, PoseFrame } from "../pose/PoseTypes";

const COLORS = {
  connection: "rgba(0, 220, 255, 0.85)",
  landmark: "#ffffff",
  landmarkLowConfidence: "rgba(255, 90, 90, 0.7)",
  bodyCenter: "#ffd400",
  laneGuide: "rgba(255, 255, 255, 0.25)",
};

/** Draws the skeleton, landmarks and body center onto a canvas overlay. */
export class PoseOverlayRenderer {
  private readonly ctx: CanvasRenderingContext2D;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly config: DebugConfig,
    private readonly connections: ReadonlyArray<readonly [number, number]>,
    private readonly minVisibility: number,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable.");
    this.ctx = ctx;
  }

  /** Match the canvas backing store to the source video resolution. */
  resize(width: number, height: number): void {
    if (this.canvas.width !== width) this.canvas.width = width;
    if (this.canvas.height !== height) this.canvas.height = height;
  }

  render(pose: PoseFrame | null, bodyCenter: Point2D | null, laneGuides: readonly number[]): void {
    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    this.drawLaneGuides(laneGuides, w, h);
    if (!pose?.detected) return;

    const lm = pose.landmarks;

    ctx.lineWidth = this.config.connectionWidthPx;
    ctx.strokeStyle = COLORS.connection;
    ctx.beginPath();
    for (const [a, b] of this.connections) {
      const pa = lm[a];
      const pb = lm[b];
      if (pa.visibility < this.minVisibility || pb.visibility < this.minVisibility) continue;
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
    }
    ctx.stroke();

    const r = this.config.landmarkRadiusPx;
    for (const p of lm) {
      ctx.fillStyle = p.visibility >= this.minVisibility ? COLORS.landmark : COLORS.landmarkLowConfidence;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, r, 0, Math.PI * 2);
      ctx.fill();
    }

    if (bodyCenter) {
      ctx.fillStyle = COLORS.bodyCenter;
      ctx.beginPath();
      ctx.arc(bodyCenter.x * w, bodyCenter.y * h, this.config.bodyCenterRadiusPx, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private drawLaneGuides(guides: readonly number[], w: number, h: number): void {
    const { ctx } = this;
    ctx.strokeStyle = COLORS.laneGuide;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 10]);
    ctx.beginPath();
    for (const x of guides) {
      ctx.moveTo(x * w, 0);
      ctx.lineTo(x * w, h);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
