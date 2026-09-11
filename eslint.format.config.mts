import stylistic from "@stylistic/eslint-plugin"
import type { Linter } from "eslint"
import { defineConfig } from "eslint/config"
import tseslint from "typescript-eslint"

const typeScriptFiles = [
	"*.{ts,mts,cts}",
	"src/**/*.{ts,tsx,mts,cts}",
	"scripts/**/*.{ts,tsx,mts,cts}",
	"integrations/vscode/src/**/*.{ts,tsx,mts,cts}",
]

const reactFiles = [
	"src/**/*.{tsx}",
]

const oneItemListStyle = {
	singleLine: {
		maxItems: 1,
	},
	multiline: {
		minItems: 2,
	},
}

const stylisticRules: Linter.RulesRecord = {
	curly: [
		"error",
		"multi-or-nest",
	],
	"@stylistic/semi": [
		"error",
		"never",
		{
			beforeStatementContinuationChars: "always",
		},
	],
	"@stylistic/quotes": [
		"error",
		"double",
		{
			avoidEscape: true,
		},
	],
	"@stylistic/comma-dangle": [
		"error",
		"always-multiline",
	],
	"@stylistic/comma-spacing": [
		"error",
		{
			before: false,
			after: true,
		},
	],
	"@stylistic/comma-style": [
		"error",
		"last",
	],
	"@stylistic/brace-style": [
		"error",
		"1tbs",
		{
			allowSingleLine: true,
		},
	],
	"@stylistic/block-spacing": [
		"error",
		"always",
	],
	"@stylistic/object-curly-spacing": [
		"error",
		"always",
	],
	"@stylistic/array-bracket-spacing": [
		"error",
		"never",
	],
	"@stylistic/space-in-parens": [
		"error",
		"never",
	],
	"@stylistic/space-infix-ops": "error",
	"@stylistic/space-unary-ops": "error",
	"@stylistic/keyword-spacing": "error",
	"@stylistic/function-call-spacing": [
		"error",
		"never",
	],
	"@stylistic/arrow-spacing": [
		"error",
		{
			before: true,
			after: true,
		},
	],
	"@stylistic/exp-list-style": [
		"error",
		{
			overrides: {
				ArrowFunctionExpression: oneItemListStyle,
				CallExpression: oneItemListStyle,
				FunctionDeclaration: oneItemListStyle,
				FunctionExpression: oneItemListStyle,
				ImportDeclaration: oneItemListStyle,
				NewExpression: oneItemListStyle,
				TSDeclareFunction: oneItemListStyle,
				TSFunctionType: oneItemListStyle,
			},
		},
	],
	"@stylistic/multiline-ternary": [
		"error",
		"always",
	],
	"@stylistic/operator-linebreak": [
		"error",
		"after",
		{
			overrides: {
				"=": "none",
				"?": "after",
				":": "after",
			},
		},
	],
	"@stylistic/nonblock-statement-body-position": [
		"error",
		"below",
	],
	"@stylistic/padded-blocks": [
		"error",
		"never",
	],
	"@stylistic/no-multiple-empty-lines": [
		"error",
		{
			max: 1,
			maxBOF: 0,
			maxEOF: 0,
		},
	],
	"@stylistic/padding-line-between-statements": [
		"error",
		{
			blankLine: "never",
			prev: "var",
			next: "var",
		},
		{
			blankLine: "always",
			prev: "import",
			next: "*",
		},
		{
			blankLine: "never",
			prev: "import",
			next: "import",
		},
	],
	"@stylistic/no-trailing-spaces": "error",
	"@stylistic/eol-last": [
		"error",
		"always",
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
		files: typeScriptFiles,
		languageOptions: {
			parser: tseslint.parser,
			parserOptions: {
				ecmaFeatures: {
					jsx: true,
				},
			},
		},
		plugins: {
			"@stylistic": stylistic,
		},
		rules: {
			...stylisticRules,
			"@stylistic/member-delimiter-style": [
				"error",
				{
					multiline: {
						delimiter: "none",
						requireLast: false,
					},
					singleline: {
						delimiter: "semi",
						requireLast: false,
					},
				},
			],
		},
	},
	{
		files: reactFiles,
		rules: {
			"@stylistic/jsx-first-prop-new-line": [
				"error",
				"multiprop",
			],
			"@stylistic/jsx-max-props-per-line": [
				"error",
				{
					maximum: 1,
					when: "always",
				},
			],
			"@stylistic/jsx-closing-bracket-location": [
				"error",
				{
					nonEmpty: "tag-aligned",
					selfClosing: "tag-aligned",
				},
			],
			"@stylistic/jsx-one-expression-per-line": [
				"error",
				{
					allow: "none",
				},
			],
		},
	},
)
