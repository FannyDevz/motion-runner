import * as Phaser from "phaser";
import type { Movement } from "../movement/MovementTypes";
import { answerLetter, type Question } from "../questions";
import { FONT, answerColors, cssColor, type Theme } from "./theme";

export const MOVEMENT_ICONS: Record<Movement, string> = {
  LEFT: "◀",
  CENTER: "●",
  RIGHT: "▶",
  JUMP: "▲",
  CROUCH: "▼",
};

const PANEL_MARGIN = 12;
const FRAME_PX = 7;
const BOARD_PADDING = 14;
const ROW_HEIGHT = 36;
const BADGE_R = 12;
const TAG_FONT_PX = 12;
const TAG_HEIGHT = 20;
const QUESTION_FONT_PX = 20;
const ANSWER_FONT_PX = 19;
const ACTION_FONT_PX = 13;
const TRAY_HEIGHT = 9;

export interface QuestionTag {
  text: string;
  /** CSS colour for the tag text (a chalk colour). */
  color: string;
}

/**
 * The chalkboard: category and level in small chalk capitals, the question, then a row per
 * answer with its coloured badge and the movement that selects it. The row the player is
 * currently choosing is circled in chalk, so they get live feedback while they move.
 */
export class QuestionUI {
  private readonly container: Phaser.GameObjects.Container;
  private readonly board: Phaser.GameObjects.Graphics;
  private readonly highlight: Phaser.GameObjects.Graphics;
  private readonly tagText: Phaser.GameObjects.Text;
  private readonly questionText: Phaser.GameObjects.Text;
  private rowObjects: Phaser.GameObjects.GameObject[] = [];
  private question: Question | null = null;
  private selectedId: string | null = null;
  private rowsTop = 0;
  private boardHeight = 0;
  private highContrast = false;
  private colors: readonly number[];

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly width: number,
    private readonly topY: number,
    private theme: Theme,
  ) {
    this.colors = answerColors(theme);
    const left = PANEL_MARGIN + FRAME_PX + BOARD_PADDING;

    this.container = scene.add.container(0, topY).setVisible(false).setDepth(10);
    this.board = scene.add.graphics();
    this.highlight = scene.add.graphics();
    this.tagText = scene.add.text(left, FRAME_PX + BOARD_PADDING - 2, "", {
      fontFamily: FONT.body,
      fontSize: `${TAG_FONT_PX}px`,
      fontStyle: "800",
      letterSpacing: 1.5,
    });
    this.questionText = scene.add.text(left, FRAME_PX + BOARD_PADDING + TAG_HEIGHT, "", {
      fontFamily: FONT.body,
      fontSize: `${QUESTION_FONT_PX}px`,
      fontStyle: "800",
      color: cssColor(theme.chalk),
      wordWrap: { width: width - 2 * left },
      lineSpacing: 2,
    });
    this.container.add([this.board, this.highlight, this.tagText, this.questionText]);
  }

  get visible(): boolean {
    return this.container.visible;
  }

  /** Y of the board's bottom edge (including the chalk tray), so other UI can sit just under it. */
  get bottomY(): number {
    return this.topY + this.boardHeight + TRAY_HEIGHT;
  }

  /** Re-colour for a new theme (e.g. high contrast). Takes effect for the next question. */
  setTheme(theme: Theme, highContrast: boolean): void {
    this.theme = theme;
    this.highContrast = highContrast;
    this.colors = answerColors(theme);
    this.questionText.setColor(cssColor(theme.chalk));
    if (this.question) this.layout(this.question);
  }

  show(question: Question, tag: QuestionTag): void {
    this.question = question;
    this.selectedId = null;
    this.tagText.setText(tag.text.toUpperCase()).setColor(tag.color);
    this.questionText.setText(question.text);
    this.layout(question);
    this.container.setVisible(true);
  }

  /** Circle the answer the player's current response selects (null clears it). */
  setSelected(answerId: string | null): void {
    if (answerId === this.selectedId) return;
    this.selectedId = answerId;
    this.drawHighlight();
  }

  hide(): void {
    this.container.setVisible(false);
    this.question = null;
    this.selectedId = null;
    this.clearRows();
  }

  // --- layout ---------------------------------------------------------------

  private layout(question: Question): void {
    this.clearRows();
    const t = this.theme;
    const innerLeft = PANEL_MARGIN + FRAME_PX + BOARD_PADDING;
    const innerRight = this.width - innerLeft;

    this.rowsTop = FRAME_PX + BOARD_PADDING + TAG_HEIGHT + this.questionText.height + 12;
    this.boardHeight = this.rowsTop + question.answers.length * ROW_HEIGHT + BOARD_PADDING + FRAME_PX - 4;

    question.answers.forEach((answer, i) => {
      const cy = this.rowsTop + i * ROW_HEIGHT + ROW_HEIGHT / 2;
      const color = this.colors[i % this.colors.length];

      const badge = this.scene.add.graphics();
      badge.fillStyle(color, 1).fillCircle(innerLeft + BADGE_R, cy, BADGE_R);
      const letter = this.scene.add
        .text(innerLeft + BADGE_R, cy + 1, answerLetter(i), { fontFamily: FONT.display, fontSize: "15px", color: cssColor(t.ink) })
        .setOrigin(0.5);
      const label = this.scene.add
        .text(innerLeft + BADGE_R * 2 + 12, cy, answer.text, { fontFamily: FONT.body, fontSize: `${ANSWER_FONT_PX}px`, fontStyle: "700", color: cssColor(t.chalk) })
        .setOrigin(0, 0.5);
      const action = this.scene.add
        .text(innerRight, cy, `${MOVEMENT_ICONS[answer.action]} ${answer.action}`, {
          fontFamily: FONT.body,
          fontSize: `${ACTION_FONT_PX}px`,
          fontStyle: "800",
          letterSpacing: 1,
          color: cssColor(t.chalkDim),
        })
        .setOrigin(1, 0.5);
      this.rowObjects.push(badge, letter, label, action);
      this.container.add([badge, letter, label, action]);
    });

    this.drawBoard();
    this.drawHighlight();
  }

  private drawBoard(): void {
    const t = this.theme;
    const x = PANEL_MARGIN;
    const w = this.width - 2 * PANEL_MARGIN;
    const h = this.boardHeight;
    const g = this.board;
    g.clear();

    // Chalk tray under the board, with two stubs of chalk.
    g.fillStyle(t.frameDark, 1).fillRoundedRect(x + 16, h - 2, w - 32, TRAY_HEIGHT + 2, 3);
    if (!this.highContrast) {
      g.fillStyle(t.chalk, 1).fillRoundedRect(x + 30, h - 5, 26, 6, 3);
      g.fillStyle(t.chalkYellow, 1).fillRoundedRect(x + 62, h - 4, 18, 5, 2.5);
    }

    // Wooden frame, then the board itself.
    g.fillStyle(t.frame, 1).fillRoundedRect(x, 0, w, h, 12);
    g.fillStyle(t.board, 1).fillRoundedRect(x + FRAME_PX, FRAME_PX, w - FRAME_PX * 2, h - FRAME_PX * 2, 7);
    g.lineStyle(2, t.boardEdge, 0.9).strokeRoundedRect(x + FRAME_PX, FRAME_PX, w - FRAME_PX * 2, h - FRAME_PX * 2, 7);

    // A few faint chalk smudges, so the board does not look like a flat panel.
    if (!this.highContrast) {
      g.fillStyle(t.chalk, 0.05);
      g.fillEllipse(x + w * 0.28, h * 0.4, w * 0.4, h * 0.5);
      g.fillEllipse(x + w * 0.74, h * 0.7, w * 0.34, h * 0.4);
    }
    g.lineStyle(this.highContrast ? 3 : 2, this.highContrast ? t.frame : t.frameDark, 1).strokeRoundedRect(x, 0, w, h, 12);
  }

  private drawHighlight(): void {
    this.highlight.clear();
    const question = this.question;
    if (!question || this.selectedId === null) return;
    const index = question.answers.findIndex((a) => a.id === this.selectedId);
    if (index < 0) return;

    const color = this.colors[index % this.colors.length];
    const x = PANEL_MARGIN + FRAME_PX + 6;
    const w = this.width - 2 * (PANEL_MARGIN + FRAME_PX + 6);
    const y = this.rowsTop + index * ROW_HEIGHT + 2;
    this.highlight.fillStyle(color, 0.18).fillRoundedRect(x, y, w, ROW_HEIGHT - 4, 10);
    this.highlight.lineStyle(2.5, color, 1).strokeRoundedRect(x, y, w, ROW_HEIGHT - 4, 10);
  }

  private clearRows(): void {
    for (const o of this.rowObjects) o.destroy();
    this.rowObjects = [];
  }
}
