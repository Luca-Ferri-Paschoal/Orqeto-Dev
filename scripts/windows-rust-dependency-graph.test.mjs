import { assertNoGlibForWindows, inspectResolvedGraph } from "./windows-rust-dependency-graph.mjs"
import assert from "node:assert/strict"
import test from "node:test"

const root = "path+file:///orqeto#2.0.0"
const glib = "registry+https://crates.io/glib#0.18.5"
const tauri = "registry+https://crates.io/tauri#2.11.5"
const graph = {
  packages: [
    { id: root, name: "orqeto-dev", version: "2.0.0" },
    { id: tauri, name: "tauri", version: "2.11.5" },
    { id: glib, name: "glib", version: "0.18.5" },
  ],
  resolve: {
    root,
    nodes: [
      { id: root, deps: [{ pkg: tauri }] },
      { id: tauri, deps: [] },
      { id: glib, deps: [] },
    ],
  },
}

test("ignores packages present in the lockfile but absent from the Windows graph", () => {
  assert.equal(assertNoGlibForWindows(graph), 2)
})

test("rejects a vulnerable Linux crate if it becomes reachable on Windows", () => {
  const withGlib = structuredClone(graph)
  withGlib.resolve.nodes[1].deps.push({ pkg: glib })
  assert.throws(() => assertNoGlibForWindows(withGlib), /glib appears.*0\.18\.5/)
})

test("fails closed for incomplete metadata", () => {
  assert.throws(() => inspectResolvedGraph({ packages: [] }), /incomplete/)
  const withMissingNode = structuredClone(graph)
  withMissingNode.resolve.nodes.pop()
  withMissingNode.resolve.nodes[0].deps = [{ pkg: glib }]
  assert.throws(() => inspectResolvedGraph(withMissingNode), /unresolved package/)
})
