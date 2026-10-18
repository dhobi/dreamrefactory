/**
 * The repository's lint: SonarJS's rules, the ones SonarCloud gates a PR on,
 * so a finding is seen before the push rather than after a CI run.
 *
 *   npm run lint                    every file
 *   npm run lint -- engine/src      a folder or a file
 *
 * Three levels, on purpose:
 *
 * - error — a mechanical defect: a dead store, an unused import, a loop counter
 *   moved in the body, a duplicated function. Cheap to fix and never meant.
 * - warn — shape, not defect: cognitive complexity, nested templates and
 *   conditionals, regexes that could backtrack. Much of the engine transcribes
 *   an executable's routine branch for branch, and splitting one to satisfy a
 *   count would hide what it was read from. Reported, never blocking.
 * - off — the repository's own idioms (`t[a] = t[b] = x` in the ports, `void`
 *   for a promise left to run), and the security rules SonarCloud keeps as
 *   hotspots for a person to review: commands run from PATH, http URLs, eval
 *   and hashing in the tools and tests.
 *
 * CI lints the files a PR changes and fails on errors only (tests.yml).
 */
import sonarjs from "eslint-plugin-sonarjs";
import tseslint from "typescript-eslint";

export default [
  {
    // what .gitignore keeps out of the history, and the libraries the docs ship as they came
    ignores: [
      "**/node_modules/**", "**/dist/**", "**/out/**", "**/gamefiles/**", "docs/.vitepress/cache/**", "**/*.d.ts",
      ".*.ts", "docs/public/**/vendor/**",
    ],
  },
  {
    files: ["**/*.ts", "**/*.mts", "**/*.js", "**/*.mjs"],
    languageOptions: { parser: tseslint.parser },
    // the plugin is registered so the few existing disable comments that name its rules resolve
    plugins: { sonarjs, "@typescript-eslint": tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: {
      ...sonarjs.configs.recommended.rules,

      // ---- shape: reported, not blocking ----
      "sonarjs/cognitive-complexity": "warn",
      "sonarjs/no-nested-template-literals": "warn",
      "sonarjs/no-nested-conditional": "warn",
      "sonarjs/no-nested-functions": "warn",
      "sonarjs/super-linear-regex": "warn",
      "sonarjs/slow-regex": "warn",
      "sonarjs/regex-complexity": "warn",
      "sonarjs/todo-tag": "warn",
      // the machine tests' bounded retries (`for (let tries = 0; !h.arrived; tries++)`),
      // their exact float checks of a value the original computes the same way, and
      // a long test file's look-alike helpers: reported, not blocking
      "sonarjs/misplaced-loop-counter": "warn",
      "sonarjs/no-floating-point-equality": "warn",
      "sonarjs/no-identical-functions": "warn",
      "sonarjs/use-type-alias": "warn",
      // `!(a < b)` is not `a >= b` once a NaN can be in it
      "sonarjs/no-inverted-boolean-check": "warn",

      // ---- the repository's idioms ----
      "sonarjs/no-nested-assignment": "off",
      "sonarjs/void-use": "off",
      // an alias that names what a string or number means (`type Html = string`)
      "sonarjs/redundant-type-aliases": "off",

      // ---- SonarCloud's hotspots: a person reviews them there ----
      "sonarjs/no-os-command-from-path": "off",
      "sonarjs/os-command": "off",
      "sonarjs/no-clear-text-protocols": "off",
      "sonarjs/code-eval": "off",
      "sonarjs/no-hardcoded-ip": "off",
      "sonarjs/hashing": "off",
      "sonarjs/pseudo-random": "off",
      "sonarjs/publicly-writable-directories": "off",
    },
  },
];
