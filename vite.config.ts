import { resolve } from "node:path";
import { defineConfig } from "vite";

// Multi-page: index.html = the game, movement.html = the movement/pose test page.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        movement: resolve(import.meta.dirname, "movement.html"),
      },
    },
  },
});
