// Finline's worker: finds the focused workspace's repository, reads it with the system `git`
// and watches its git dir so open panels refresh on their own.
import { watch, type FSWatcher } from 'node:fs'
import { basename } from 'node:path'
import type { OrcaWorkerApi } from 'orca/worker'
import { currentBranch, gitDirs, gitVersion, readCommits } from './git'
import type { Candidate, GraphLoad } from './types'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 300
const DEBOUNCE_MS = 300
// Paths under the git dir whose change means the graph may have changed.
const RELEVANT =
  /^(HEAD|ORIG_HEAD|FETCH_HEAD|packed-refs|index|refs[\\/].*|worktrees[\\/][^\\/]+[\\/](HEAD|index))$/

type Resolved =
  | { ok: true; path: string; resolvedBy: string }
  | Exclude<GraphLoad, { ok: true } | { reason: 'git-failed' }>

const isLocal = (hostId: string | null) => hostId === null || hostId === 'local'
const samePath = (a: string, b: string) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

async function resolveRepo(orca: OrcaWorkerApi, preferredPath?: string): Promise<Resolved> {
  const context = await orca.host.call('workspace.readContext', {})
  if (!context) return { ok: false, reason: 'no-workspace', message: 'No workspace is focused.' }

  // readContext carries no id or path (host API 1.3), so match it against workspace.list.
  const { workspaces } = await orca.host.call('workspace.list', {})
  const matches = workspaces.filter(
    (w) => w.name === context.displayName && (w.branch ?? null) === (context.branch || null)
  )
  const local = matches.filter((w) => isLocal(w.hostId))

  if (local.length === 0) {
    return matches.length > 0
      ? { ok: false, reason: 'remote', message: `"${context.displayName}" is on a remote host, not supported yet.` }
      : { ok: false, reason: 'not-found', message: `No local workspace "${context.displayName}" on ${context.branch}.` }
  }
  if (local.length === 1) return { ok: true, path: local[0].path, resolvedBy: 'name+branch' }

  const pinned = preferredPath ? local.find((w) => samePath(w.path, preferredPath)) : undefined
  if (pinned) return { ok: true, path: pinned.path, resolvedBy: `pinned (1 of ${local.length})` }

  const candidates: Candidate[] = local.map((w) => ({ path: w.path, name: basename(w.path), branch: w.branch }))
  return {
    ok: false,
    reason: 'ambiguous',
    message: `${local.length} workspaces are named "${context.displayName}" on ${context.branch}.`,
    candidates
  }
}

let watcher: FSWatcher | null = null

export default function activate(orca: OrcaWorkerApi): void {
  let watchedPath: string | null = null
  let timer: ReturnType<typeof setTimeout> | null = null

  async function watchRepo(path: string): Promise<boolean> {
    if (watchedPath === path && watcher) return true
    watcher?.close()
    watcher = null
    watchedPath = path
    try {
      const { commonDir } = await gitDirs(path)
      // The common dir holds refs and, under worktrees/<name>, each worktree's HEAD and index.
      watcher = watch(commonDir, { recursive: true }, (_event, file) => {
        if (file && (!RELEVANT.test(String(file)) || String(file).endsWith('.lock'))) return
        if (timer) clearTimeout(timer)
        timer = setTimeout(() => {
          orca.log(`repo changed (${String(file)}), notifying panels`)
          orca.panels.post('repo.changed', { path })
        }, DEBOUNCE_MS)
      })
      watcher.on('error', (error) => orca.log(`watch error: ${error.message}`))
      orca.log(`watching ${commonDir}`)
      return true
    } catch (error) {
      watchedPath = null
      orca.log(`watch failed: ${(error as Error).message}`)
      return false
    }
  }

  orca.panels.handle('graph.load', async ({ limit, preferredPath }, { signal }): Promise<GraphLoad> => {
    const resolved = await resolveRepo(orca, preferredPath)
    if (!resolved.ok) return resolved
    const max = Math.min(Math.max(1, limit ?? DEFAULT_LIMIT), MAX_LIMIT)
    try {
      const [version, branch, commits] = await Promise.all([
        gitVersion(),
        currentBranch(resolved.path),
        readCommits(resolved.path, max, signal)
      ])
      const watching = await watchRepo(resolved.path)
      return {
        ok: true,
        repo: { path: resolved.path, name: basename(resolved.path), branch, gitVersion: version },
        commits,
        resolvedBy: resolved.resolvedBy,
        watching
      }
    } catch (error) {
      return { ok: false, reason: 'git-failed', message: (error as Error).message }
    }
  })
}

export function deactivate(): void {
  watcher?.close()
  watcher = null
}
