import * as Phaser from "phaser";
import type { QuestionsConfig, RunnerConfig, RunnerViewConfig, SlowMotionConfig } from "../config/gameConfig";
import type { Movement } from "../movement/MovementTypes";
import type { Question } from "../questions";
import { answerLetter, isLane } from "../questions";
import { FeedbackUI } from "../ui/FeedbackUI";
import { MOVEMENT_ICONS, QuestionUI, type QuestionTag } from "../ui/QuestionUI";
import { CREDIT } from "../ui/credit";
import { strings } from "../ui/strings";
import { FONT, HIGH_CONTRAST_THEME, answerColors, cssColor, readTheme, type Theme } from "../ui/theme";
import type { ExitingGate, GameManager, QuestionGate } from "./GameManager";
import { isActive } from "./GameState";
import { LANES, laneIndex } from "./Player";
import { drawObstacle } from "./render/ObstacleRenderer";
import { drawRunner } from "./render/RunnerFigure";
import { LANE_COUNT, TrackGeometry } from "./render/TrackGeometry";
import { createBackdropTexture, drawGround } from "./render/WorldRenderer";

// --- layout ---------------------------------------------------------------

const QUESTION_PANEL_TOP = 74;
const BIB = { x: 16, y: 12, w: 118, h: 54, tilt: -0.04 } as const;
const TAG_MARGIN = 14;

// --- the runner -----------------------------------------------------------

const RUNNER_SCALE = 1.12;
const JUMP_LIFT_PX = 90;
const JUMP_SCALE_GAIN = 0.2;
/** Runner stride: radians of the running cycle per unit of depth travelled. */
const RUN_RADIANS_PER_DEPTH = 28;

// --- question gate ----------------------------------------------------------

const GATE_BASE_HEIGHT = 0.07; // fraction of view height at the player line
const GATE_LABEL_FONT_PX = 30;
const GATE_MAX_LABELS = 4;
const GATE_DEPTH_PX = 6;
/** Space between stacked answers of a movement question. */
const GATE_STACK_GAP_PX = 6;

// --- effects ----------------------------------------------------------------

const SLOW_TINT_MAX_ALPHA = 0.26;
const TIMER_BAR_HEIGHT = 10;
const TIMER_BAR_GAP = 12;
const TIMER_LABEL_W = 62;
const WARNING_BLINK_MS = 120;
const SHAKE_MS = 250;
const SHAKE_INTENSITY = 0.012;
const BACKDROP_KEY = "backdrop";
/** The maker's name, drawn small and faint along the bottom of the game. */
const WATERMARK_FONT_PX = 13;
const WATERMARK_ALPHA = 0.6;
const WATERMARK_MARGIN_PX = 12;

export interface VisualOptions {
  highContrast: boolean;
  /** Turns off screen shake, the running bounce, pop-in effects, tilted stamps and the blinking warning. */
  reducedMotion: boolean;
}

/** One keyboard key → the Movement it triggers (lane keys step one lane from the current one). */
interface KeyBindings {
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  action: Phaser.Input.Keyboard.Key;
  pause: Phaser.Input.Keyboard.Key;
}

/**
 * Draws the game and forwards the keyboard to the GameManager as Movement events. It holds no
 * game rules; everything it shows is read from the GameManager. The look is a school sports day:
 * a running track, a chalkboard for the questions and a race bib for the score.
 */
export class RunnerScene extends Phaser.Scene {
  private keys!: KeyBindings;
  private graphics!: Phaser.GameObjects.Graphics;
  private backdrop!: Phaser.GameObjects.Image;
  private bib!: Phaser.GameObjects.Container;
  private bibGraphics!: Phaser.GameObjects.Graphics;
  private bibLabel!: Phaser.GameObjects.Text;
  private scoreText!: Phaser.GameObjects.Text;
  private stateTag!: Phaser.GameObjects.Text;
  private streakTag!: Phaser.GameObjects.Text;
  private timerText!: Phaser.GameObjects.Text;
  private watermark!: Phaser.GameObjects.Text;
  private warningText!: Phaser.GameObjects.Text;
  private overlayCard!: Phaser.GameObjects.Graphics;
  private overlayTitle!: Phaser.GameObjects.Text;
  private overlayBody!: Phaser.GameObjects.Text;
  private questionUI!: QuestionUI;
  private feedbackUI!: FeedbackUI;
  private gateLabels: Phaser.GameObjects.Text[] = [];

