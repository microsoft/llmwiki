import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/vscode/integration/**"],
    passWithNoTests: true,
  },
});
