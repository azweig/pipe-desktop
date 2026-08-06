// Flat config (ESLint 9). Pragmatic first pass: keep the signal high and the wall of red low.
// - react-hooks/rules-of-hooks stays an error (real bugs).
// - no-unused-vars is a warning.
// - no-explicit-any is OFF for now (the codebase has ~175 `any`s; tighten incrementally, not in one go).
import js from "@eslint/js"
import tseslint from "typescript-eslint"
import react from "eslint-plugin-react"
import reactHooks from "eslint-plugin-react-hooks"

export default tseslint.config(
  {
    ignores: ["node_modules", "dist", "dist-ssr", "src-tauri/target", "src-tauri/gen"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["src/**/*.{ts,tsx}"],
    plugins: {
      react,
      "react-hooks": reactHooks,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
      },
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    settings: {
      react: { version: "detect" },
    },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "no-unused-vars": "off",
    },
  },
)
