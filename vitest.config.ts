import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Tests share one Postgres database; run files serially.
    fileParallelism: false,
    setupFiles: ["test/setup-env.ts"],
    testTimeout: 20000,
  },
});
