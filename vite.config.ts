import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const rootDirectory = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	plugins: [
		react(),
		tailwindcss(),
	],
	build: {
		rolldownOptions: {
			output: {
				codeSplitting: {
					groups: [
						{
							name: "vendor",
							test: /[\\/]node_modules[\\/]/,
							priority: 10,
							maxSize: 350_000,
						},
					],
				},
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(
				rootDirectory,
				"src",
			),
		},
	},
	server: {
		port: 1430,
		strictPort: true,
		watch: {
			ignored: [
				"**/src-tauri/**",
				/\.orqeto-tmp-\d+-\d+$/,
			],
		},
	},
	clearScreen: false,
})
