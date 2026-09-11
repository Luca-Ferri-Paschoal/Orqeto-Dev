import js from "@eslint/js"
import type { Linter } from "eslint"
import { defineConfig } from "eslint/config"
import reactHooks from "eslint-plugin-react-hooks"
import { reactRefresh } from "eslint-plugin-react-refresh"
import simpleImportSort from "eslint-plugin-simple-import-sort"
import globals from "globals"
import path from "node:path"
import { fileURLToPath } from "node:url"
import tseslint from "typescript-eslint"

const tsconfigRootDir = path.dirname(fileURLToPath(import.meta.url))

const codeFiles = [
	"**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}",
]

const typeScriptFiles = [
	"*.{ts,mts,cts}",
	"src/**/*.{ts,tsx,mts,cts}",
	"scripts/**/*.{ts,tsx,mts,cts}",
	"integrations/vscode/src/**/*.{ts,tsx,mts,cts}",
]

const typedTypeScriptFiles = [
	"src/**/*.{ts,tsx,mts,cts}",
	"scripts/**/*.{ts,tsx,mts,cts}",
	"integrations/vscode/src/**/*.{ts,tsx,mts,cts}",
]

const reactFiles = [
	"src/**/*.{js,jsx,ts,tsx}",
]

const browserFiles = [
	"src/**/*.{js,jsx,ts,tsx}",
]

const nodeFiles = [
	"scripts/**/*.{js,mjs,cjs,ts,mts,cts}",
	"integrations/vscode/src/**/*.{js,mjs,cjs,ts,mts,cts}",
	"*.{js,mjs,cjs,ts,mts,cts}",
	"**/*.config.{js,mjs,cjs,ts,mts,cts}",
]

const viteReactFiles = [
	"src/**/*.{jsx,tsx}",
]

const baseRules: Linter.RulesRecord = {
	eqeqeq: [
		"error",
		"always",
	],
	"no-debugger": "error",
	"simple-import-sort/imports": [
		"error",
		{
			groups: [
				[
					"^",
				],
			],
		},
	],
}

export default defineConfig(
	{
		ignores: [
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/coverage/**",
			"**/.vite/**",
			".lint-batch/**",
			"src-tauri/**",
		],
	},
	{
		files: codeFiles,
		plugins: {
			"simple-import-sort": simpleImportSort,
		},
		rules: baseRules,
	},
	{
		files: [
			"**/*.{js,jsx,mjs,cjs}",
		],
		extends: [
			js.configs.recommended,
		],
	},
	{
		files: typeScriptFiles,
		extends: [
			tseslint.configs.recommended,
		],
		rules: {
			"@typescript-eslint/consistent-type-imports": [
				"error",
				{
					prefer: "type-imports",
					fixStyle: "inline-type-imports",
				},
			],
			"@typescript-eslint/no-explicit-any": "error",
			"@typescript-eslint/no-non-null-assertion": "error",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
					varsIgnorePattern: "^_",
					caughtErrorsIgnorePattern: "^_",
				},
			],
		},
	},
	{
		files: typedTypeScriptFiles,
		extends: [
			tseslint.configs.recommendedTypeChecked,
		],
		languageOptions: {
			parserOptions: {
				projectService: true,
				tsconfigRootDir,
			},
		},
		rules: {
			"@typescript-eslint/await-thenable": "error",
			"@typescript-eslint/no-floating-promises": [
				"error",
				{
					ignoreVoid: true,
				},
			],
			"@typescript-eslint/no-misused-promises": [
				"error",
				{
					checksVoidReturn: {
						attributes: false,
					},
				},
			],
			"@typescript-eslint/no-unnecessary-type-assertion": "error",
		},
	},
	{
		files: nodeFiles,
		languageOptions: {
			globals: globals.node,
		},
	},
	{
		files: browserFiles,
		languageOptions: {
			globals: globals.browser,
		},
	},
	{
		files: reactFiles,
		extends: [
			reactHooks.configs.flat.recommended,
		],
	},
	{
		files: viteReactFiles,
		plugins: {
			"react-refresh": reactRefresh.plugin,
		},
		rules: {
			"react-refresh/only-export-components": [
				"error",
				{
					allowConstantExport: true,
				},
			],
		},
	},
)