  private game_!: GameManager;
  private config!: RunnerConfig;
  private geo!: TrackGeometry;
  private baseTheme!: Theme;
  private visuals: VisualOptions = { highContrast: false, reducedMotion: false };
  private created = false;
  private subscriptions: Array<() => void> = [];

  private visualLane = 1; // fractional lane index, tweened toward the real lane
  /** How far the runner has travelled, in depth units (see drawGround). Never wraps. */
  private distance = 0;
  private gameOverMessage = "";
  /** What the overlay card currently shows ("" = hidden). null means "not drawn yet", which forces the next draw. */
  private overlayKey: string | null = null;

  constructor() {
    super("RunnerScene");
  }

  private get view(): RunnerViewConfig {
    return this.config.view;
  }

  private get questionsConfig(): QuestionsConfig {
    return this.config.questions;
  }

  private get slowMotion(): SlowMotionConfig {
    return this.config.slowMotion;
  }

  private get theme(): Theme {
    return this.visuals.highContrast ? HIGH_CONTRAST_THEME : this.baseTheme;
  }

  /**
   * Show a (new) game. Call before the scene starts, or later to swap in a fresh GameManager
   * (e.g. after settings change) without rebuilding the canvas.
   */
  attach(game: GameManager, config: RunnerConfig): void {
    this.game_ = game;
    this.config = config;
    this.geo = new TrackGeometry(config.view);
    if (this.created) this.bind();
  }

  /** Switch high contrast and reduced motion on or off (takes effect immediately). */
  setVisuals(options: VisualOptions): void {
    this.visuals = options;
    if (this.created) this.refreshTheme();
  }

  /** Enable or disable keyboard capture (off while a menu is open so Space/arrows reach it). */
  setInputEnabled(enabled: boolean): void {
    const kb = this.input?.keyboard;
    if (!kb) return;
    kb.enabled = enabled;
    if (!enabled) kb.resetKeys();
  }

  /** Public so the keyboard and the webcam can feed movements through the same path. */
  send(movement: Movement): void {
    this.game_.handleMovement(movement);
  }

  // --- setup ------------------------------------------------------------------

