// Data shapes shared by the worker and the panel.

export type RefKind = 'head' | 'branch' | 'remote' | 'tag' | 'detached'

export interface Ref {
  /** Display name: "main", "origin/main", "v1.0"; "HEAD" when detached. */
  name: string
  kind: RefKind
}

export interface Commit {
  hash: string
  shortHash: string
  parents: string[]
  author: string
  /** ms since the epoch */
  authoredAt: number
  subject: string
  refs: Ref[]
}

/** git's status letters: added, modified, deleted, renamed, copied, type changed, unmerged, unknown. */
export type FileStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U' | 'X'

export interface FileChange {
  status: FileStatus
  path: string
  /** Source path of a rename or copy. */
  from?: string
  /** Line counts; null for binary files. */
  added: number | null
  deleted: number | null
}

export interface CommitDetails {
  hash: string
  parents: string[]
  author: string
  authorEmail: string
  /** ms since the epoch */
  authoredAt: number
  committer: string
  committerEmail: string
  committedAt: number
  /** Full raw message: subject, blank line, body. */
  message: string
  /** What `files` is compared against: the first parent, or null for a root commit. */
  comparedTo: string | null
  files: FileChange[]
  /** More files changed than were sent. */
  filesTruncated: boolean
}

export type DetailsLoad = { ok: true; details: CommitDetails } | { ok: false; message: string }

export interface Candidate {
  path: string
  name: string
  branch: string | null
}

export interface RepoInfo {
  path: string
  name: string
  branch: string | null
  gitVersion: string
}

export type GraphLoad =
  | {
      ok: true
      repo: RepoInfo
      /** Commits `skip` .. `skip + commits.length` of `git log --all --topo-order`. */
      commits: Commit[]
      skip: number
      hasMore: boolean
      /** How the repo path was found, for diagnostics. */
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
