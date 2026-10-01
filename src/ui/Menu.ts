import { Emitter } from "../utils/Emitter";
import { TIMER_LIMITS, type PlayerSettings } from "../settings/Settings";
import { formatSeconds } from "./format";
import { Pager } from "./Pager";

export type MenuScreen = "main" | "settings" | "howto" | "calibrate";

export interface CategoryOption {
  id: string;
  label: string;
  /** Number of questions, shown next to the label. */
  count: number;
}

interface MenuEvents extends Record<string, unknown> {
  play: undefined;
  enableCamera: undefined;
  calibrate: undefined;
  settingsChanged: PlayerSettings;
  /** The menu closed (by Play, Escape, or the dialog being dismissed). */
  closed: undefined;
  opened: undefined;
  screenChanged: MenuScreen;
}

/** The sliders that hold a number of seconds. */
const TIMER_FIELDS = ["readSeconds", "answerSeconds", "lockInSeconds"] as const;

const FOCUSABLE = 'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])';

/**
 * The DOM menu: main screen, settings, how-to-play and the calibration screen. It
 * owns navigation, keyboard handling (Tab is trapped inside, Escape goes back or
 * closes) and the settings form; everything it does is reported as events.
 */
export class Menu extends Emitter<MenuEvents> {
  private readonly screens = new Map<MenuScreen, HTMLElement>();
  private readonly form: HTMLFormElement;
  private readonly categoryList: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly cameraButton: HTMLButtonElement;
  private readonly calibrateButton: HTMLButtonElement;
  private readonly howtoPages: HTMLElement[];
  private readonly howtoPager: Pager;
  private readonly howtoPrev: HTMLButtonElement;
  private readonly howtoNext: HTMLButtonElement;
  private readonly howtoDots: HTMLElement;
  private readonly howtoCount: HTMLElement;
  private current: MenuScreen = "main";
  private returnFocus: HTMLElement | null = null;
  private settings: PlayerSettings;