  create(): void {
    this.baseTheme = readTheme();
    const { width, height } = this.view;
    const t = this.theme;

    // The backdrop texture is built first (refreshTheme redraws it for high contrast).
    createBackdropTexture(this, BACKDROP_KEY, width, Math.ceil(this.geo.horizonY) + 1, t, this.visuals.highContrast);
    this.backdrop = this.add.image(0, 0, BACKDROP_KEY).setOrigin(0, 0).setDepth(-10);
    this.graphics = this.add.graphics();

    // Race bib with the score.
    this.bibGraphics = this.add.graphics();
    this.bibLabel = this.add.text(12, 7, strings.game.score.toUpperCase(), { fontFamily: FONT.body, fontSize: "11px", fontStyle: "800", letterSpacing: 2 });
    this.scoreText = this.add.text(BIB.w / 2, 33, "0", { fontFamily: FONT.display, fontSize: "27px" }).setOrigin(0.5);
    this.bib = this.add.container(BIB.x, BIB.y, [this.bibGraphics, this.bibLabel, this.scoreText]).setDepth(5);

    // State and streak tags, top right.
    const tag = { fontFamily: FONT.body, fontSize: "13px", fontStyle: "800", letterSpacing: 1, padding: { x: 10, y: 5 } };
    this.stateTag = this.add.text(width - TAG_MARGIN, 14, "", tag).setOrigin(1, 0).setDepth(5);
    this.streakTag = this.add.text(width - TAG_MARGIN, 14 + 30, "", tag).setOrigin(1, 0).setDepth(5);

    // Seconds left to answer, next to the timer bar.
    this.timerText = this.add
      .text(width - 18, 0, "", { fontFamily: FONT.display, fontSize: "17px", align: "right" })
      .setOrigin(1, 0.5)
      .setDepth(10)
      .setVisible(false);

    // Watermark: the maker's name. It sits in the empty strip of track below the runner and
    // is not interactive, so it never gets in the way of play.
    this.watermark = this.add
      .text(width / 2, height - WATERMARK_MARGIN_PX, CREDIT.name, { fontFamily: FONT.body, fontSize: `${WATERMARK_FONT_PX}px`, fontStyle: "800", letterSpacing: 1.5 })
      .setOrigin(0.5, 1)
      .setAlpha(WATERMARK_ALPHA)
      .setDepth(12);

    // "A question is coming" banner.
    this.warningText = this.add
      .text(width / 2, height * 0.135, this.questionsConfig.text.warning, { fontFamily: FONT.display, fontSize: "22px", padding: { x: 18, y: 9 } })
      .setOrigin(0.5)
      .setDepth(9)
      .setVisible(false);

    // The card for READY / PAUSED / GAME OVER.
    this.overlayCard = this.add.graphics().setDepth(8);
    this.overlayTitle = this.add.text(width / 2, 0, "", { fontFamily: FONT.display, fontSize: "34px", align: "center" }).setOrigin(0.5).setDepth(9);
    this.overlayBody = this.add
      .text(width / 2, 0, "", { fontFamily: FONT.body, fontSize: "18px", fontStyle: "700", align: "center", lineSpacing: 5 })
      .setOrigin(0.5)
      .setDepth(9);

    this.questionUI = new QuestionUI(this, width, QUESTION_PANEL_TOP, t);
    this.feedbackUI = new FeedbackUI(this, width / 2, height * 0.5, this.questionsConfig, t);
    for (let i = 0; i < GATE_MAX_LABELS; i++) {
      this.gateLabels.push(this.add.text(0, 0, "", { fontFamily: FONT.display, fontSize: `${GATE_LABEL_FONT_PX}px` }).setOrigin(0.5).setVisible(false));
    }

    this.setupInput();
    this.created = true;
    this.refreshTheme();
    if (this.game_) this.bind();
  }

  private setupInput(): void {
    const kb = this.input.keyboard;
    if (!kb) throw new Error("Keyboard input unavailable.");
    const K = Phaser.Input.Keyboard.KeyCodes;
    this.keys = {
      left: kb.addKey(K.LEFT),
      right: kb.addKey(K.RIGHT),
      up: kb.addKey(K.UP),
      down: kb.addKey(K.DOWN),
      action: kb.addKey(K.SPACE),
      pause: kb.addKey(K.P),
    };
    this.keys.left.on("down", () => this.shiftLane(-1));
    this.keys.right.on("down", () => this.shiftLane(1));
    this.keys.up.on("down", () => this.send("JUMP"));
    this.keys.down.on("down", () => this.send("CROUCH"));
    this.keys.action.on("down", () => this.onActionKey());
    this.keys.pause.on("down", () => {
      if (this.game_.state === "PAUSED") this.game_.resume();
      else this.game_.pause();
    });
  }

  /** Re-colour everything for the current theme (normal or high contrast). */
  private refreshTheme(): void {
    const t = this.theme;
    const hc = this.visuals.highContrast;
    const { width } = this.view;

    createBackdropTexture(this, BACKDROP_KEY, width, Math.ceil(this.geo.horizonY) + 1, t, hc);
    this.backdrop.setTexture(BACKDROP_KEY);

    this.drawBib();
    this.bibLabel.setColor(cssColor(t.ink));
    this.scoreText.setColor(cssColor(t.ink));
    this.bib.setRotation(this.visuals.reducedMotion ? 0 : BIB.tilt);

    this.stateTag.setColor(cssColor(t.ink)).setBackgroundColor(cssColor(t.whistle));
    this.streakTag.setColor(cssColor(t.whistle)).setBackgroundColor(cssColor(t.ink));
    this.warningText.setColor(cssColor(t.ink)).setBackgroundColor(cssColor(t.whistle)).setAngle(this.visuals.reducedMotion ? 0 : -2);
    this.overlayTitle.setColor(cssColor(t.paper));
    this.overlayBody.setColor(cssColor(t.ink));
    this.timerText.setColor(cssColor(t.ink)).setStroke(cssColor(t.paper), 5);
    this.watermark.setColor(cssColor(t.paper)).setStroke(cssColor(t.ink), 4);
    this.overlayKey = null; // redraw the card in the new colours

    this.questionUI.setTheme(t, hc);
    this.feedbackUI.setTheme(t);
    this.feedbackUI.setReducedMotion(this.visuals.reducedMotion);
  }

