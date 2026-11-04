<p align="center">
  <img src="assets/icon.png" alt="Finline logo: an orca's fin drawn as three graph lanes" width="128" height="128">
</p>

<h1 align="center">Finline</h1>

<p align="center">
  A git graph for <a href="https://onorca.dev">Orca</a>: the commits of the focused worktree in
  colored lanes, with branches, tags and remotes, in Orca's right sidebar.
</p>

<p align="center"><em>fin</em> (an orca's fin) + <em>line</em> (the lanes of the graph).</p>

![The Finline panel showing colored lanes for main, feature branches, a hotfix and their merges, with branch, remote and tag badges](assets/screenshot-graph.png)

![The Finline panel at sidebar width, showing the graph, refs, commit subjects and ages](assets/screenshot-sidebar.png)

## Features

- Commit graph drawn in SVG: one lane per branch, merges and forks as curves, HEAD as a hollow node.
- Ref badges: local branches together with their remote copy (`main · origin`), remote-only
  branches in italics, tags with a dashed border.
- Follows the focused Orca workspace and refreshes by itself when HEAD, branches, tags or the
  index change, from Orca, a terminal or an agent.
- Loads 200 commits at a time as you scroll.
- Fits the narrow sidebar: author and hash columns appear only when there is room.

Finline 0.1 is read-only. Commit details, diffs and actions (checkout, merge, rebase, cherry-pick,
branches and tags) are planned.

## Install

In Orca, open **Settings → Plugins**, search for **Finline** and install it. Then open the
**Finline** tab in the right sidebar.

Requires Orca 1.4.248 or later and `git` on your `PATH`.

## Access it asks for

Finline is a **full-access** plugin (`trusted-worker`): Orca asks you to approve it on install.

- **Runs a worker process** that calls your system `git` (`git log`, `git rev-parse`,
  `git branch`, `git remote`) in the focused workspace's folder, and watches that repository's
  `.git` folder for changes. It only reads; it never writes to your repository.
- **`workspace:read`**: reads the focused workspace's name and branch, and the list of workspaces,
  to find which repository to show.

Finline makes no network requests and collects no data.

## Known limitations

- Orca does not yet tell plugins the focused workspace's folder, so Finline matches it by name and
  branch. When two workspaces share both (for example two worktrees on `develop`), Finline asks you
  once which repository it is.
- Workspaces on remote (SSH) hosts are not supported yet.

## Development

```sh
orca plugin dev watch .                # load this folder into Orca and stream its logs
node --test src/layout.test.ts         # lane layout tests (Node >= 22.18)
orca plugin validate .                 # the catalog's manifest checks
```

- `src/worker.ts` (worker): resolves the repository, runs `git`, watches `.git`.
- `src/layout.ts`: assigns lanes and routes edges; pure, with tests.
- `src/graph/` (html panel): draws the graph and the commit list.

To try the panel on another repository, put its path in `.orca/dev-repo.txt` (git-ignored). The
worker then shows that repository instead of the focused workspace.

Notes from the first prototype are in [docs/prototype-findings.md](docs/prototype-findings.md).

## License

[MIT](LICENSE) © 2026 Denni Bevilacqua
