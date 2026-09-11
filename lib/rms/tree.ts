// lib/rms/tree.ts — turning a flat, parent-linked list into a tree the chart can walk.
//
// Pure. The API hands back one row per employee with a manager id; everything about
// nesting, ordering and finding a node again is worked out here so it can be tested
// without a browser or a database.

export interface TreeInput {
  id: string
  managerId: string | null
  fullName: string | null
}

export interface TreeNode<T extends TreeInput> {
  node: T
  children: TreeNode<T>[]
}

/**
 * Build a forest from a flat list. A row whose manager id does not resolve to another
 * row in the same list becomes a root — this is what makes a per-company slice of the
 * org safe to build even though the manager column can point outside it (it never does
 * in this data, but the function does not assume that).
 *
 * Roots come back sorted by name, and so does every sibling group, so the same input
 * always lays out the same way.
 */
export function buildForest<T extends TreeInput>(rows: T[]): TreeNode<T>[] {
  const byId = new Map(rows.map(r => [r.id, r]))
  const children = new Map<string, T[]>()
  const roots: T[] = []

  for (const r of rows) {
    if (r.managerId && byId.has(r.managerId)) {
      const arr = children.get(r.managerId) || []
      arr.push(r)
      children.set(r.managerId, arr)
    } else {
      roots.push(r)
    }
  }

  const byName = (a: T, b: T) => String(a.fullName || '').localeCompare(String(b.fullName || ''))

  const wrap = (r: T): TreeNode<T> => ({
    node: r,
    children: (children.get(r.id) || []).sort(byName).map(wrap),
  })

  return roots.sort(byName).map(wrap)
}

/** Every node in the forest, root-first, depth-first — the order a search or an
 *  "expand all" would want to walk them in. */
export function flatten<T extends TreeInput>(forest: TreeNode<T>[]): TreeNode<T>[] {
  const out: TreeNode<T>[] = []
  const walk = (n: TreeNode<T>) => { out.push(n); n.children.forEach(walk) }
  forest.forEach(walk)
  return out
}

/** The path from a root down to one node, inclusive — what "expand to here" has to
 *  open. Returns [] if the id is not in the forest, rather than throwing: a stale
 *  search result pointing at someone who has since left should not crash the chart. */
export function pathTo<T extends TreeInput>(forest: TreeNode<T>[], id: string): TreeNode<T>[] {
  for (const root of forest) {
    const found = findPath(root, id)
    if (found) return found
  }
  return []
}

function findPath<T extends TreeInput>(n: TreeNode<T>, id: string): TreeNode<T>[] | null {
  if (n.node.id === id) return [n]
  for (const c of n.children) {
    const sub = findPath(c, id)
    if (sub) return [n, ...sub]
  }
  return null
}

/** Total nodes in the forest — used to size the "N people" caption without a second
 *  pass over the raw rows. */
export function countNodes<T extends TreeInput>(forest: TreeNode<T>[]): number {
  return forest.reduce((n, r) => n + 1 + countNodes(r.children), 0)
}