  private drawBib(): void {
    const t = this.theme;
    const g = this.bibGraphics;
    g.clear();
    g.fillStyle(t.ink, 0.35).fillRoundedRect(2, 4, BIB.w, BIB.h, 5);
    g.fillStyle(t.paper, 1).fillRoundedRect(0, 0, BIB.w, BIB.h, 5);
    g.lineStyle(2.5, t.ink, 1).strokeRoundedRect(0, 0, BIB.w, BIB.h, 5);
    // Safety pins in the corners.
    for (const [px, py] of [
      [7, 7],
      [BIB.w - 7, 7],
      [7, BIB.h - 7],
      [BIB.w - 7, BIB.h - 7],
    ]) {
      g.fillStyle(t.paper2, 1).fillCircle(px, py, 3.2);
      g.lineStyle(1.5, t.ink, 1).strokeCircle(px, py, 3.2);
    }
  }

  // --- game binding -----------------------------------------------------------

  private unbind(): void {
    for (const off of this.subscriptions) off();
    this.subscriptions = [];
  }

  /** Subscribe to the current game and clear any leftover question UI. */
  private bind(): void {
    this.unbind();
    const game = this.game_;
    this.warningText.setVisible(false);
    this.questionUI.hide();
    this.feedbackUI.hide();
    this.visualLane = laneIndex(game.player.lane);
    this.distance = 0;
    this.overlayKey = null;

    this.subscriptions.push(
      game.on("questionWarning", () => {
        this.feedbackUI.hide();
        this.warningText.setVisible(true);
      }),
      game.on("questionStarted", (session) => {
        this.warningText.setVisible(false);
        this.questionUI.show(session.question, this.tagFor(session.question));
      }),
      game.on("questionAnswered", ({ question, result, score }) => {
        this.questionUI.hide();
        this.feedbackUI.show(question, result, score, this.time.now);
      }),
      game.on("collision", () => {
        if (!this.visuals.reducedMotion) this.cameras.main.shake(SHAKE_MS, SHAKE_INTENSITY);
      }),
      game.on("stateChange", ({ to }) => {
        if (to === "GAME_OVER") this.gameOverMessage = this.gameOverText();
        if (to === "GAME_OVER" || to === "READY") {
          this.warningText.setVisible(false);
          this.questionUI.hide();
          this.feedbackUI.hide();
        }
      }),
    );
  }

  // --- per frame ----------------------------------------------------------------

  override update(_time: number, deltaMs: number): void {
    if (!this.game_) return;
    // Clamp so a background-tab stall does not teleport obstacles into the player.
    const dt = Math.min(deltaMs, 50);
    this.game_.update(dt);

    const target = laneIndex(this.game_.player.lane);
    const follow = 1 - Math.exp(-dt / Math.max(1, this.view.laneChangeTweenMs / 3));
    this.visualLane += (target - this.visualLane) * follow;

    const gate = this.game_.gate;
    if (gate) this.questionUI.setSelected(gate.session.currentSelection(this.game_.player.lane));
    this.feedbackUI.update(this.time.now);

    // The ground moves at exactly the speed of the obstacles on it.
    if (isActive(this.game_.state)) {
      this.distance += (dt / this.config.speed.travelTimeMs) * this.game_.speedMultiplier * this.game_.timeScale;
    }
    if (this.warningText.visible) {
      this.warningText.setAlpha(this.visuals.reducedMotion ? 1 : 0.7 + 0.3 * Math.sin(this.time.now / WARNING_BLINK_MS));
    }

    this.draw();
  }

  private shiftLane(delta: -1 | 1): void {
    const next = LANES[Math.min(LANES.length - 1, Math.max(0, laneIndex(this.game_.player.lane) + delta))];
    this.send(next);
  }

  private onActionKey(): void {
    const { state } = this.game_;
    if (state === "READY" || state === "GAME_OVER") this.game_.start();
  }

  // --- drawing ------------------------------------------------------------------

