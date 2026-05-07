import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  {
    rules: {
      // The new strict React-hooks rules (set-state-in-effect, purity,
      // refs-during-render, preserve-manual-memoization) flag patterns this
      // codebase uses on purpose — client-only hydration, Date.now() in
      // useMemo, ref reads in render. Treat them as hints, not build errors.
      "react-hooks/set-state-in-effect":         "off",
      "react-hooks/purity":                      "off",
      "react-hooks/refs":                        "off",
      "react-hooks/preserve-manual-memoization": "off",
    },
  },
]);

export default eslintConfig;
