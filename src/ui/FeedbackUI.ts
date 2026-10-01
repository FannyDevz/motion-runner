import * as Phaser from "phaser";
import type { QuestionsConfig } from "../config/gameConfig";
import type { ScoreBreakdown } from "../game/Scoring";
import type { AnswerResult, Question } from "../questions";
import { FONT, cssColor, type Theme } from "./theme";

const FADE_FRACTION = 0.3; // last part of the display time spent fading out
const POP_START_SCALE = 0.6;
const POP_MS = 220;
const TITLE_TILT_DEG = -4;
const TITLE_FONT_PX = 50;
const DETAIL_FONT_PX = 21;

/**
 * The big result shown briefly after a question: "Benar!" or "Salah" in the track's slab
 * lettering, set at a slight angle like a stamp, with the points or the right answer under it.
 */
export class FeedbackUI {
  private readonly title: Phaser.GameObjects.Text;
  private readonly detail: Phaser.GameObjects.Text;
  private shownAt = 0;
  private active = false;
  private reducedMotion = false;

  constructor(
    private readonly scene: Phaser.Scene,
    centerX: number,
    centerY: number,
    private readonly config: QuestionsConfig,
    private theme: Theme,
  ) {
    this.title = scene.add
      .text(centerX, centerY, "", { fontFamily: FONT.display, fontSize: `${TITLE_FONT_PX}px` })
      .setOrigin(0.5)
      .setDepth(11)
      .setVisible(false);
    this.detail = scene.add
      .text(centerX, centerY + 46, "", { fontFamily: FONT.body, fontSize: `${DETAIL_FONT_PX}px`, fontStyle: "800", align: "center" })
      .setOrigin(0.5)
      .setDepth(11)
      .setVisible(false);
    this.applyTheme();
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.applyTheme();
  }

  setReducedMotion(enabled: boolean): void {
    this.reducedMotion = enabled;
    this.title.setAngle(enabled ? 0 : TITLE_TILT_DEG);
  }

  show(question: Question, result: AnswerResult, score: ScoreBreakdown, now: number): void {
    const { text } = this.config;
    const points = score.total === 0 ? "" : ` ${score.total > 0 ? "+" : ""}${score.total}`;

    if (result.correct) {
      this.title.setText(`${text.correct}${points}`).setColor(cssColor(this.theme.good));
      const parts: string[] = [];
      if (score.streakMultiplier > 1) parts.push(`${text.streak} ${score.streakBefore} ×${score.streakMultiplier.toFixed(1)}`);
      if (score.speedBonus > 0) parts.push(`${text.speedBonus} +${score.speedBonus}`);
      this.detail.setText(parts.join("  ·  "));
    } else {
      const heading = result.selectedAnswerId === null ? text.noAnswer : text.incorrect;
      this.title.setText(`${heading}${points}`).setColor(cssColor(this.theme.bad));
      const correct = question.answers.find((a) => a.correct);
      this.detail.setText(correct ? `${text.correctAnswerPrefix} ${correct.text}` : "");
    }

    this.shownAt = now;
    this.active = true;
    this.title.setVisible(true).setAlpha(1).setScale(1);
    this.detail.setVisible(this.detail.text !== "").setAlpha(1);
    if (!this.reducedMotion) {
      // A quick pop so the result catches the eye.
      this.title.setScale(POP_START_SCALE);
      this.scene.tweens.add({ targets: this.title, scale: 1, duration: POP_MS, ease: "Back.Out" });
    }
  }

  update(now: number): void {
    if (!this.active) return;
    const elapsed = now - this.shownAt;
    const total = this.config.feedbackMs;
    if (elapsed >= total) {
      this.hide();
      return;
    }
    const fadeStart = total * (1 - FADE_FRACTION);
    const alpha = elapsed <= fadeStart ? 1 : 1 - (elapsed - fadeStart) / (total - fadeStart);
    this.title.setAlpha(alpha);
    this.detail.setAlpha(alpha);
  }

  hide(): void {
    this.active = false;
    this.title.setVisible(false);
    this.detail.setVisible(false);
  }

  /** Thick outlines in the ink colour keep the letters readable over the track, the grass or the sky. */
  private applyTheme(): void {
    const outline = cssColor(this.theme.ink);
    this.title.setStroke(outline, 9);
    this.title.setShadow(0, 4, outline, 0, true, true);
    this.detail.setColor(cssColor(this.theme.paper)).setStroke(outline, 6);
  }
}