  private draw(): void {
    const g = this.graphics;
    const { width, height } = this.view;
    const t = this.theme;
    g.clear();

    drawGround(g, this.geo, t, width, height, this.distance, { highContrast: this.visuals.highContrast });

    // Obstacles are stored oldest (nearest) first, so draw from the back to put far ones behind near ones.
    const outline = this.visuals.highContrast ? t.paper : null;
    const { obstacles } = this.game_;
    for (let i = obstacles.length - 1; i >= 0; i--) drawObstacle(g, this.geo, height, obstacles[i], t, outline);

    this.drawGate();
    this.drawPlayer(g);
    this.drawSlowMotionTint(g);
    this.drawResponseTimer(g);
    this.drawHud();
  }

  /** Question gate: a chunky mat per answer across the track. Answered gates show right and wrong. */
  private drawGate(): void {
    for (const label of this.gateLabels) label.setVisible(false);
    const { state } = this.game_;
    if (state === "READY" || state === "GAME_OVER") return;

    const exiting = this.game_.exitingGate;
    if (exiting) this.drawGateShape(exiting, null, exiting);
    const gate = this.game_.gate;
    if (gate) this.drawGateShape(gate, gate.session.currentSelection(this.game_.player.lane), null);
  }

  private drawGateShape(gate: QuestionGate, selected: string | null, answered: ExitingGate | null): void {
    const g = this.graphics;
    const t = this.theme;
    const colors = answerColors(t);
    const { question } = gate.session;
    const depth = gate.progress;
    const s = this.geo.scaleAt(depth);
    const y = this.geo.yAt(depth);
    const roadW = this.geo.roadWidthAt(depth);
    const roadLeft = this.geo.roadLeftAt(depth);
    const h = this.view.height * GATE_BASE_HEIGHT * s;

    // Movement answers are stacked like the movements themselves: jump (▲) above, crouch (▼) below.
    const stacked = question.type === "MOVEMENT";
    const above = (action: string): number => (action === "JUMP" ? 0 : action === "CROUCH" ? 2 : 1);
    const stackOrder = [...question.answers].sort((a, b) => above(a.action) - above(b.action));

    question.answers.forEach((answer, i) => {
      if (i >= GATE_MAX_LABELS) return;
      // LANE answers sit side by side, each in its own lane. MOVEMENT answers span the track, one above the other.
      let centerX: number;
      let segmentW: number;
      let bottom = y; // y of the underside of this answer's mat
      if (stacked || !isLane(answer.action)) {
        segmentW = roadW * 0.98;
        centerX = roadLeft + roadW / 2;
        const fromTop = stackOrder.indexOf(answer);
        bottom = y - (stackOrder.length - 1 - fromTop) * (h + GATE_STACK_GAP_PX * s);
      } else {
        segmentW = roadW / LANE_COUNT;
        centerX = this.geo.laneX(laneIndex(answer.action as (typeof LANES)[number]), depth);
      }
      const x = centerX - segmentW * 0.46;
      const w = segmentW * 0.92;

      let color = colors[i % colors.length];
      let alpha = answer.id === selected ? 1 : 0.88;
      let ring = answer.id === selected;
      let mark = "";
      if (answered) {
        const wasPicked = answer.id === answered.result.selectedAnswerId;
        if (answer.correct) [color, alpha, ring, mark] = [t.good, 1, true, "✓"];
        else if (wasPicked) [color, alpha, ring, mark] = [t.bad, 1, true, "✕"];
        else alpha = 0.3;
      }

      // A mat with a darker underside for depth, and a bright ring when it is the chosen one.
      const body = h - GATE_DEPTH_PX * s;
      g.fillStyle(t.ink, 0.35 * alpha).fillRoundedRect(x, bottom - h + GATE_DEPTH_PX * s, w, h, 6 * s);
      g.fillStyle(color, alpha).fillRoundedRect(x, bottom - h, w, body + 2 * s, 6 * s);
      g.lineStyle(Math.max(2, 3 * s), t.ink, alpha).strokeRoundedRect(x, bottom - h, w, body + 2 * s, 6 * s);
      if (ring) g.lineStyle(Math.max(3, 5 * s), t.paper, 1).strokeRoundedRect(x - 2 * s, bottom - h - 2 * s, w + 4 * s, body + 6 * s, 8 * s);

      const icon = question.type === "MOVEMENT" ? ` ${MOVEMENT_ICONS[answer.action]}` : "";
      const text = mark !== "" ? mark : `${answerLetter(i)}${icon}`;
      const label = this.gateLabels[i];
      if (label.text !== text) label.setText(text);
      label.setColor(cssColor(t.ink)).setPosition(centerX, bottom - h / 2 - GATE_DEPTH_PX * s * 0.2).setScale(s).setAlpha(alpha).setVisible(true);
    });
  }