  constructor(
    private readonly root: HTMLElement,
    categories: readonly CategoryOption[],
    settings: PlayerSettings,
  ) {
    super();
    this.settings = settings;

    for (const el of root.querySelectorAll<HTMLElement>("[data-screen]")) {
      this.screens.set(el.dataset.screen as MenuScreen, el);
    }
    this.form = this.require<HTMLFormElement>("#settings-form");
    this.categoryList = this.require("#category-list");
    this.statusEl = this.require("#menu-status");
    this.cameraButton = this.require<HTMLButtonElement>("#menu-camera");
    this.calibrateButton = this.require<HTMLButtonElement>("#menu-calibrate");

    this.howtoPages = [...root.querySelectorAll<HTMLElement>("[data-howto-page]")];
    this.howtoPager = new Pager(Math.max(1, this.howtoPages.length));
    this.howtoPrev = this.require<HTMLButtonElement>("#howto-prev");
    this.howtoNext = this.require<HTMLButtonElement>("#howto-next");
    this.howtoDots = this.require("#howto-dots");
    this.howtoCount = this.require("#howto-count");
    this.howtoPrev.addEventListener("click", () => this.turnHowtoPage(-1));
    this.howtoNext.addEventListener("click", () => this.turnHowtoPage(1));
    for (let i = 0; i < this.howtoPages.length; i++) this.howtoDots.append(document.createElement("i"));

    this.buildCategoryList(categories);
    for (const name of TIMER_FIELDS) {
      const slider = this.control<HTMLInputElement>(name);
      slider.min = String(TIMER_LIMITS[name].min);
      slider.max = String(TIMER_LIMITS[name].max);
      slider.step = String(TIMER_LIMITS[name].step);
    }
    this.writeSettings(settings);

    this.require("#menu-play").addEventListener("click", () => this.emitPlay());
    this.cameraButton.addEventListener("click", () => this.emit("enableCamera", undefined));
    this.calibrateButton.addEventListener("click", () => this.emit("calibrate", undefined));
    for (const button of root.querySelectorAll<HTMLElement>("[data-goto]")) {
      button.addEventListener("click", () => this.showScreen(button.dataset.goto as MenuScreen));
    }
    this.form.addEventListener("input", (event) => this.onFormInput(event));
    root.addEventListener("keydown", (event) => this.onKeyDown(event));
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  get screen(): MenuScreen {
    return this.current;
  }

  open(screen: MenuScreen = "main"): void {
    if (!this.isOpen) {
      this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      this.root.hidden = false;
      this.showScreen(screen);
      this.emit("opened", undefined);
    } else {
      this.showScreen(screen);
    }
  }

  close(): void {
    if (!this.isOpen) return;
    this.root.hidden = true;
    const target = this.returnFocus;
    this.returnFocus = null;
    // Give the keyboard back to the game; do not leave focus on a hidden button.
    if (target && document.contains(target) && target.id !== "menu-play") target.focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    this.emit("closed", undefined);
  }

  showScreen(screen: MenuScreen): void {
    this.current = screen;
    for (const [name, el] of this.screens) el.hidden = name !== screen;
    if (screen === "howto") {
      this.howtoPager.reset();
      this.renderHowto();
    }
    this.focusFirst();
    this.emit("screenChanged", screen);
  }

  /** Reflect settings stored elsewhere (e.g. after loading) in the form. */
  setSettings(settings: PlayerSettings): void {
    this.settings = settings;
    this.writeSettings(settings);
  }

  setStatus(text: string, level: "ok" | "warn" | "error" = "ok"): void {
    this.statusEl.textContent = text;
    this.statusEl.dataset.level = level;
  }

  /** Update the camera and calibration buttons to match the camera state. */
  setCameraState(state: { starting: boolean; active: boolean; calibrated: boolean }): void {
    this.cameraButton.disabled = state.starting || state.active;
    this.cameraButton.textContent = state.starting ? "Menyalakan kamera…" : state.active ? "Kamera aktif ✓" : "Aktifkan kamera";
    this.calibrateButton.disabled = !state.active;
    this.calibrateButton.textContent = state.calibrated ? "Kalibrasi ulang ✓" : "Kalibrasi gerakan";
  }

  // --- internals ------------------------------------------------------------

  private require<T extends HTMLElement = HTMLElement>(selector: string): T {
    const el = this.root.querySelector<T>(selector);
    if (!el) throw new Error(`Menu is missing ${selector}`);
    return el;
  }

  private emitPlay(): void {
    this.emit("play", undefined);
    this.close();
  }

  private currentScreenElement(): HTMLElement {
    return this.screens.get(this.current) as HTMLElement;
  }

  private focusFirst(): void {
    const screen = this.currentScreenElement();
    const target = screen.querySelector<HTMLElement>("[data-autofocus]:not(:disabled)") ?? screen.querySelector<HTMLElement>(FOCUSABLE);
    (target ?? screen).focus({ preventScroll: true });
  }

  private onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (this.current === "main") this.emitPlay();
      else this.showScreen("main");
      return;
    }
    // The how-to-play guide: left and right arrows turn the pages.
    if (this.current === "howto" && (event.key === "ArrowRight" || event.key === "ArrowLeft")) {
      event.preventDefault();
      const forward = event.key === "ArrowRight";
      // Arrows only turn pages; leaving the guide on the last page is the "Mengerti" button's job.
      if (!(forward && this.howtoPager.isLast)) this.turnHowtoPage(forward ? 1 : -1);
      return;
    }
    if (event.key !== "Tab") return;

