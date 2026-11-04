# Prototype findings (2026-11-04, Orca 1.4.248, Windows 11)

What the first prototype (worker + components panel listing the latest commits) established.

## The five unknowns from the handoff

1. **`child_process` in the worker: yes.** `execFile('git', …)` from `node:child_process` works in a
   `trusted-worker` (Node 22, `git 2.42.0.windows.2`). No shell is involved, so Windows paths pass through untouched.
2. **Active repo path: partly.** `workspace.readContext` (and the `workspace.changed` payload) give
   only `branch`, `displayName` and terminal ids, with no path and no workspace id. `workspace.list` (worker only)
   has `path`, so the worker matches on name + branch. In a worktree workspace the name is the branch, so two
   repos both on `develop` are indistinguishable. Workaround: the panel asks once and keeps the
   choice in an atom with `persist: 'workspace'`, which Orca keys per workspace. Worth an upstream
   request: add `workspaceId`/`path` to `readContext`.
   Local workspaces report `hostId: "local"`, not `null` as the reference implies.
3. **UI placement: right sidebar, about 350px wide.** Components panels have no SVG or canvas, so the
   real graph needs a `ui: "html"` panel (an isolated frame, with SVG or canvas allowed). The commit table fits; author, date
   and hash columns drop out (`hideBelow`) at this width.
4. **Diff: no host API.** `commands.run` only toggles sidebars and history, with no diff action.
   `editor.open` opens a workspace file but not a diff. Plan: render diffs ourselves in the panel.
5. **Auto-refresh: yes.** `fs.watch(commonDir, { recursive: true })` fires on Windows for
   `refs\heads`, `refs\tags`, `HEAD` and `index`. Debounced 300 ms, with `.lock` files ignored. Branch and tag changes reached the
   open panel without a manual refresh.

## Orca quirks met along the way

- `orca plugin types` / `create` / `check` fail on this install: `orca.d.ts` is missing from
  `resources/plugins/declarative`, and the test resolver refuses `./orca-runtime.mjs`. So there are no typings or
  `orca plugin test` yet. `dev load`, `dev request`, `shot` and `logs` work.
- A components panel does **not** get the documented first `workspace.changed` delivery on
  subscribe, so `setup` must load explicitly.
- `plugin.request` input is strict JSON: a key whose value is `undefined` fails with `invalid_params`.
- `orca plugin shot --act` needs Orca's window hidden or minimized.