  private drawPlayer(g: Phaser.GameObjects.Graphics): void {
    const { player } = this.game_;
    const t = this.theme;
    const jump = player.jumpHeight;
    const x = this.geo.laneX(this.visualLane, 1);
    const groundY = this.geo.yAt(1);
    const running = isActive(this.game_.state) && jump === 0 && !player.isCrouching;
    const swinging = running && !this.visuals.reducedMotion;
    const k = RUNNER_SCALE * (1 + JUMP_SCALE_GAIN * jump);

    // Shadow on the track: smaller and fainter the higher the jump.
    g.fillStyle(t.ink, 0.38 - 0.22 * jump).fillEllipse(x, groundY, 46 * RUNNER_SCALE * (1 - 0.3 * jump), 13 * RUNNER_SCALE);

    drawRunner(
      g,
      {
        x,
        groundY,
        lift: jump * JUMP_LIFT_PX,
        jump,
        crouching: player.isCrouching,
        phase: this.distance * RUN_RADIANS_PER_DEPTH,
        running: swinging,
      },
      { body: t.runner, outline: t.paper, bib: t.paper, shoe: t.ink, scale: k },
    );
  }

  /** A cool wash over the whole scene while time is stretched. */
  private drawSlowMotionTint(g: Phaser.GameObjects.Graphics): void {
    const span = 1 - this.slowMotion.slowFactor;
    if (span <= 0 || this.visuals.highContrast) return;
    const amount = Math.min(1, Math.max(0, (1 - this.game_.timeScale) / span));
    if (amount <= 0.001) return;
    g.fillStyle(this.theme.stand, SLOW_TINT_MAX_ALPHA * amount).fillRect(0, 0, this.view.width, this.view.height);
  }

  /** Bar and countdown under the chalkboard showing how much of the answer window is left. */
  private drawResponseTimer(g: Phaser.GameObjects.Graphics): void {
    const left = this.game_.responseTimeLeft;
    if (left === null || !this.questionUI.visible) {
      if (this.timerText.visible) this.timerText.setVisible(false);
      return;
    }
    const t = this.theme;
    const x = 18;
    const w = this.view.width - 36 - TIMER_LABEL_W;
    const y = this.questionUI.bottomY + TIMER_BAR_GAP;
    g.fillStyle(t.paper, 1).fillRoundedRect(x, y, w, TIMER_BAR_HEIGHT, 5);
    const color = left > 0.5 ? t.good : left > 0.25 ? t.whistle : t.bad;
    if (left > 0) g.fillStyle(color, 1).fillRoundedRect(x, y, Math.max(TIMER_BAR_HEIGHT, w * left), TIMER_BAR_HEIGHT, 5);
    g.lineStyle(2.5, t.ink, 1).strokeRoundedRect(x, y, w, TIMER_BAR_HEIGHT, 5);

    // Whole seconds are easy to read at a glance; tenths only for the last few.
    const seconds = (left * this.slowMotion.responseWindowMs) / 1000;
    const label = seconds < 10 ? seconds.toFixed(1) : String(Math.ceil(seconds));
    if (this.timerText.text !== `${label} dtk`) this.timerText.setText(`${label} dtk`);
    this.timerText.setPosition(this.view.width - 18, y + TIMER_BAR_HEIGHT / 2).setVisible(true);
  }

  // --- HUD -----------------------------------------------------------------------

  /** "Matematika · Sedang", in the chalk colour for the difficulty. */
  private tagFor(question: Question): QuestionTag {
    const { categoryLabels, text } = this.questionsConfig;
    const t = this.theme;
    const category = categoryLabels[question.category] ?? question.category;
    const color = question.difficulty === "EASY" ? t.chalkGreen : question.difficulty === "MEDIUM" ? t.chalkYellow : t.chalkPink;
    return { text: `${category} · ${text.difficulty[question.difficulty]}`, color: cssColor(color) };
  }

