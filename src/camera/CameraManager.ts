import type { CameraConfig } from "../config/gameConfig";

export class CameraError extends Error {
  constructor(
    message: string,
    readonly reason: "unsupported" | "denied" | "not-found" | "unknown",
  ) {
    super(message);
  }
}

/** Owns the webcam stream. The stream stays local and is never uploaded. */
export class CameraManager {
  private stream: MediaStream | null = null;

  constructor(
    private readonly video: HTMLVideoElement,
    private readonly config: CameraConfig,
  ) {}

  async start(): Promise<void> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError("Browser ini tidak mendukung akses kamera (butuh HTTPS atau localhost).", "unsupported");
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: this.config.facingMode,
          width: { ideal: this.config.idealWidth },
          height: { ideal: this.config.idealHeight },
          frameRate: { ideal: this.config.idealFrameRate },
        },
      });
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        throw new CameraError("Izin kamera ditolak.", "denied");
      }
      if (name === "NotFoundError" || name === "OverconstrainedError") {
        throw new CameraError("Kamera yang cocok tidak ditemukan.", "not-found");
      }
      throw new CameraError(`Kamera tidak bisa dinyalakan: ${String(err)}`, "unknown");
    }

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
  }

  get width(): number {
    return this.video.videoWidth;
  }

  get height(): number {
    return this.video.videoHeight;
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
