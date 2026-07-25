import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: ["index.ts"],
      reporter: ["text", "text-summary", "html", "lcov"],
      // Ratcheted floor. Raise as coverage grows.
      thresholds: {
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
