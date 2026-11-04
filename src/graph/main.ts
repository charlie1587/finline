// Finline graph panel: an isolated HTML frame that draws the commit graph in SVG beside the
// commit list. It talks to the worker with orca.plugin.request and refreshes when the worker
// posts `repo.changed` or Orca reports `workspace.changed`.
import { edgePath, layoutGraph } from '../layout.ts'
import type { Candidate, Commit, GraphLoad, Ref, RepoInfo } from '../types.ts'

// The frame's window.orca; typings are unavailable on this Orca install, so declare what we use.
interface Disposable {
  dispose(): void
}
interface FrameOrca {
  host: { call(method: string, params?: unknown): Promise<any> }
  plugin: {
    request(name: string, input?: unknown, options?: { timeoutMs?: number }): Promise<any>
    on(event: string, handler: (payload: any) => void): Disposable
  }
  on(event: string, handler: (payload: any) => void): Disposable
}
declare const orca: FrameOrca

const PAGE = 200
const ROW_H = 24
const COL_W = 14
const PAD_X = 10
const NODE_R = 4
const LANE_COLORS = 8
const PINS_KEY = 'finline.pins'
const MAX_PINS = 200

const $ = <T extends Element>(id: string) => document.getElementById(id) as unknown as T
const repoEl = $<HTMLElement>('repo')
const branchEl = $<HTMLElement>('branch')
const refreshEl = $<HTMLButtonElement>('refresh')
const messageEl = $<HTMLElement>('message')
const listEl = $<HTMLElement>('list')
const graphEl = $<SVGSVGElement>('graph')
const rowsEl = $<HTMLElement>('rows')
const moreEl = $<HTMLElement>('more')

let repo: RepoInfo | null = null
let commits: Commit[] = []
let hasMore = false
let selected: string | null = null
let seq = 0
let loading = false
let loadingMore = false

// ---- Pinning: which repo a workspace is, when name + branch match several ---------------------
// readContext has no workspace id, but terminal ids are unique, so the pin is keyed by them.

function readPins(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(PINS_KEY) ?? '{}') ?? {}
  } catch {
    return {}
  }
}

function writePins(pins: Record<string, string>): void {
  const keys = Object.keys(pins)
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_PINS))) delete pins[key]
  try {
    localStorage.setItem(PINS_KEY, JSON.stringify(pins))
  } catch {
    // Storage unavailable: the person picks again next time.
  }
}

async function terminalIds(): Promise<string[]> {
  try {
    const context = await orca.host.call('workspace.readContext', {})
    return context ? context.terminals.map((t: { id: string }) => t.id) : []
  } catch {
    return []
  }
}

let sessionPick: string | null = null

async function pinnedPath(): Promise<string | null> {
  const pins = readPins()
  for (const id of await terminalIds()) if (pins[id]) return pins[id]
  return sessionPick
}

async function pin(path: string): Promise<void> {
  const pins = readPins()
  for (const id of await terminalIds()) pins[id] = path
  writePins(pins)
}

// ---- Loading -------------------------------------------------------------------------------

async function request(input: { limit: number; skip: number }): Promise<GraphLoad> {
  const preferred = await pinnedPath()
  // The host refuses keys whose value is undefined, so add preferredPath only when set.
  return orca.plugin.request('graph.load', preferred ? { ...input, preferredPath: preferred } : input)
}

/** Reloads from the top, keeping as many commits as are already shown. */
async function refresh(): Promise<void> {
  const mine = ++seq
  setLoading(true)
  try {
    const result = await request({ skip: 0, limit: Math.max(PAGE, commits.length) })
    if (mine !== seq) return
    await apply(result, false)
  } catch (error) {
    if (mine === seq) showError(error)
  } finally {
    if (mine === seq) setLoading(false)
  }
}

async function loadMore(): Promise<void> {
  if (!hasMore || loading || loadingMore) return
  const mine = seq
  loadingMore = true
  moreEl.hidden = false
  try {
    const result = await request({ skip: commits.length, limit: PAGE })
    if (mine !== seq) return
    await apply(result, true)
  } catch (error) {
    if (mine === seq) showError(error)
  } finally {
    loadingMore = false
    moreEl.hidden = !hasMore
  }
}

