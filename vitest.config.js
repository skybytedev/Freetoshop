import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./tests/js/setup.js"],
    include: ["tests/js/**/*.test.js"],
  },
});