  /** Final summary shown on the game-over screen. */
  private gameOverText(): string {
    const { stats, score } = this.game_;
    const { text, categoryLabels } = this.questionsConfig;
    const lines = [`${strings.game.score} ${score}`];
    if (stats.asked > 0) {
      const percent = Math.round(stats.accuracy * 100);
      lines.push(`${text.summary.questions}: ${stats.asked}  ·  ${text.summary.correct}: ${stats.correct} (${percent}%)`);
      lines.push(`${text.summary.bestStreak}: ${stats.bestStreak}`);
      const rows = [...stats.byCategory].map(([id, c]) => `${categoryLabels[id] ?? id}: ${c.correct}/${c.asked}`);
      lines.push(`\n${text.summary.byCategory}\n${rows.join("\n")}`);
    }
    lines.push(`\n${strings.game.restart}`);
    return lines.join("\n");
  }

  private drawHud(): void {
    const { state, score, speedMultiplier, streak } = this.game_;
    this.scoreText.setText(String(score));
    this.stateTag.setText(`${strings.game.states[state].toUpperCase()}  ×${speedMultiplier.toFixed(2)}`);

    const { scoring } = this.questionsConfig;
    const multiplier = Math.min(scoring.maxStreakMultiplier, 1 + scoring.streakStep * streak);
    const streakText = streak >= 2 ? `${this.questionsConfig.text.streak.toUpperCase()} ${streak}  ×${multiplier.toFixed(1)}` : "";
    this.streakTag.setText(streakText).setVisible(streakText !== "");

    // READY, PAUSED and GAME OVER share one card. It is laid out only when its content changes.
    const overlay =
      state === "READY"
        ? strings.game.ready
        : state === "PAUSED"
          ? strings.game.paused
          : state === "GAME_OVER"
            ? { title: strings.game.gameOverTitle, body: this.gameOverMessage }
            : null;
    this.setOverlay(overlay);
  }

  private setOverlay(content: { title: string; body: string } | null): void {
    const key = content ? `${content.title}|${content.body}` : "";
    if (key === this.overlayKey) return;
    this.overlayKey = key;

    const visible = content !== null;
    this.overlayCard.setVisible(visible);
    this.overlayTitle.setVisible(visible);
    this.overlayBody.setVisible(visible);
    if (!content) return;

    const t = this.theme;
    this.overlayTitle.setText(content.title);
    this.overlayBody.setText(content.body);

    const padX = 30;
    const bandPad = 14;
    const gap = 16;
    const bodyPad = 20;
    const bandH = this.overlayTitle.height + bandPad * 2;
    const cardW = Math.min(this.view.width - 28, Math.max(this.overlayTitle.width + padX * 2, this.overlayBody.width + padX * 2, 280));
    const cardH = bandH + gap + this.overlayBody.height + bodyPad;
    const cx = this.view.width / 2;
    const top = this.view.height * 0.47 - cardH / 2;
    const left = cx - cardW / 2;

    this.overlayTitle.setPosition(cx, top + bandH / 2);
    this.overlayBody.setPosition(cx, top + bandH + gap + this.overlayBody.height / 2);

    const g = this.overlayCard;
    g.clear();
    g.fillStyle(t.ink, 0.4).fillRoundedRect(left + 3, top + 7, cardW, cardH, 16);
    g.fillStyle(t.paper, 1).fillRoundedRect(left, top, cardW, cardH, 16);
    // The title sits on a track-red band with a painted lane line under it, like the menu.
    g.fillStyle(t.track, 1).fillRoundedRect(left, top, cardW, bandH, { tl: 16, tr: 16, bl: 0, br: 0 });
    g.fillStyle(t.trackLine, 1);
    for (let dx = left + 10; dx < left + cardW - 20; dx += 26) g.fillRect(dx, top + bandH - 5, 14, 3);
    g.lineStyle(3, t.ink, 1).strokeRoundedRect(left, top, cardW, cardH, 16);
    g.lineBetween(left, top + bandH, left + cardW, top + bandH);
  }
}
