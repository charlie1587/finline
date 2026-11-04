// Panel <-> worker contract, shared by the panel and src/worker.ts.
import type { GraphLoad } from './types'

declare module 'orca' {
  interface PluginRequests {
    /**
     * Resolves the focused workspace's repo and reads `limit` commits after `skip`.
     * `preferredPath` picks among workspaces that share a name and branch.
     */
    'graph.load': { input: { limit?: number; skip?: number; preferredPath?: string }; output: GraphLoad }
  }
  interface PluginPanelEvents {
    /** Posted when HEAD, refs or the index of the watched repo change. */
    'repo.changed': { path: string }
  }
}
