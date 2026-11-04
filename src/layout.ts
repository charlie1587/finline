// Lane layout for a commit graph. Pure and dependency-free so it runs in the panel frame and,
// for tests, straight in Node (`node --test src/layout.test.ts`).
//
// Input: commits in topological order, children before parents (`git log --topo-order`).
// Each commit gets a column; each parent link becomes an edge routed through one lane.

export interface LayoutCommit {
  hash: string
  parents: string[]
}

export interface Edge {
  fromRow: number
  fromCol: number
  /** The parent's row, or `rows` (one past the last) when the parent is not loaded yet. */
  toRow: number
  toCol: number
  /** The lane the edge runs down between its two bends. */
  lane: number
  color: number
}

export interface Layout {
  cols: number[]
  /** Colour index of each commit's node. */
  colors: number[]
  edges: Edge[]
  /** Widest number of lanes used at any row. */
  width: number
}

export function layoutGraph(commits: readonly LayoutCommit[]): Layout {
  const rows = commits.length
  const lanes: (string | null)[] = [] // lane -> hash of the commit it is heading to
  const laneColor: number[] = []
  const open = new Map<string, Omit<Edge, 'toRow' | 'toCol'>[]>() // parent hash -> edges waiting
  const cols: number[] = new Array(rows)
  const colors: number[] = new Array(rows)
  const edges: Edge[] = []
  let nextColor = 0
  let width = 0

  const freeLane = (): number => {
    const i = lanes.indexOf(null)
    if (i !== -1) return i
    lanes.push(null)
    return lanes.length - 1
  }

  for (let row = 0; row < rows; row++) {
    const { hash, parents } = commits[row]

    let col = lanes.indexOf(hash)
    if (col === -1) {
      // A branch tip nothing loaded above points to.
      col = freeLane()
      lanes[col] = hash
      laneColor[col] = nextColor++
    }
    // Every other lane heading here converges into this node and is free from now on.
    for (let j = 0; j < lanes.length; j++) if (j !== col && lanes[j] === hash) lanes[j] = null
    cols[row] = col
    colors[row] = laneColor[col]

    for (const edge of open.get(hash) ?? []) edges.push({ ...edge, toRow: row, toCol: col })
    open.delete(hash)

    lanes[col] = null
    parents.forEach((parent, i) => {
      // The first parent always continues this commit's lane and colour, even when another lane
      // already heads to it: the lanes converge at the parent, and the parent takes the leftmost.
      // Other parents reuse a lane already heading there, or open a new one.
      let lane = i === 0 ? col : lanes.indexOf(parent)
      if (lane === -1) {
        lane = freeLane()
        laneColor[lane] = nextColor++
      }
      lanes[lane] = parent
      const edge = { fromRow: row, fromCol: col, lane, color: laneColor[lane] }
      const waiting = open.get(parent)
      if (waiting) waiting.push(edge)
      else open.set(parent, [edge])
    })

    // Trailing free lanes don't count toward the width.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) lanes.pop()
    width = Math.max(width, col + 1, lanes.length)
  }

  // Parents below the loaded page: run the edge off the bottom in its lane.
  for (const waiting of open.values()) {
    for (const edge of waiting) edges.push({ ...edge, toRow: rows, toCol: edge.lane })
  }

  return { cols, colors, edges, width }
}

/**
 * SVG path for an edge. `x(col)` and `y(row)` give node centres. The edge leaves its node,
 * bends into its lane within one row, runs straight, and bends into the parent in the last row.
 */
export function edgePath(edge: Edge, x: (col: number) => number, y: (row: number) => number): string {
  const { fromRow, fromCol, toRow, toCol, lane } = edge
  const curve = (c1: number, r1: number, c2: number, r2: number) => {
    const ym = (y(r1) + y(r2)) / 2
    return `C ${x(c1)} ${ym} ${x(c2)} ${ym} ${x(c2)} ${y(r2)}`
  }
  let d = `M ${x(fromCol)} ${y(fromRow)}`
  let row = fromRow
  if (lane !== fromCol) {
    if (toRow - fromRow === 1) return `${d} ${curve(fromCol, fromRow, toCol, toRow)}`
    d += ` ${curve(fromCol, fromRow, lane, fromRow + 1)}`
    row = fromRow + 1
  }
  if (lane !== toCol) {
    if (toRow - 1 > row) d += ` L ${x(lane)} ${y(toRow - 1)}`
    d += ` ${curve(lane, toRow - 1, toCol, toRow)}`
  } else {
    d += ` L ${x(toCol)} ${y(toRow)}`
  }
  return d
}
