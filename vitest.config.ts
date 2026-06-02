import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/vscode/integration/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov", "json-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/node_modules/**",
        "**/dist/**",
        "**/out/**",
        // Re-export barrels (no executable code worth measuring).
        "packages/shared/src/index.ts",
        "packages/shared/src/mcp/index.ts",
        // CLI / runtime entry points (exercised via integration, not unit tests).
        "packages/shared/src/init.ts",
        "packages/shared/src/mcp/bin.ts",
        // VS Code extension entry + glue around the VS Code API (covered by
        // tests/vscode/integration/* which run in a real VS Code host, not by
        // the unit suite that uses a mocked `vscode` module).
        "packages/vscode/src/extension.ts",
        "packages/vscode/src/chatParticipant.ts",
        "packages/vscode/src/extractText.ts",
        "packages/vscode/src/llmIngest.ts",
        "packages/vscode/src/mcpProvider.ts",
        "packages/vscode/src/modelSelection.ts",
      ],
      thresholds: {
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
