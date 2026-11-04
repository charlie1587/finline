// Finline panel (prototype): the focused workspace's latest commits, refreshed when the
// workspace changes or the worker sees the repo's refs move.
import {
  atom,
  Badge,
  Button,
  Callout,
  Collapsible,
  EmptyState,
  IconButton,
  KeyValue,
  on,
  plugin,
  read,
  Row,
  set,
  Skeleton,
  Stack,
  Table,
  Text,
  type PanelContext
} from 'orca'
import type { Commit, GraphLoad } from './types'

const LIMIT = 50

const state = atom<GraphLoad | null>(null)
const loading = atom(false)
const error = atom<string | null>(null)
/**
 * The repo chosen for this Orca workspace when its name and branch match several workspaces.
 * `persist: 'workspace'` keeps one value per workspace and swaps it when focus moves.
 */
const pinnedPath = atom<string | null>('pinnedPath', null, { persist: 'workspace' })

async function load(): Promise<void> {
  set(loading, true)
  try {
    // The host refuses an input key whose value is undefined (not JSON), so leave it out.
    const preferredPath = read(pinnedPath)
    const input = preferredPath ? { limit: LIMIT, preferredPath } : { limit: LIMIT }
    set(state, await plugin.request('graph.load', input))
    set(error, null)
  } catch (e) {
    const err = e as { code?: string; message?: string }
    set(error, `${err.code ?? 'error'}: ${err.message ?? String(e)}`)
  } finally {
    set(loading, false)
  }
}

function pick(path: string | null): void {
  set(pinnedPath, path)
  set(state, null)
  void load()
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('repo.changed', () => void load()))
  // Documented to fire once on subscribe, but in 1.4.248 a components panel does not get that
  // first delivery, so load explicitly as well.
  ctx.subscriptions.push(on('workspace.changed', () => void load()))
  void load()
}

function shortRef(ref: string): string {
  return ref.replace(/^HEAD -> /, '→ ').replace(/^tag: /, '# ')
}

function subjectCell(commit: Commit): string {
  return commit.refs.length > 0 ? `[${commit.refs.map(shortRef).join(', ')}] ${commit.subject}` : commit.subject
}

export default function Panel() {
  const data = read(state)
  const busy = read(loading)
  const failure = read(error)
  const pinned = read(pinnedPath)

  const header = (
    <Row justify="between">
      <Text weight="semibold" truncate>
        {data?.ok ? data.repo.name : 'Finline'}
      </Text>
      <Row gap="xs">
        {data?.ok && data.repo.branch ? <Badge tone="accent">{data.repo.branch}</Badge> : null}
        <IconButton icon="refresh" label="Refresh" variant="ghost" size="sm" disabled={busy} onPress={load} />
      </Row>
    </Row>
  )

  if (failure) {
    return (
      <Stack gap="md">
        {header}
        <Callout tone="danger" title="The worker did not answer">
          <Text>{failure}</Text>
        </Callout>
      </Stack>
    )
  }

  if (!data) {
    return (
      <Stack gap="md">
        {header}
        <Skeleton shape="text" lines={6} label="Loading commits" />
      </Stack>
    )
  }

  if (!data.ok && data.reason === 'ambiguous') {
    return (
      <Stack gap="md">
        {header}
        <Callout tone="warning" title="Which repository is this workspace?">
          <Text>{data.message} Orca does not tell plugins which one is focused yet; pick it once.</Text>
        </Callout>
        <Stack gap="xs">
          {data.candidates.map((candidate) => (
            <Button key={candidate.path} variant="outline" onPress={() => pick(candidate.path)}>
              {candidate.name} — {candidate.path}
            </Button>
          ))}
        </Stack>
      </Stack>
    )
  }

  if (!data.ok) {
    return (
      <Stack gap="md">
        {header}
        <EmptyState
          title={data.reason === 'no-workspace' ? 'No workspace' : 'No repository'}
          description={data.message}
          icon="branch"
        />
      </Stack>
    )
  }

  return (
    <Stack gap="sm">
      {header}
      <Table
        label="Commits"
        maxHeight="lg"
        emptyText="No commits yet"
        loading={busy}
        columns={[
          { key: 'subject', label: 'Commit', minWidth: 'md' },
          { key: 'author', label: 'Author', hideBelow: 'md' },
          { key: 'date', label: 'Date', hideBelow: 'sm' },
          { key: 'hash', label: 'Hash', hideBelow: 'sm' }
        ]}
        rows={data.commits.map((commit) => ({
          key: commit.hash,
          cells: {
            subject: subjectCell(commit),
            author: commit.author,
            date: { type: 'relative', at: commit.authoredAt, format: 'short' },
            hash: commit.shortHash
          }
        }))}
      />
      <Collapsible title="Diagnostics">
        <Stack gap="sm">
          <KeyValue
            label="Prototype diagnostics"
            items={[
              { label: 'Path', value: data.repo.path, code: true },
              { label: 'Resolved by', value: data.resolvedBy },
              { label: 'git', value: data.repo.gitVersion },
              {
                label: 'Watching .git',
                value: data.watching ? 'yes' : 'no',
                tone: data.watching ? 'success' : 'warning'
              },
              { label: 'Commits', value: String(data.commits.length) }
            ]}
          />
          {pinned ? (
            <Button variant="ghost" size="sm" onPress={() => pick(null)}>
              Forget the chosen repository
            </Button>
          ) : null}
        </Stack>
      </Collapsible>
    </Stack>
  )
}