async function apply(result: GraphLoad, append: boolean): Promise<void> {
  if (!result.ok) {
    repo = null
    commits = []
    hasMore = false
    renderList()
    if (result.reason === 'ambiguous') showPicker(result.message, result.candidates)
    else showMessage(result.reason === 'no-workspace' ? 'No workspace' : 'No repository', result.message)
    return
  }
  if (result.resolvedBy.startsWith('pinned')) await pin(result.repo.path) // new terminals inherit it
  const switched = repo?.path !== result.repo.path
  repo = result.repo
  commits = append ? commits.concat(result.commits) : result.commits
  hasMore = result.hasMore
  if (switched) {
    selected = null
    listEl.scrollTop = 0
  }
  hideMessage()
  renderHeader()
  renderList()
  // A short page may not fill the list; keep loading until it scrolls.
  queueMicrotask(maybeLoadMore)
}

function setLoading(on: boolean): void {
  loading = on
  refreshEl.disabled = on
  document.body.classList.toggle('loading', on)
}

// ---- Messages ------------------------------------------------------------------------------

function hideMessage(): void {
  messageEl.hidden = true
  messageEl.replaceChildren()
}

function showMessage(title: string, text: string, tone: 'neutral' | 'warning' | 'danger' = 'neutral'): void {
  renderHeader()
  messageEl.className = `message ${tone}`
  messageEl.replaceChildren(el('div', 'title', title), el('p', '', text))
  messageEl.hidden = false
}

function showError(error: unknown): void {
  const e = error as { code?: string; message?: string }
  showMessage('The worker did not answer', `${e.code ?? 'error'}: ${e.message ?? String(error)}`, 'danger')
}

function showPicker(text: string, candidates: Candidate[]): void {
  showMessage('Which repository is this workspace?', `${text} Pick it once; Finline remembers.`, 'warning')
  for (const candidate of candidates) {
    const button = el('button', '', candidate.name)
    button.type = 'button'
    button.append(el('small', '', candidate.path))
    button.addEventListener('click', async () => {
      sessionPick = candidate.path
      await pin(candidate.path)
      void refresh()
    })
    messageEl.append(button)
  }
}

// ---- Rendering -----------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  if (cls) node.className = cls
  if (text !== undefined) node.textContent = text
  return node
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag)
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value))
  return node
}

const laneColor = (i: number) => `var(--lane-${i % LANE_COLORS})`

function renderHeader(): void {
  repoEl.textContent = repo?.name ?? 'Finline'
  repoEl.title = repo?.path ?? ''
  branchEl.hidden = !repo?.branch
  branchEl.textContent = repo?.branch ?? ''
}

function renderList(): void {
  const layout = layoutGraph(commits)
  const graphWidth = PAD_X * 2 + Math.max(1, layout.width) * COL_W
  const x = (col: number) => PAD_X + col * COL_W + COL_W / 2
  const y = (row: number) => row * ROW_H + ROW_H / 2

  graphEl.setAttribute('width', String(graphWidth))
  graphEl.setAttribute('height', String(commits.length * ROW_H + (hasMore ? ROW_H : 0)))
  const paths = layout.edges.map((edge) =>
    svg('path', { d: edgePath(edge, x, y), stroke: laneColor(edge.color) })
  )
  const nodes = commits.map((commit, row) => {
    const isHead = commit.refs.some((r) => r.kind === 'head' || r.kind === 'detached')
    return svg('circle', {
      cx: x(layout.cols[row]),
      cy: y(row),
      r: isHead ? NODE_R + 1 : NODE_R,
      class: isHead ? 'head' : '',
      fill: laneColor(layout.colors[row]),
      stroke: laneColor(layout.colors[row])
    })
  })
  graphEl.replaceChildren(...paths, ...nodes)

  if (commits.length === 0) {
    rowsEl.replaceChildren(repo ? el('div', 'empty', 'No commits yet') : '')
    return
  }
  rowsEl.replaceChildren(...commits.map((commit, row) => renderRow(commit, graphWidth, layout.colors[row])))
}

