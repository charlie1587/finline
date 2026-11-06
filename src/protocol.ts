// Panel <-> worker contract, shared by the panel and src/worker.ts.
import type { DetailsLoad, GraphLoad } from './types'

declare module 'orca' {
  interface PluginRequests {
    /**
     * Resolves the focused workspace's repo and reads `limit` commits after `skip`.
     * `preferredPath` picks among workspaces that share a name and branch.
     */
    'graph.load': { input: { limit?: number; skip?: number; preferredPath?: string }; output: GraphLoad }
    /** Full message, author/committer and changed files of one commit in a repo `graph.load` returned. */
    'commit.details': { input: { path: string; hash: string }; output: DetailsLoad }
  }
  interface PluginPanelEvents {
    /** Posted when HEAD, refs or the index of the watched repo change. */
    'repo.changed': { path: string }
  }
}