    // Keep Tab inside the visible screen.
    const items = [...this.currentScreenElement().querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest("[hidden]"));
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !this.root.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !this.root.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }

  /** Next (or previous) page of the guide; "Mengerti" on the last page returns to the main menu. */
  private turnHowtoPage(direction: 1 | -1): void {
    if (direction === 1 && this.howtoPager.isLast) {
      this.showScreen("main");
      return;
    }
    if (direction === 1) this.howtoPager.next();
    else this.howtoPager.previous();
    this.renderHowto();
    this.currentScreenElement().closest<HTMLElement>(".menu-card")?.scrollTo({ top: 0 });
  }

  private renderHowto(): void {
    const pager = this.howtoPager;
    this.howtoPages.forEach((page, i) => (page.hidden = i !== pager.index));
    [...this.howtoDots.children].forEach((dot, i) => dot.toggleAttribute("data-active", i === pager.index));

    // Do not leave the keyboard on a button that has just been disabled.
    const hadFocus = document.activeElement === this.howtoPrev;
    this.howtoPrev.disabled = pager.isFirst;
    if (hadFocus && pager.isFirst) this.howtoNext.focus();

    this.howtoNext.textContent = pager.isLast ? "Mengerti" : "Berikutnya";
    const title = this.howtoPages[pager.index]?.getAttribute("aria-label") ?? "";
    this.howtoCount.textContent = `Halaman ${pager.label.replace(" / ", " dari ")}: ${title}`;
  }

  private buildCategoryList(categories: readonly CategoryOption[]): void {
    this.categoryList.replaceChildren();
    for (const c of categories) {
      const label = document.createElement("label");
      label.className = "check";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "category";
      input.value = c.id;
      label.append(input, ` ${c.label} (${c.count})`);
      this.categoryList.append(label);
    }
  }

  private categoryInputs(): HTMLInputElement[] {
    return [...this.categoryList.querySelectorAll<HTMLInputElement>('input[name="category"]')];
  }

  private control<T extends HTMLElement>(name: string): T {
    const el = this.form.elements.namedItem(name);
    if (!el) throw new Error(`Settings form is missing "${name}"`);
    return el as unknown as T;
  }

  private writeSettings(s: PlayerSettings): void {
    for (const input of this.categoryInputs()) input.checked = s.categories === null || s.categories.includes(input.value);
    this.control<HTMLSelectElement>("difficulty").value = s.difficulty;
    this.control<HTMLSelectElement>("speed").value = s.speed;
    for (const name of TIMER_FIELDS) this.control<HTMLInputElement>(name).value = String(s[name]);
    this.control<HTMLInputElement>("autoLock").checked = s.autoLock;
    this.control<HTMLSelectElement>("sensitivity").value = s.sensitivity;
    this.control<HTMLSelectElement>("cameraSize").value = s.cameraSize;
    this.refreshTimerOutputs();
    this.control<HTMLInputElement>("sound").checked = s.sound;
    this.control<HTMLInputElement>("volume").value = String(s.volume);
    this.control<HTMLInputElement>("highContrast").checked = s.highContrast;
    this.control<HTMLInputElement>("reducedMotion").checked = s.reducedMotion;
    this.control<HTMLInputElement>("showCameraPreview").checked = s.showCameraPreview;
  }

  private onFormInput(event: Event): void {
    const target = event.target;
    // At least one category must stay selected, otherwise there would be nothing to ask.
    if (target instanceof HTMLInputElement && target.name === "category" && this.categoryInputs().every((i) => !i.checked)) {
      target.checked = true;
    }
    this.settings = this.readSettings();
    this.refreshTimerOutputs();
    this.emit("settingsChanged", this.settings);
  }

  /** Show each slider's value next to its label, and grey out the lock-in slider when auto-lock is off. */
  private refreshTimerOutputs(): void {
    for (const name of TIMER_FIELDS) {
      const value = Number(this.control<HTMLInputElement>(name).value);
      this.require(`#out-${name}`).textContent = formatSeconds(value);
    }
    this.control<HTMLInputElement>("lockInSeconds").disabled = !this.control<HTMLInputElement>("autoLock").checked;
  }

  private readSettings(): PlayerSettings {
    const inputs = this.categoryInputs();
    const chosen = inputs.filter((i) => i.checked).map((i) => i.value);
    return {
      categories: chosen.length === inputs.length ? null : chosen,
      difficulty: this.control<HTMLSelectElement>("difficulty").value as PlayerSettings["difficulty"],
      speed: this.control<HTMLSelectElement>("speed").value as PlayerSettings["speed"],
      readSeconds: Number(this.control<HTMLInputElement>("readSeconds").value),
      answerSeconds: Number(this.control<HTMLInputElement>("answerSeconds").value),
      autoLock: this.control<HTMLInputElement>("autoLock").checked,
      lockInSeconds: Number(this.control<HTMLInputElement>("lockInSeconds").value),
      sensitivity: this.control<HTMLSelectElement>("sensitivity").value as PlayerSettings["sensitivity"],
      cameraSize: this.control<HTMLSelectElement>("cameraSize").value as PlayerSettings["cameraSize"],
      sound: this.control<HTMLInputElement>("sound").checked,
      volume: Number(this.control<HTMLInputElement>("volume").value),
      highContrast: this.control<HTMLInputElement>("highContrast").checked,
      reducedMotion: this.control<HTMLInputElement>("reducedMotion").checked,
      showCameraPreview: this.control<HTMLInputElement>("showCameraPreview").checked,
    };
  }
}
