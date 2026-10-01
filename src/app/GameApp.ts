import * as Phaser from "phaser";
import "./app.css";
import { gameConfig, type MovementConfig, type RunnerConfig } from "../config/gameConfig";
import { PoseOverlayRenderer } from "../debug/PoseOverlayRenderer";
import { GameController } from "../game/GameController";
import { GameManager } from "../game/GameManager";
import { isActive } from "../game/GameState";
import { QuestionManager } from "../game/QuestionManager";
import { applyQuestionOverrides } from "../game/QuestionOverrides";
import { RunnerScene } from "../game/RunnerScene";
import { PresenceMonitor } from "../game/PresenceMonitor";
import { SoundManager, type SoundName } from "../audio/SoundManager";
import { MotionInput } from "../input/MotionInput";
import type { Movement } from "../movement/MovementTypes";
import { createPoseFeatures, extractPoseFeatures } from "../movement/PoseFeatures";
import { POSE_CONNECTIONS } from "../pose/PoseEstimator";
import type { QuestionBank, QuestionLoadResult } from "../questions";
import {
  CALIBRATION_STEPS,
  CalibrationSession,
  deriveMovementConfig,
  loadCalibration,
  saveCalibration,
  type CalibrationResult,
} from "../settings/Calibration";
import { applySensitivity } from "../settings/Sensitivity";
import { applySettings, loadSettings, saveSettings, type KeyValueStore, type PlayerSettings } from "../settings/Settings";
import { Announcer } from "../ui/Announcer";
import { Menu, type CategoryOption } from "../ui/Menu";
import { LAYOUT_RULES, computeLayout } from "./layout";
import { describeGameOver, describeQuestion, describeResult } from "../ui/narration";
import { strings } from "../ui/strings";

const TUTORIAL_SEEN_KEY = "motion-runner.tutorialSeen.v1";
const PREVIEW_BANNER_MS = 700;
const CALIBRATION_DONE_MS = 1600;
/** Aspect ratio assumed for knee-angle geometry during calibration (the detector learns the real one). */
const FALLBACK_ASPECT_RATIO = 16 / 9;
/** How long without a valid pose before the calibration screen warns that the player is not visible. */
const CALIBRATION_NOT_VISIBLE_MS = 1000;
/** The meters show hip movement up to this many torso lengths. */
const METER_MAX_TORSO = 0.6;

