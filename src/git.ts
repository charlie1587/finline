// Thin wrapper over the system `git`, run with execFile (no shell) so paths with spaces and
// Windows drive letters pass through untouched.
import { execFile } from 'node:child_process'
import type { Commit } from './types'

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

export async function readCommits(cwd: string, limit: number, signal?: AbortSignal): Promise<Commit[]> {
  const out = await git(
    cwd,
    ['log', '--all', '--topo-order', `--max-count=${limit}`, `--format=${FORMAT}`],
    signal
  )
  return out
    .split(RECORD)
    .map((record) => record.replace(/^\n/, ''))
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
        refs: refs ? refs.split(', ') : []
      }
    })
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
