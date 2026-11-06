// Thin wrapper over the system `git`, run with execFile (no shell) so paths with spaces and
// Windows drive letters pass through untouched.
import { execFile } from 'node:child_process'
import type { Commit, CommitDetails, FileChange, FileStatus, Ref } from './types'

const FIELD = '\x1f'
const RECORD = '\x1e'
// hash, short hash, parents, author, author time (unix s), decorations, subject
const FORMAT = ['%H', '%h', '%P', '%an', '%at', '%D', '%s'].join('%x1f') + '%x1e'

export function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      ['-C', cwd, '-c', 'core.quotepath=off', '-c', 'color.ui=false', ...args],
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, windowsHide: true, signal },
      (error, stdout, stderr) => {
        if (error) reject(new Error((stderr || error.message).trim()))
        else resolve(stdout)
      }
    )
  })
}

export async function gitVersion(): Promise<string> {
  return (await git('.', ['--version'])).trim()
}

export async function remoteNames(cwd: string): Promise<string[]> {
  return (await git(cwd, ['remote'])).split(/\r?\n/).filter(Boolean)
}

/** Splits a `%D` decoration list into typed refs. */
export function parseRefs(decorations: string, remotes: readonly string[]): Ref[] {
  if (!decorations) return []
  return decorations.split(', ').flatMap((raw): Ref[] => {
    if (raw.startsWith('HEAD -> ')) return [{ name: raw.slice(8), kind: 'head' }]
    if (raw === 'HEAD') return [{ name: 'HEAD', kind: 'detached' }]
    if (raw.startsWith('tag: ')) return [{ name: raw.slice(5), kind: 'tag' }]
    // origin/HEAD only says which branch the remote considers default; skip it like Git GUIs do.
    if (remotes.some((r) => raw === `${r}/HEAD`)) return []
    if (remotes.some((r) => raw.startsWith(`${r}/`))) return [{ name: raw, kind: 'remote' }]
    return [{ name: raw, kind: 'branch' }]
  })
}

export async function readCommits(
  cwd: string,
  opts: { skip: number; limit: number; remotes: readonly string[] },
  signal?: AbortSignal
): Promise<Commit[]> {
  let out: string
  try {
    out = await git(
      cwd,
      ['log', '--all', '--topo-order', `--skip=${opts.skip}`, `--max-count=${opts.limit}`, `--format=${FORMAT}`],
      signal
    )
  } catch (error) {
    // A repo with no commits yet has nothing to log.
    if (/does not have any commits|bad default revision/i.test((error as Error).message)) return []
    throw error
  }
  return out
    .split(RECORD)
    .map((record) => record.replace(/^\r?\n/, ''))
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, shortHash, parents, author, at, refs, subject] = record.split(FIELD)
      return {
        hash,
        shortHash,
        parents: parents ? parents.split(' ') : [],
        author,
        authoredAt: Number(at) * 1000,
        subject,
        refs: parseRefs(refs, opts.remotes)
      }
    })
}

// hash, parents, author name/email/time, committer name/email/time, then the raw message last
// (it may contain anything, so everything after the 8th separator is the message).
const DETAILS_FORMAT = ['%H', '%P', '%an', '%ae', '%at', '%cn', '%ce', '%ct', '%B'].join('%x1f')
const STATUSES = new Set<string>(['A', 'M', 'D', 'R', 'C', 'T', 'U', 'X'])

/**
 * Parses `git diff-tree -r -z --raw --numstat` output: every raw record first
 * (`:modes shas status\0path\0[dst\0]`), then the numstat records in the same order
 * (`added\tdeleted\tpath\0` or, for renames, `added\tdeleted\t\0src\0dst\0`).
 */
export function parseDiffTree(out: string): FileChange[] {
  const tokens = out.split('\0')
  const files: FileChange[] = []
  const stats: Array<[number | null, number | null]> = []
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i++]
    if (token === '') continue
    if (token.startsWith(':')) {
      const code = token.slice(1).split(' ')[4] ?? 'X'
      const letter = code[0]
      const status = (STATUSES.has(letter) ? letter : 'X') as FileStatus
      const first = tokens[i++]
      if (status === 'R' || status === 'C') files.push({ status, from: first, path: tokens[i++], added: null, deleted: null })
      else files.push({ status, path: first, added: null, deleted: null })
      continue
    }
    const [added, deleted, path] = token.split('\t')
    if (path === '') i += 2 // rename: source and destination follow as their own tokens
    const count = (n: string) => (n === '-' ? null : Number(n))
    stats.push([count(added), count(deleted)])
  }
  stats.forEach(([added, deleted], n) => {
    if (files[n]) Object.assign(files[n], { added, deleted })
  })
  return files
}

export async function readCommitDetails(
  cwd: string,
  hash: string,
  maxFiles: number,
  signal?: AbortSignal
): Promise<CommitDetails> {
  const out = await git(cwd, ['show', '-s', '--no-show-signature', `--format=${DETAILS_FORMAT}`, hash], signal)
  const fields = out.split(FIELD)
  const [full, parents, author, authorEmail, at, committer, committerEmail, ct] = fields
  const parentList = parents ? parents.split(' ') : []
  const comparedTo = parentList[0] ?? null
  // Merges are compared with their first parent, the root commit with the empty tree.
  const range = comparedTo ? [comparedTo, full] : ['--root', full]
  const diff = await git(cwd, ['diff-tree', '-r', '-z', '-M', '--raw', '--numstat', '--no-commit-id', ...range], signal)
  const files = parseDiffTree(diff)
  return {
    hash: full,
    parents: parentList,
    author,
    authorEmail,
    authoredAt: Number(at) * 1000,
    committer,
    committerEmail,
    committedAt: Number(ct) * 1000,
    message: fields.slice(8).join(FIELD).replace(/\s+$/, ''),
    comparedTo,
    files: files.slice(0, maxFiles),
    filesTruncated: files.length > maxFiles
  }
}

/** The worktree's own git dir (HEAD, index) and the shared one (refs, packed-refs). */
export async function gitDirs(cwd: string): Promise<{ gitDir: string; commonDir: string }> {
  const out = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir'])
  const [gitDir, commonDir] = out.trim().split(/\r?\n/)
  return { gitDir, commonDir }
}

export async function currentBranch(cwd: string): Promise<string | null> {
  const out = (await git(cwd, ['branch', '--show-current'])).trim()
  return out.length > 0 ? out : null
}
