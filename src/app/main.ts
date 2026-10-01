import { gameConfig } from "../config/gameConfig";
import { loadQuestionBank } from "../questions";
import { loadFonts } from "../ui/theme";
import { GameApp } from "./GameApp";

// The canvas draws its text once, so wait for the web fonts (or give up after a moment and use the fallbacks).
// The questions live in public/questions/*.json and are read now, so they can be edited without a rebuild.
const [, questions] = await Promise.all([
  loadFonts(),
  loadQuestionBank(`${import.meta.env.BASE_URL}questions/`, { laneOrder: gameConfig.runner.questions.laneOrder }),
]);

new GameApp(questions);
