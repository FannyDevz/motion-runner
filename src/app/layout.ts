/**
 * Where the camera tags (menu button, camera status, preview, meters) go, chosen from the screen size.
 * The game is a tall, fixed-shape column, so what changes between devices is how much room is left around it.
 *
 *  - "wide":  there is room beside the game column, so the tags float there (desktop, tablet landscape,
 *             phone landscape).
 *  - "side":  no room beside it, but the screen is wide enough to give the tags their own column and
 *             shrink the game a little (tablet portrait).
 *  - "stack": a narrow screen (phone portrait): the tags become a bar under the game.
 */
export type LayoutMode = "wide" | "side" | "stack";

export interface LayoutRules {
  /** Width ÷ height of the game column. */
  gameAspect: number;
  /** Space needed on each side of the game column for the floating tags to fit. */
  minSidePx: number;
  /** Narrowest screen that can spare a whole column for the tags. */
  sideColumnMinWidthPx: number;
  /** Width of that column. */
  sideColumnPx: number;
  /** Height of the bar under the game in "stack" mode (without the device's bottom inset). */
  stackBarPx: number;
}

export const LAYOUT_RULES: LayoutRules = {
  gameAspect: 480 / 800,
  minSidePx: 204,
  sideColumnMinWidthPx: 700,
  sideColumnPx: 232,
  stackBarPx: 104,
};

/** The game column's width on a screen of this size (it fills the height or the width, whichever runs out first). */
export function gameColumnWidth(width: number, height: number, rules: LayoutRules = LAYOUT_RULES): number {
  return Math.min(width, height * rules.gameAspect);
}

export function computeLayout(width: number, height: number, rules: LayoutRules = LAYOUT_RULES): LayoutMode {
  const side = (width - gameColumnWidth(width, height, rules)) / 2;
  if (side >= rules.minSidePx) return "wide";
  return width >= rules.sideColumnMinWidthPx ? "side" : "stack";
}