function renderRow(commit: Commit, indent: number, color: number): HTMLElement {
  const isHead = commit.refs.some((r) => r.kind === 'head' || r.kind === 'detached')
  const row = el('div', isHead ? 'row head' : 'row')
  row.style.paddingLeft = `${indent}px`
  row.dataset.hash = commit.hash
  row.setAttribute('role', 'option')
  row.setAttribute('aria-selected', String(commit.hash === selected))
  row.title = `${commit.shortHash} · ${commit.author} · ${new Date(commit.authoredAt).toLocaleString()}\n${commit.subject}`
  row.append(...renderRefs(commit.refs, color))
  row.append(
    el('span', 'subject', commit.subject),
    el('span', 'author', commit.author),
    el('span', 'date', shortAge(commit.authoredAt)),
    el('span', 'hash', commit.shortHash)
  )
  return row
}

/** Local branches absorb their same-named remote copies on the same commit: `main · origin`. */
function renderRefs(refs: Ref[], color: number): HTMLElement[] {
  const remotes = refs.filter((r) => r.kind === 'remote')
  const absorbed = new Set<Ref>()
  const badges: HTMLElement[] = []
  const badge = (ref: Ref, cls: string, label: string, remoteNames: string[] = []) => {
    const node = el('span', `ref ${cls}`)
    node.style.color = laneColor(color)
    node.title = [ref.name, ...remoteNames.map((r) => `${r}/${ref.name}`)].join(', ')
    node.append(el('span', 'name', label))
    for (const remote of remoteNames) node.append(el('span', 'remote', remote))
    badges.push(node)
  }
  for (const ref of refs) {
    if (ref.kind === 'head' || ref.kind === 'branch') {
      const twins = remotes.filter((r) => r.name.endsWith(`/${ref.name}`))
      twins.forEach((t) => absorbed.add(t))
      badge(ref, ref.kind, ref.name, twins.map((t) => t.name.slice(0, -ref.name.length - 1)))
    } else if (ref.kind === 'detached') {
      badge(ref, 'head', 'HEAD')
    }
  }
  for (const ref of remotes) if (!absorbed.has(ref)) badge(ref, 'remote-only', ref.name)
  for (const ref of refs) if (ref.kind === 'tag') badge(ref, 'tag', ref.name)
  return badges
}

function shortAge(at: number): string {
  const s = Math.max(0, (Date.now() - at) / 1000)
  if (s < 60) return 'now'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h`
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`
  if (s < 86400 * 365) return `${Math.floor(s / (86400 * 30))}mo`
  return `${Math.floor(s / (86400 * 365))}y`
}

// ---- Interaction ---------------------------------------------------------------------------

function select(hash: string | null): void {
  selected = hash
  for (const row of rowsEl.children as HTMLCollectionOf<HTMLElement>) {
    row.setAttribute('aria-selected', String(row.dataset.hash === hash))
  }
}

function maybeLoadMore(): void {
  if (listEl.scrollTop + listEl.clientHeight >= listEl.scrollHeight - ROW_H * 10) void loadMore()
}

rowsEl.addEventListener('click', (event) => {
  const row = (event.target as Element).closest<HTMLElement>('.row')
  if (row?.dataset.hash) select(row.dataset.hash)
})

listEl.addEventListener('keydown', (event) => {
  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
  event.preventDefault()
  const index = commits.findIndex((c) => c.hash === selected)
  const next = Math.min(commits.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))
  if (!commits[next]) return
  select(commits[next].hash)
  rowsEl.children[next]?.scrollIntoView({ block: 'nearest' })
})

listEl.addEventListener('scroll', maybeLoadMore, { passive: true })
refreshEl.addEventListener('click', () => void refresh())

orca.plugin.on('repo.changed', () => void refresh())
// Fires when focus moves to another workspace (its first delivery on subscribe is not relied on).
orca.on('workspace.changed', () => {
  sessionPick = null
  void refresh()
})
void refresh()
