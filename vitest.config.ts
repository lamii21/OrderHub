import { defineConfig } from "vitest/config";
import path from "node:path";

// Deliberately not next/experimental's vitest preset — this project has no
// React component tests (every requested test category is backend logic:
// unit/integration/workflow/webhook/connector/Server Action/Supabase/
// engine/registry), so a plain Node environment is enough and keeps this
// config dependency-free beyond vitest itself.
export default defineConfig({
  resolve: {
    alias: {
      // Mirrors tsconfig.json's "@/*" -> "./*" path mapping.
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "./coverage",
      include: [
        "lib/**/*.ts",
        "app/**/actions.ts",
        "app/api/**/route.ts",
      ],
      exclude: [
        "lib/supabase.ts",
        "lib/supabase-server.ts",
        "lib/supabase-middleware.ts",
        "**/*.d.ts",
      ],
    },
  },
});
