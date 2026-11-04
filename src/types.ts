// Data shapes shared by the worker and the panel.

export interface Commit {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  /** ms since the epoch */
  authoredAt: number
  subject: string
  /** Decorations from %D, e.g. ["HEAD -> main", "origin/main", "tag: v1"] */
  refs: string[]
}

export interface Candidate {
  path: string
  name: string
  branch: string | null
}

export type GraphLoad =
  | {
      ok: true
      repo: { path: string; name: string; branch: string | null; gitVersion: string }
      commits: Commit[]
      /** How the repo path was found, for the prototype's diagnostics. */
      resolvedBy: string
      watching: boolean
    }
  | {
      ok: false
      reason: 'no-workspace' | 'not-found' | 'remote' | 'git-failed'
      message: string
    }
  | {
      /** readContext has no path or id: several workspaces share its name and branch. */
      ok: false
      reason: 'ambiguous'
      message: string
      candidates: Candidate[]
    }