function requireElement<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id} element.`);
  return el as T;
}

/** localStorage, or null when the browser blocks it (private windows, strict settings). */
function safeStorage(): KeyValueStore | null {
  try {
    const probe = "__motion-runner-probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}

type Level = "ok" | "warn" | "error" | "info";

/**
 * Assembles the whole application: the Phaser runner, the webcam input, the menu and
 * the player's settings. Game rules live in GameManager; this class only wires things
 * together and owns the DOM around the canvas.
 */
export class GameApp {
  private readonly scene = new RunnerScene();
  private readonly store = safeStorage();
  private readonly bank: QuestionBank | null;
  private readonly motion: MotionInput;
  private readonly menu: Menu;
  private readonly overlay: PoseOverlayRenderer;
  private readonly laneGuides = [gameConfig.movement.lane.thresholds.left, gameConfig.movement.lane.thresholds.right];
  private readonly presence = new PresenceMonitor(gameConfig.input.presence);
  /** The thresholds in effect (defaults or calibrated, scaled by the sensitivity setting). */
  private movementConfig: MovementConfig = gameConfig.movement;
  private readonly sound = new SoundManager();
  private readonly announcer = new Announcer(requireElement("live"));
  private readonly calibFeatures = createPoseFeatures();
  private readonly phaser: Phaser.Game;

  private readonly video = requireElement<HTMLVideoElement>("webcam");
  private readonly canvas = requireElement<HTMLCanvasElement>("overlay");
  private readonly preview = requireElement<HTMLDivElement>("preview");
  private readonly previewMovement = requireElement<HTMLDivElement>("preview-movement");
  private readonly statusText = requireElement<HTMLParagraphElement>("camera-status");
  private readonly hint = requireElement<HTMLParagraphElement>("hint");
  private readonly presenceBanner = requireElement<HTMLDivElement>("presence-banner");
  private readonly meters = requireElement<HTMLDivElement>("meters");
  private readonly meterRows = {
    lane: this.meterRow("lane"),
    jump: this.meterRow("jump"),
    crouch: this.meterRow("crouch"),
  };
  private meterText = { lane: "", jump: "", crouch: "" };
  private calibrationScreenOpen = false;
  private readonly calibInstruction = requireElement<HTMLElement>("calib-instruction");
  private readonly calibBar = requireElement<HTMLElement>("calib-bar");
  private readonly calibSteps = requireElement<HTMLOListElement>("calib-steps");

  private settings: PlayerSettings;
  private manager!: GameManager;
  private controller!: GameController;
  private runnerConfig!: RunnerConfig;

  private needsRebuild = false;
  private pausedByMenu = false;
  private cameraStarting = false;
  private bannerTimer = 0;

  private calibration: CalibrationResult | null = null;
  private session: CalibrationSession | null = null;
  private calibLastStamp = -1;
  private calibInvalidSince: number | null = null;
  private calibDoneTimer = 0;

  private pausedByPresence = false;
  /** True once the camera has seen the player during this run, i.e. they are playing with their body. */
  private trackedThisRun = false;

  constructor(questions: QuestionLoadResult) {
    this.bank = questions.bank;
    const categories = this.categoryOptions();

    this.settings = loadSettings(
      this.store,
      categories.map((c) => c.id),
      { reducedMotion: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false },
    );
    this.applyAppearance();
    this.applyAudio();

    this.calibration = loadCalibration(this.store);
    const movement = this.movementFor(this.calibration);
    this.movementConfig = movement;
    this.laneGuides[0] = movement.lane.thresholds.left;
    this.laneGuides[1] = movement.lane.thresholds.right;

    this.motion = new MotionInput(this.video, {
      camera: gameConfig.camera,
      pose: gameConfig.pose,
      movement,
      fpsSampleWindowMs: gameConfig.debug.fpsSampleWindowMs,
    });
    this.overlay = new PoseOverlayRenderer(this.canvas, gameConfig.debug, POSE_CONNECTIONS, gameConfig.pose.minLandmarkVisibility);
    this.preview.classList.toggle("mirrored", gameConfig.camera.mirror);

    this.menu = new Menu(requireElement("menu"), categories, this.settings);
    this.buildSession();

    this.applyLayout(); // before Phaser measures its container
    const { view } = this.runnerConfig;
    this.phaser = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game",
      width: view.width,
      height: view.height,
      backgroundColor: "#0f1115",
      scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      scene: this.scene,
    });

    this.applyAppearance(); // now that the scene exists
    this.applyLayout();
    window.addEventListener("resize", () => this.applyLayout());
    window.addEventListener("orientationchange", () => this.applyLayout());
    this.wireMotion();
    this.wireMenu();
    this.wireWindow();

    // First visit: show how to play before anything else.
    const seen = this.readFlag(TUTORIAL_SEEN_KEY);
    this.menu.open(seen ? "main" : "howto");
    if (!seen) this.writeFlag(TUTORIAL_SEEN_KEY);
    this.refreshCameraState();
    this.reportQuestionProblems(questions);

    requestAnimationFrame(this.frame);
    this.exposeForDebugging();
  }

  // --- session (one game plus its question manager) --------------------------

  /** Tell the player (and the console) when a question file could not be used. */
  private reportQuestionProblems(result: QuestionLoadResult): void {
    if (result.problems.length === 0) return;
    console.error("Masalah pada file soal:\n- " + result.problems.join("\n- "));
    if (!result.bank) this.menu.setStatus("Soal tidak berhasil dimuat, jadi game berjalan tanpa soal. Lihat konsol (F12).", "error");
    else this.menu.setStatus(`${result.problems.length} masalah pada file soal; soal yang bermasalah dilewati. Lihat konsol (F12).`, "warn");
  }

  private categoryOptions(): CategoryOption[] {
    if (!this.bank) return [];
    const labels = gameConfig.runner.questions.categoryLabels;
    return this.bank.categories.map((id) => ({
      id,
      label: labels[id] ?? id,
      count: this.bank?.filterByCategory([id]).length ?? 0,
    }));
  }

  /** The runner config for the current settings, with URL overrides (?categories=…&difficulty=…) on top. */
  private buildConfig(): RunnerConfig {
    const fromSettings = applySettings(gameConfig.runner, this.settings, gameConfig.presets);
    return { ...fromSettings, questions: applyQuestionOverrides(fromSettings.questions, location.search) };
  }

  private createQuestionManager(config: RunnerConfig): QuestionManager | null {
    if (!config.questions.enabled || !this.bank) return null;
    try {
      return new QuestionManager(this.bank, config.questions);
    } catch (err) {
      console.error("Questions disabled:", err);
      return null;
    }
  }

  /** Create a fresh game from the current settings and show it. */
  private buildSession(): void {
    const config = this.buildConfig();
    const manager = new GameManager(config, Math.random, this.createQuestionManager(config));
    this.runnerConfig = config;
    this.manager = manager;
    this.controller = new GameController(manager, gameConfig.input, () => this.motion.snapshot().lane);
    this.scene.attach(manager, config);
    this.hookSession(manager, config);
    this.needsRebuild = false;
  }

  /** Sound effects and screen-reader announcements for one game's events. */
  private hookSession(manager: GameManager, config: RunnerConfig): void {
    const play = (name: SoundName): void => this.sound.play(name);
    const questions = config.questions;

    manager.on("playerAction", (movement) => play(movement === "JUMP" ? "jump" : movement === "CROUCH" ? "crouch" : "lane"));
    manager.on("questionWarning", () => {
      play("warning");
      this.announcer.announce(questions.text.warning);
    });
    manager.on("questionStarted", (session) => this.announcer.announce(describeQuestion(session.question, questions)));
    manager.on("questionAnswered", ({ question, result, score }) => {
      play(!result.correct ? "wrong" : score.streakAfter >= 3 ? "streak" : "correct");
      this.announcer.announce(describeResult(question, result, score, questions));
    });
    manager.on("stateChange", ({ from, to }) => {
      if (to === "SLOW_MOTION") play("slowmo");
      else if (to === "RESUMING") play("resume");
      else if (to === "RUNNING" && from === "READY") play("start");
      else if (to === "GAME_OVER") {
        play("gameover");
        this.announcer.announce(describeGameOver(manager.score, manager.stats));
      } else if (to === "READY") this.announcer.announce(strings.game.readyAnnouncement);
      else if (to === "PAUSED" && !this.menu.isOpen && !this.pausedByPresence) this.announcer.announce(strings.game.pausedAnnouncement);
    });
  }

  // --- wiring ---------------------------------------------------------------

  private wireMotion(): void {
    this.motion.on("movement", (event) => {
      // Gestures made while a menu is open (e.g. the jump in calibration) must not reach the game.
      if (!this.menu.isOpen) this.controller.handleMovement(event);
      this.previewMovement.textContent = strings.movements[event.movement];
      this.previewMovement.dataset.movement = event.movement;
      this.previewMovement.classList.add("show");
      window.clearTimeout(this.bannerTimer);
      this.bannerTimer = window.setTimeout(() => this.previewMovement.classList.remove("show"), PREVIEW_BANNER_MS);
    });
  }

  private wireMenu(): void {
    this.menu.on("opened", () => {
      this.scene.setInputEnabled(false);
      if (isActive(this.manager.state)) {
        this.manager.pause();
        this.pausedByMenu = true;
      }
    });

    this.menu.on("closed", () => {
      this.calibrationScreenOpen = false;
      document.body.classList.remove("calibrating");
      this.stopCalibration();
      this.scene.setInputEnabled(true);
      if (this.needsRebuild) {
        this.buildSession();
        this.pausedByMenu = false;
      } else if (this.pausedByMenu) {
        this.manager.resume();
        this.pausedByMenu = false;
      }
    });

    this.menu.on("enableCamera", () => void this.enableCamera());
    this.menu.on("calibrate", () => this.startCalibration());
    this.menu.on("screenChanged", (screen) => {
      this.calibrationScreenOpen = screen === "calibrate";
      document.body.classList.toggle("calibrating", this.calibrationScreenOpen);
      if (screen !== "calibrate") this.stopCalibration();
    });
    requireElement("calib-skip").addEventListener("click", () => this.session?.skip());
    requireElement("calib-cancel").addEventListener("click", () => this.menu.showScreen("main"));

    this.menu.on("settingsChanged", (next) => {
      const previous = this.settings;
      this.settings = next;
      saveSettings(this.store, next);
      this.applyAppearance();
      this.applyAudio();
      if (next.sensitivity !== previous.sensitivity) this.applyMovement(this.movementFor(this.calibration));
      if (this.affectsSession(previous, next)) this.needsRebuild = true;
    });

    requireElement("menu-button").addEventListener("click", () => this.menu.open("main"));

    document.querySelectorAll<HTMLButtonElement>("#touch-controls [data-move]").forEach((button) => {
      // pointerdown, not click: a runner needs the move the instant the finger lands.
      button.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        if (!this.menu.isOpen) this.scene.press(button.dataset.move as Movement);
      });
    });
  }

  private wireWindow(): void {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.menu.isOpen) {
        this.menu.close();
      } else if ((e.key === "Escape" || e.key === "m" || e.key === "M") && !this.menu.isOpen) {
        this.menu.open("main");
      } else if ((e.key === "d" || e.key === "D") && !this.menu.isOpen) {
        this.settings = { ...this.settings, showCameraPreview: !this.settings.showCameraPreview };
        saveSettings(this.store, this.settings);
        this.menu.setSettings(this.settings);
      }
    });
    window.addEventListener("beforeunload", () => this.motion.stop());

    // Browsers only allow audio after a user gesture.
    const unlock = (): void => this.sound.unlock();
    window.addEventListener("pointerdown", unlock, { capture: true });
    window.addEventListener("keydown", unlock, { capture: true });

    // A hidden tab is not being played: pause rather than let obstacles run into the player.
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && isActive(this.manager.state)) {
        this.manager.pause();
        this.announcer.announce(strings.game.hiddenPaused);
      }
    });
  }

  private affectsSession(a: PlayerSettings, b: PlayerSettings): boolean {
    return (
      a.difficulty !== b.difficulty ||
      a.speed !== b.speed ||
      a.readSeconds !== b.readSeconds ||
      a.answerSeconds !== b.answerSeconds ||
      a.autoLock !== b.autoLock ||
      a.lockInSeconds !== b.lockInSeconds ||
      JSON.stringify(a.categories) !== JSON.stringify(b.categories)
    );
  }

  /** Settings that change how things look take effect immediately. */
  private applyAppearance(): void {
    document.body.classList.toggle("high-contrast", this.settings.highContrast);
    document.body.classList.toggle("reduced-motion", this.settings.reducedMotion);
    document.body.dataset.camera = this.settings.cameraSize;
    this.scene.setVisuals({ highContrast: this.settings.highContrast, reducedMotion: this.settings.reducedMotion });
  }

  /** Pick where the camera tags go for this screen, and tell Phaser the game's room has changed. */
  private applyLayout(): void {
    const style = document.documentElement.style;
    style.setProperty("--side-column", `${LAYOUT_RULES.sideColumnPx}px`);
    style.setProperty("--stack-bar", `${LAYOUT_RULES.stackBarPx}px`);

    const mode = computeLayout(window.innerWidth, window.innerHeight);
    if (document.body.dataset.layout === mode) return;
    document.body.dataset.layout = mode;
    // The game's container just changed size; let the scale manager measure it again.
    requestAnimationFrame(() => this.phaser?.scale.refresh());
  }

  private applyAudio(): void {
    this.sound.setEnabled(this.settings.sound);
    this.sound.setVolume(this.settings.volume);
  }

  // --- camera ---------------------------------------------------------------

  private async enableCamera(): Promise<void> {
    this.cameraStarting = true;
    this.refreshCameraState();
    this.menu.setStatus(strings.camera.requesting, "warn");
    const ok = await this.motion.start();
    this.cameraStarting = false;
    this.refreshCameraState();
    if (ok) this.menu.setStatus("Kamera aktif. Berdiri sampai seluruh badan terlihat.", "ok");
    else this.menu.setStatus(`${this.motion.error ?? strings.camera.failed} ${strings.camera.keyboardStillWorks}`, "error");
  }

  private refreshCameraState(): void {
    this.menu.setCameraState({ starting: this.cameraStarting, active: this.motion.status === "ready", calibrated: this.calibration !== null });
  }

  // --- movement config & calibration ----------------------------------------

  /** The movement thresholds for this player: calibrated if they have calibrated, otherwise the defaults. */
  private movementFor(calibration: CalibrationResult | null): MovementConfig {
    const base = calibration ? deriveMovementConfig(gameConfig.movement, calibration, gameConfig.input.calibration) : gameConfig.movement;
    return applySensitivity(base, this.settings.sensitivity, gameConfig.presets);
  }

  private applyMovement(movement: MovementConfig): void {
    this.movementConfig = movement;
    this.motion.reconfigure(movement);
    this.laneGuides[0] = movement.lane.thresholds.left;
    this.laneGuides[1] = movement.lane.thresholds.right;
  }

  private startCalibration(): void {
    if (this.motion.status !== "ready") {
      this.menu.setStatus(strings.calibration.needCamera, "warn");
      return;
    }
    window.clearTimeout(this.calibDoneTimer);
    this.session = new CalibrationSession(gameConfig.input.calibration);
    this.calibLastStamp = -1;
    this.calibInvalidSince = null;
    this.menu.showScreen("calibrate");
    this.renderCalibration();
  }

  private stopCalibration(): void {
    window.clearTimeout(this.calibDoneTimer);
    this.session = null;
  }

  /** Feed the newest pose into the calibration wizard and refresh its screen. */
  private updateCalibration(now: number): void {
    const session = this.session;
    if (!session) return;

    const pose = this.motion.pose;
    if (!session.done && pose && pose.timestamp !== this.calibLastStamp) {
      this.calibLastStamp = pose.timestamp;
      const f = extractPoseFeatures(
        pose,
        gameConfig.pose.minLandmarkVisibility,
        gameConfig.movement.minPoseConfidence,
        FALLBACK_ASPECT_RATIO,
        this.calibFeatures,
      );
      session.update({ valid: f.valid, timestamp: pose.timestamp, centerX: f.centerX, hipY: f.hipY, torsoLength: f.torsoLength });
      this.calibInvalidSince = f.valid ? null : (this.calibInvalidSince ?? now);
    } else if (!pose || !pose.detected) {
      this.calibInvalidSince ??= now;
    }

    this.renderCalibration(now);
    if (session.done) this.finishCalibration(session);
  }

  private renderCalibration(now = performance.now()): void {
    const session = this.session;
    if (!session) return;
    const step = session.step;

    const notVisible = this.calibInvalidSince !== null && now - this.calibInvalidSince > CALIBRATION_NOT_VISIBLE_MS;
    const text =
      step === null
        ? strings.calibration.done
        : notVisible
          ? strings.calibration.notVisible
          : session.needsMore
            ? strings.calibration.needMore[step]
            : strings.calibration.instructions[step];
    if (this.calibInstruction.textContent !== text) this.calibInstruction.textContent = text;
    this.calibBar.style.width = `${Math.round(session.progress * 100)}%`;

    if (this.calibSteps.children.length !== CALIBRATION_STEPS.length) {
      this.calibSteps.replaceChildren(...CALIBRATION_STEPS.map(() => document.createElement("li")));
    }
    CALIBRATION_STEPS.forEach((name, i) => {
      const li = this.calibSteps.children[i] as HTMLElement;
      const status = session.statusOf(name);
      const label = strings.calibration.steps[name] + (status === "done" ? strings.calibration.stepDone : status === "skipped" ? strings.calibration.stepSkipped : "");
      if (li.textContent !== label) li.textContent = label;
      li.dataset.state = status;
      if (status === "active") li.setAttribute("aria-current", "step");
      else li.removeAttribute("aria-current");
    });
    requireElement<HTMLButtonElement>("calib-skip").disabled = step === null || step === "STAND";
  }

  private finishCalibration(session: CalibrationSession): void {
    const result = session.result(Date.now());
    this.session = null; // stop feeding frames; the screen stays up for a moment
    if (!result) return;

    this.calibration = result;
    saveCalibration(this.store, result);
    this.applyMovement(this.movementFor(result));
    this.refreshCameraState();
    this.menu.setStatus(strings.calibration.saved, "ok");
    this.calibInstruction.textContent = strings.calibration.done;
    this.calibBar.style.width = "100%";

    window.clearTimeout(this.calibDoneTimer);
    this.calibDoneTimer = window.setTimeout(() => {
      if (this.menu.isOpen && this.menu.screen === "calibrate") this.menu.showScreen("main");
    }, CALIBRATION_DONE_MS);
  }

  // --- player presence ------------------------------------------------------

  /** Pause a camera-controlled game while the player is out of view, and resume when they return. */
  private updatePresence(now: number): void {
    const state = this.manager.state;
    const tracking = this.motion.status === "ready" && this.motion.snapshot().tracking;

    // Run bookkeeping: a new run starts "untracked" until the camera has actually seen the player.
    if (state === "READY" || state === "GAME_OVER") {
      this.trackedThisRun = false;
      this.presence.reset();
    } else if (tracking && isActive(state)) {
      this.trackedThisRun = true;
    }

    // Resumed by hand (P key) or the menu: forget the automatic pause.
    if (this.pausedByPresence && state !== "PAUSED") this.setPresenceBanner(false);

    if (!this.trackedThisRun || this.menu.isOpen) return;
    const change = this.presence.update(now, tracking);
    if (change === "lost" && isActive(state)) {
      this.manager.pause();
      this.setPresenceBanner(true);
    } else if (change === "found" && this.pausedByPresence && state === "PAUSED") {
      this.manager.resume();
      this.setPresenceBanner(false);
    }
  }

  private setPresenceBanner(visible: boolean): void {
    this.pausedByPresence = visible;
    this.presenceBanner.hidden = !visible;
    if (visible) this.presenceBanner.textContent = strings.camera.playerLost;
  }

  private describeStatus(): [string, Level] {
    switch (this.motion.status) {
      case "idle":
        return [strings.camera.keyboardMode, "info"];
      case "starting-camera":
        return [strings.camera.requesting, "info"];
      case "loading-model":
        return [strings.camera.loadingModel, "info"];
      case "error":
        return [`${this.motion.error ?? strings.camera.failed} ${strings.camera.keyboardStillWorks}`, "error"];
      case "ready":
        break;
    }
    const snap = this.motion.snapshot();
    if (!snap.tracking) return [strings.camera.noPlayer, "warn"];
    if (!snap.baselineReady) return [strings.camera.calibrating, "warn"];
    if (this.manager.state === "READY") return [strings.camera.readyToStart, "ok"];
    if (this.manager.state === "GAME_OVER") return [strings.camera.gameOver, "ok"];
    return [strings.camera.tracking(snap.lane ? strings.lanes[snap.lane] : "—"), "ok"];
  }

  // --- per-frame HUD --------------------------------------------------------

  private readonly frame = (now: number): void => {
    this.updateCalibration(now);
    this.updatePresence(now);
    const [text, level] = this.describeStatus();
    if (this.statusText.textContent !== text) this.statusText.textContent = text;
    this.statusText.dataset.level = level;

    // The picture is always shown while calibrating, so the player can see themselves.
    const showPreview = (this.settings.showCameraPreview || this.calibrationScreenOpen) && this.motion.status === "ready";
    if (this.preview.hidden === showPreview) {
      this.preview.hidden = !showPreview;
      this.meters.hidden = !showPreview;
      this.hint.hidden = !showPreview || this.calibrationScreenOpen;
      this.hint.textContent = strings.camera.previewHint;
    }
    if (showPreview) {
      this.overlay.resize(this.motion.videoWidth, this.motion.videoHeight);
      this.overlay.render(this.motion.pose, this.motion.bodyCenter, this.laneGuides);
      this.updateMeters();
    }
    requestAnimationFrame(this.frame);
  };

  // --- live movement meters ---------------------------------------------------

  private meterRow(name: string): { root: HTMLElement; fill: HTMLElement | null; marker: HTMLElement | null; ticks: HTMLElement[]; value: HTMLElement } {
    const root = requireElement<HTMLElement>("meters").querySelector<HTMLElement>(`[data-meter="${name}"]`);
    if (!root) throw new Error(`Missing meter "${name}"`);
    return {
      root,
      fill: root.querySelector<HTMLElement>(".meter-fill"),
      marker: root.querySelector<HTMLElement>(".meter-marker"),
      ticks: [...root.querySelectorAll<HTMLElement>(".meter-tick")],
      value: root.querySelector<HTMLElement>(".meter-value") as HTMLElement,
    };
  }

  /**
   * Shows what the detector sees right now: where the body is across the lanes, and how far the
   * hips have gone up or down compared with what a jump or crouch needs. A movement that does
   * not register can be seen stopping short of its line.
   */
  private updateMeters(): void {
    const snap = this.motion.snapshot();
    const { lane, jump, crouch } = this.meterRows;
    const cfg = this.movementConfig;

    // Position across the frame, with the two lane boundaries.
    lane.marker?.style.setProperty("left", `${Math.min(1, Math.max(0, snap.centerX)) * 100}%`);
    lane.ticks[0]?.style.setProperty("left", `${this.laneGuides[0] * 100}%`);
    lane.ticks[1]?.style.setProperty("left", `${this.laneGuides[1] * 100}%`);
    this.setMeterText("lane", lane, snap.tracking && snap.lane ? strings.lanes[snap.lane] : "—");

    const ready = snap.tracking && snap.baselineReady;
    const lift = ready ? Math.max(0, snap.displacement) : 0;
    const drop = ready ? Math.max(0, -snap.displacement) : 0;
    this.setBar("jump", jump, lift, cfg.jump.minimumDisplacement, ready);
    this.setBar("crouch", crouch, drop, cfg.crouch.enterDrop, ready);
  }

  private setBar(name: "jump" | "crouch", row: ReturnType<GameApp["meterRow"]>, amount: number, limit: number, ready: boolean): void {
    row.fill?.style.setProperty("width", `${Math.min(1, amount / METER_MAX_TORSO) * 100}%`);
    row.ticks[0]?.style.setProperty("left", `${Math.min(1, limit / METER_MAX_TORSO) * 100}%`);
    row.root.classList.toggle("hit", ready && amount >= limit);
    this.setMeterText(name, row, ready ? `${amount.toFixed(2)} / ${limit.toFixed(2)}` : "—");
  }

  private setMeterText(name: "lane" | "jump" | "crouch", row: { value: HTMLElement }, text: string): void {
    if (this.meterText[name] === text) return;
    this.meterText[name] = text;
    row.value.textContent = text;
  }

  private readFlag(key: string): boolean {
    try {
      return this.store?.getItem(key) === "1";
    } catch {
      return false;
    }
  }

  private writeFlag(key: string): void {
    try {
      this.store?.setItem(key, "1");
    } catch {
      /* storage unavailable: the tutorial will simply show again next time */
    }
  }

  /** For debugging and tests (e.g. injecting synthetic poses without a camera). */
  private exposeForDebugging(): void {
    const app = this;
    Object.defineProperty(window, "runner", {
      configurable: true,
      value: {
        get manager() {
          return app.manager;
        },
        get controller() {
          return app.controller;
        },
        scene: this.scene,
        phaser: this.phaser,
        motion: this.motion,
        menu: this.menu,
      },
    });
  }
}
