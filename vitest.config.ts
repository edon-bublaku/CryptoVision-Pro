import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/src/**/*.test.ts", "apps/*/lib/**/*.test.ts", "apps/*/src/**/*.test.ts"],
    environment: "node",
    // Generated secrets and any embedded database stay out of the developer's real ~/.cryptovision.
    env: { CV_HOME: mkdtempSync(join(tmpdir(), "cv-test-")) },
  },
});
