/**
 * Colours and fonts for the canvas. CSS (src/app/app.css) is the single source of truth for
 * the palette: readTheme() reads its --c-* custom properties at start-up, so the track, the
 * chalkboard and the DOM menu always share the same colours. DEFAULT_THEME is only a fallback
 * for when a property is missing.
 */

export interface Theme {
  ink: number;
  paper: number;
  paper2: number;
  track: number;
  trackDark: number;
  trackLine: number;
  grass: number;
  grassLight: number;
  skyTop: number;
  skyBottom: number;
  stand: number;
  board: number;
  boardEdge: number;
  frame: number;
  frameDark: number;
  chalk: number;
  chalkDim: number;
  chalkYellow: number;
  chalkBlue: number;
  chalkPink: number;
  chalkGreen: number;
  whistle: number;
  good: number;
  bad: number;
  mat: number;
  matDark: number;
  runner: number;
}

/** Fonts are loaded from Google Fonts in index.html; the fallbacks keep the game readable offline. */
export const FONT = {
  display: '"Alfa Slab One", Georgia, Rockwell, serif',
  body: 'Nunito, "Segoe UI", system-ui, sans-serif',
} as const;

/** Font faces to wait for before the canvas draws its first text. */
export const FONT_FACES: readonly string[] = ['400 24px "Alfa Slab One"', '700 16px Nunito', '800 16px Nunito'];

export const DEFAULT_THEME: Readonly<Theme> = {
  ink: 0x1d2a24,
  paper: 0xf6efe0,
  paper2: 0xe9dfc7,
  track: 0xc4512f,
  trackDark: 0xab4325,
  trackLine: 0xfbf6ea,
  grass: 0x3f8a43,
  grassLight: 0x4b9c4f,
  skyTop: 0x8fcbe8,
  skyBottom: 0xeaf4f1,
  stand: 0x38405c,
  board: 0x1f3d34,
  boardEdge: 0x11271f,
  frame: 0x9a6532,
  frameDark: 0x6b4220,
  chalk: 0xf4f1e8,
  chalkDim: 0xb9c4b8,
  chalkYellow: 0xf6d55c,
  chalkBlue: 0x78bff0,
  chalkPink: 0xf59ac0,
  chalkGreen: 0x9be09f,
  whistle: 0xffc933,
  good: 0x2e9e5b,
  bad: 0xd62839,
  mat: 0x2f6fd0,
  matDark: 0x1f4fa0,
  runner: 0x2457d6,
};

/** Pure black and white with saturated accents: for low-vision players. */
export const HIGH_CONTRAST_THEME: Readonly<Theme> = {
  ink: 0x000000,
  paper: 0xffffff,
  paper2: 0xffffff,
  track: 0x000000,
  trackDark: 0x000000,
  trackLine: 0xffffff,
  grass: 0x000000,
  grassLight: 0x000000,
  skyTop: 0x000000,
  skyBottom: 0x000000,
  stand: 0x000000,
  board: 0x000000,
  boardEdge: 0xffffff,
  frame: 0xffffff,
  frameDark: 0xffffff,
  chalk: 0xffffff,
  chalkDim: 0xffffff,
  chalkYellow: 0xffe600,
  chalkBlue: 0x66b3ff,
  chalkPink: 0xff80c0,
  chalkGreen: 0x66ff80,
  whistle: 0xffe600,
  good: 0x66ff80,
  bad: 0xff6666,
  mat: 0x3d8bff,
  matDark: 0xffffff,
  runner: 0xffe600,
};

/** CSS custom property for each theme colour. */
const CSS_NAMES: Readonly<Record<keyof Theme, string>> = {
  ink: "--c-ink",
  paper: "--c-paper",
  paper2: "--c-paper-2",
  track: "--c-track",
  trackDark: "--c-track-dark",
  trackLine: "--c-track-line",
  grass: "--c-grass",
  grassLight: "--c-grass-light",
  skyTop: "--c-sky-top",
  skyBottom: "--c-sky-bottom",
  stand: "--c-stand",
  board: "--c-board",
  boardEdge: "--c-board-edge",
  frame: "--c-frame",
  frameDark: "--c-frame-dark",
  chalk: "--c-chalk",
  chalkDim: "--c-chalk-dim",
  chalkYellow: "--c-chalk-yellow",
  chalkBlue: "--c-chalk-blue",
  chalkPink: "--c-chalk-pink",
  chalkGreen: "--c-chalk-green",
  whistle: "--c-whistle",
  good: "--c-good",
  bad: "--c-bad",
  mat: "--c-mat",
  matDark: "--c-mat-dark",
  runner: "--c-runner",
};

/** Parse "#rgb" or "#rrggbb" (any case, surrounding space allowed) into 0xRRGGBB, or null. */
export function parseColor(text: string): number | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text.trim());
  if (!m) return null;
  const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return parseInt(hex, 16);
}

/** 0xRRGGBB → "#rrggbb", for Phaser text styles. */
export function cssColor(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

/**
 * The theme as defined by CSS. `read` returns a custom property's value (default: the root
 * element's computed style). Missing or malformed values fall back to DEFAULT_THEME.
 */
export function readTheme(read?: (property: string) => string): Theme {
  const getter =
    read ??
    ((property: string): string => (typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(property)));
  const theme = { ...DEFAULT_THEME };
  for (const key of Object.keys(CSS_NAMES) as Array<keyof Theme>) {
    const parsed = parseColor(getter(CSS_NAMES[key]));
    if (parsed !== null) theme[key] = parsed;
  }
  return theme;
}

/** Colours for the answers A, B, C, D, shared by the chalkboard rows and the gate in the road. */
export function answerColors(theme: Theme): readonly number[] {
  return [theme.chalkBlue, theme.chalkGreen, theme.chalkYellow, theme.chalkPink];
}

/** Resolves once the fonts have loaded, or after `timeoutMs` so a blocked font host never delays the game. */
export async function loadFonts(timeoutMs = 2000): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  const loading = Promise.all(FONT_FACES.map((face) => document.fonts.load(face))).then(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  try {
    await Promise.race([loading, timeout]);
  } catch {
    /* fall back to the system fonts */
  }
}
