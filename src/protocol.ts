// Panel <-> worker contract, shared by src/panel.tsx and src/worker.ts.
import type { GraphLoad } from './types'

declare module 'orca' {
  interface PluginRequests {
    /** Resolves the focused workspace's repo and reads its latest commits. */
    'graph.load': { input: { limit?: number; preferredPath?: string }; output: GraphLoad }
  }
  interface PluginPanelEvents {
    /** Posted when HEAD, refs or the index of the watched repo change. */
    'repo.changed': { path: string }
  }
}
