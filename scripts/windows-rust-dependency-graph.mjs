/**
 * Audit the dependencies Cargo actually resolves for a given platform.
 * Cargo.lock intentionally contains dependencies for all supported targets.
 */
export function inspectResolvedGraph(metadata) {
  if (!metadata || !Array.isArray(metadata.packages) || !metadata.resolve ||
    !Array.isArray(metadata.resolve.nodes) || !metadata.resolve.root) {
    throw new Error("Cargo metadata is incomplete: missing packages, resolve.nodes or resolve.root.")
  }

  const packages = new Map(metadata.packages.map(pkg => [pkg.id, pkg]))
  const nodes = new Map(metadata.resolve.nodes.map(node => [node.id, node]))
  const visited = new Set()
  const remaining = [metadata.resolve.root]
  const reachable = []

  while (remaining.length > 0) {
    const id = remaining.pop()
    if (visited.has(id)) continue
    visited.add(id)

    const pkg = packages.get(id)
    const node = nodes.get(id)
    if (!pkg || !node || !Array.isArray(node.deps)) {
      throw new Error(`Cargo metadata contains an unresolved package: ${id}`)
    }

    reachable.push({ name: pkg.name, version: pkg.version })
    for (const dep of node.deps) {
      if (typeof dep.pkg !== "string") {
        throw new Error(`Cargo metadata contains an invalid dependency from ${id}`)
      }
      remaining.push(dep.pkg)
    }
  }

  return reachable
}

export function assertNoGlibForWindows(metadata) {
  const reachable = inspectResolvedGraph(metadata)
  const glib = reachable.filter(pkg => pkg.name === "glib")
  if (glib.length > 0) {
    const versions = glib.map(pkg => pkg.version).join(", ")
    throw new Error(`glib appears in the Windows target dependency graph: ${versions}`)
  }
  return reachable.length
}
