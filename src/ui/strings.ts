import type { GameState } from "../game/GameState";
import type { Lane, Movement } from "../movement/MovementTypes";

/**
 * Player-facing text for everything outside the question content (HUD, overlays,
 * camera status, menu). One place, so the interface language is easy to change.
 * Question text and feedback wording live in the question data / questions config.
 */
export const strings = {
  game: {
    score: "Skor",
    ready: {
      title: "Siap berlari?",
      body: [
        "Tekan SPASI atau ketuk layar",
        "untuk mulai, atau lompat di depan kamera",
        "",
        "← →  pindah lajur",
        "↑ lompat     ↓ jongkok",
        "",
        "Jawab soal dengan berdiri di lajur",
        "jawabannya, atau lakukan gerakannya",
      ].join("\n"),
    },
    paused: { title: "Jeda", body: "Tekan P untuk lanjut" },
    readyAnnouncement: "Siap. Tekan spasi atau ketuk layar untuk mulai, atau lompat di depan kamera.",
    pausedAnnouncement: "Permainan dijeda. Tekan P untuk lanjut.",
    hiddenPaused: "Permainan dijeda karena tab disembunyikan.",
    gameOverTitle: "Game over",
    restart: "Tekan SPASI atau ketuk layar untuk main lagi",
    states: {
      READY: "Siap",
      RUNNING: "Berlari",
      SLOW_MOTION: "Slow motion",
      QUESTION: "Soal",
      WAITING_FOR_MOVEMENT: "Jawab!",
      RESUMING: "Lanjut",
      PAUSED: "Jeda",
      GAME_OVER: "Selesai",
    } satisfies Record<GameState, string>,
  },

  lanes: { LEFT: "Kiri", CENTER: "Tengah", RIGHT: "Kanan" } satisfies Record<Lane, string>,
  movements: {
    LEFT: "Kiri",
    CENTER: "Tengah",
    RIGHT: "Kanan",
    JUMP: "Lompat",
    CROUCH: "Jongkok",
  } satisfies Record<Movement, string>,

  calibration: {
    steps: {
      STAND: "Berdiri tegak",
      LEFT: "Geser ke kiri",
      RIGHT: "Geser ke kanan",
      JUMP: "Lompat",
      CROUCH: "Jongkok",
    },
    instructions: {
      STAND: "Berdirilah tegak di depan kamera dan diam sebentar.",
      LEFT: "Geser badanmu ke kiri dan tahan sebentar.",
      RIGHT: "Geser badanmu ke kanan dan tahan sebentar.",
      JUMP: "Lompatlah satu kali.",
      CROUCH: "Jongkoklah dan tahan sebentar.",
    },
    /** Shown when the movement is going the right way but has not gone far enough. */
    needMore: {
      STAND: "",
      LEFT: "Sedikit lagi ke kiri.",
      RIGHT: "Sedikit lagi ke kanan.",
      JUMP: "Lompat sedikit lebih tinggi.",
      CROUCH: "Jongkok sedikit lebih dalam.",
    },
    done: "Selesai! Gerakanmu sudah dikalibrasi.",
    notVisible: "Pemain tidak terlihat. Mundur sampai seluruh badan masuk kamera.",
    stepDone: " ✓",
    stepSkipped: " (dilewati)",
    needCamera: "Aktifkan kamera dulu untuk kalibrasi.",
    saved: "Kalibrasi tersimpan di perangkat ini.",
  },

  camera: {
    keyboardMode: "Mode keyboard. Aktifkan kamera untuk bermain dengan gerakan tubuh.",
    requesting: "Meminta izin kamera…",
    loadingModel: "Memuat model pose…",
    failed: "Kamera gagal dijalankan.",
    keyboardStillWorks: "Keyboard tetap bisa dipakai.",
    noPlayer: "Pemain tidak terdeteksi. Mundur sampai seluruh badan terlihat.",
    calibrating: "Berdiri diam sebentar…",
    readyToStart: "Siap. Lompat untuk mulai!",
    gameOver: "Game over. Lompat untuk main lagi.",
    tracking: (lane: string) => `Terdeteksi · ${lane}`,
    previewHint: "Gambar kamera hanya diproses di perangkatmu.",
    playerLost: "Pemain tidak terlihat. Kembali ke depan kamera untuk melanjutkan.",
  },
} as const;
