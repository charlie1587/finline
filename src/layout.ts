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
  /**
   * Set on the two halves of an edge too long to draw whole (see `LONG_EDGE`). `out` leaves the
   * child and ends after one row with an arrow; `in` starts one row above the parent and reaches
   * it. Neither holds a lane in between.
   */
  cut?: 'out' | 'in'
}

export interface Layout {
  cols: number[]
  /** Colour index of each commit's node. */
  colors: number[]
  edges: Edge[]
  /** Widest number of lanes used at any row. */
  width: number
}

/**
 * A merge's edge to a non-first parent spanning more rows than this is cut into two stubs. Long
 * edges otherwise hold a lane each for the whole span: a run of merges whose other parents sit
 * far below (say, `develop` merged into `uat` thirty times) grows a staircase of lanes thousands
 * of rows tall. First-parent edges stay whole so a branch's own line never breaks.
 */
export const LONG_EDGE = 50

/** Marks a lane held by an outgoing stub for one row. */
const STUB = 'stub' // never a hex hash

export function layoutGraph(commits: readonly LayoutCommit[], longEdge = LONG_EDGE): Layout {
  const rows = commits.length
  const rowOf = new Map<string, number>()
  commits.forEach((c, row) => rowOf.set(c.hash, row))
  // Row above a parent -> incoming stubs to open there.
  const stubsIn = new Map<number, { parent: string; color: number }[]>()
  // Lanes held by incoming stubs: a commit prefers any other lane heading to it.
  const stubLanes = new Set<number>()
  const lanes: (string | null)[] = [] // lane -> hash of the commit it is heading to
  const laneColor: number[] = []
  // parent hash -> edges waiting (an incoming stub already knows its toRow)
  const open = new Map<string, (Omit<Edge, 'toRow' | 'toCol'> & { toRow?: number })[]>()
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

    let col = lanes.findIndex((h, j) => h === hash && !stubLanes.has(j))
    if (col === -1) col = lanes.indexOf(hash)
    if (col === -1) {
      // A branch tip nothing loaded above points to.
      col = freeLane()
      lanes[col] = hash
      laneColor[col] = nextColor++
    }
    // Every other lane heading here converges into this node and is free from now on.
    for (let j = 0; j < lanes.length; j++) {
      if (lanes[j] === hash) stubLanes.delete(j)
      // Outgoing stubs from the row above are done once this node has its lane.
      if (j !== col && (lanes[j] === hash || lanes[j] === STUB)) lanes[j] = null
    }
    cols[row] = col
    colors[row] = laneColor[col]

    for (const edge of open.get(hash) ?? []) {
      edges.push({ ...edge, toRow: edge.toRow ?? row, toCol: col })
    }
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
      const color = laneColor[lane]
      // A loaded parent's distance is known; an unloaded one is at least past the last row, and
      // runs off the bottom as usual until that alone makes it long.
      const target = rowOf.get(parent)
      if (i > 0 && (target ?? rows) - row > longEdge) {
        lanes[lane] = STUB
        edges.push({ fromRow: row, fromCol: col, toRow: row + 1, toCol: lane, lane, color, cut: 'out' })
        if (target !== undefined) {
          const list = stubsIn.get(target - 1)
          if (list) list.push({ parent, color })
          else stubsIn.set(target - 1, [{ parent, color }])
        }
        return
      }
      lanes[lane] = parent
      const edge = { fromRow: row, fromCol: col, lane, color }
      const waiting = open.get(parent)
      if (waiting) waiting.push(edge)
      else open.set(parent, [edge])
    })

    // Incoming stubs for the next row: each takes a lane for the last row before its parent.
    for (const { parent, color } of stubsIn.get(row) ?? []) {
      const lane = freeLane()
      lanes[lane] = parent
      stubLanes.add(lane)
      const edge = { fromRow: row, fromCol: lane, toRow: row + 1, lane, color, cut: 'in' as const }
      const waiting = open.get(parent)
      if (waiting) waiting.push(edge)
      else open.set(parent, [edge])
    }

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
 * When two adjacent rows are further apart than `bend` (an expanded row sits between them), a
 * bend still takes only `bend` pixels: right under the node when leaving it, just above the
 * parent when arriving, with a straight run through the gap.
 */
export function edgePath(
  edge: Edge,
  x: (col: number) => number,
  y: (row: number) => number,
  bend = Infinity
): string {
  const { fromRow, fromCol, toRow, toCol, lane, cut } = edge
  if (cut) return stubPath(edge, x, y, bend)
  const curve = (c1: number, r1: number, c2: number, r2: number, early: boolean) => {
    let y1 = y(r1)
    let y2 = y(r2)
    let before = ''
    let after = ''
    if (y2 - y1 > bend) {
      if (early) {
        after = ` L ${x(c2)} ${y2}`
        y2 = y1 + bend
      } else {
        y1 = y2 - bend
        before = `L ${x(c1)} ${y1} `
      }
    }
    const ym = (y1 + y2) / 2
    return `${before}C ${x(c1)} ${ym} ${x(c2)} ${ym} ${x(c2)} ${y2}${after}`
  }
  let d = `M ${x(fromCol)} ${y(fromRow)}`
  let row = fromRow
  if (lane !== fromCol) {
    if (toRow - fromRow === 1) return `${d} ${curve(fromCol, fromRow, toCol, toRow, true)}`
    d += ` ${curve(fromCol, fromRow, lane, fromRow + 1, true)}`
    row = fromRow + 1
  }
  if (lane !== toCol) {
    if (toRow - 1 > row) d += ` L ${x(lane)} ${y(toRow - 1)}`
    d += ` ${curve(lane, toRow - 1, toCol, toRow, false)}`
  } else {
    d += ` L ${x(toCol)} ${y(toRow)}`
  }
  return d
}

/** Half-width and height of a stub's arrowhead. */
const ARROW = 3

/**
 * SVG path for a cut edge: one row's worth of line, bending between node and lane, with an
 * arrowhead at the open end pointing toward the missing part (down when leaving, up when arriving).
 */
function stubPath(edge: Edge, x: (col: number) => number, y: (row: number) => number, bend: number): string {
  const { fromRow, fromCol, toRow, toCol, lane, cut } = edge
  const h = Math.min(y(toRow) - y(fromRow), bend)
  if (cut === 'out') {
    const y0 = y(fromRow)
    const yb = y0 + h / 2
    const ye = y0 + h * 0.8
    const x1 = x(lane)
    const d = lane === fromCol ? `M ${x1} ${y0}` : `M ${x(fromCol)} ${y0} C ${x(fromCol)} ${y0 + h / 4} ${x1} ${y0 + h / 4} ${x1} ${yb}`
    return `${d} L ${x1} ${ye} M ${x1 - ARROW} ${ye - ARROW} L ${x1} ${ye} L ${x1 + ARROW} ${ye - ARROW}`
  }
  const y2 = y(toRow)
  const yb = y2 - h / 2
  const ys = y2 - h * 0.8
  const x1 = x(lane)
  const end = lane === toCol ? `L ${x1} ${y2}` : `L ${x1} ${yb} C ${x1} ${y2 - h / 4} ${x(toCol)} ${y2 - h / 4} ${x(toCol)} ${y2}`
  return `M ${x1 - ARROW} ${ys + ARROW} L ${x1} ${ys} L ${x1 + ARROW} ${ys + ARROW} M ${x1} ${ys} ${end}`
}
