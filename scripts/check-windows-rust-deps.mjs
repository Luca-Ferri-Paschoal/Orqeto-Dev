import { assertNoGlibForWindows } from "./windows-rust-dependency-graph.mjs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const target = "x86_64-pc-windows-msvc"
const result = spawnSync("cargo", [
  "metadata",
  "--format-version", "1",
  "--locked",
  "--filter-platform", target,
  "--manifest-path", path.join(root, "src-tauri", "Cargo.toml"),
], {
  cwd: root,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
  windowsHide: true,
})

if (result.error) {
  console.error(`[Windows Rust] Could not execute Cargo: ${result.error.message}`)
  process.exit(1)
}
if (result.status !== 0) {
  console.error(`[Windows Rust] cargo metadata failed (exit ${result.status ?? "unknown"}).`)
  console.error(result.stderr.trim())
  process.exit(1)
}

try {
  const metadata = JSON.parse(result.stdout)
  const count = assertNoGlibForWindows(metadata)
  console.log(`[Windows Rust] PASS: ${count} resolved packages for ${target}; glib is not in the target graph.`)
  console.log("[Windows Rust] Note: Cargo.lock still tracks Linux-specific packages; this check does not resolve the Linux glib advisory.")
} catch (error) {
  console.error(`[Windows Rust] FAIL: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
}
