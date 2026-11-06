import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDiffTree, parseStatus } from './git.ts'

const Z = '0000000000000000000000000000000000000000'
const raw = (status: string) => `:100644 100644 ${Z} ${Z} ${status}`

test('pairs raw records with numstat, including renames and binaries', () => {
  const out = [
    raw('A'), 'added.txt',
    raw('M'), 'bin.dat',
    raw('R087'), 'old.txt', 'new.txt',
    '1\t0\tadded.txt',
    '-\t-\tbin.dat',
    '1\t0\t', 'old.txt', 'new.txt',
    ''
  ].join('\0')
  assert.deepEqual(parseDiffTree(out), [
    { status: 'A', path: 'added.txt', added: 1, deleted: 0 },
    { status: 'M', path: 'bin.dat', added: null, deleted: null },
    { status: 'R', from: 'old.txt', path: 'new.txt', added: 1, deleted: 0 }
  ])
})

test('keeps paths with tabs and spaces whole', () => {
  const out = [raw('D'), 'dir with space/a\tb.txt', '0\t3\tdir with space/a\tb.txt', ''].join('\0')
  assert.deepEqual(parseDiffTree(out), [{ status: 'D', path: 'dir with space/a\tb.txt', added: 0, deleted: 3 }])
})

test('an empty diff has no files', () => {
  assert.deepEqual(parseDiffTree(''), [])
})

test('status counts staged, unstaged, untracked and conflicted paths', () => {
  const Z = '0000000000000000000000000000000000000000'
  const out = [
    '# branch.oid abc', '# branch.head feat', '# branch.upstream origin/feat', '# branch.ab +2 -3',
    `1 M. N... 100644 100644 100644 ${Z} ${Z} staged.txt`,
    `1 .M N... 100644 100644 100644 ${Z} ${Z} unstaged.txt`,
    `1 MM N... 100644 100644 100644 ${Z} ${Z} both.txt`,
    `2 R. N... 100644 100644 100644 ${Z} ${Z} R100 new.txt`, 'old.txt',
    `u UU N... 100644 100644 100644 100644 ${Z} ${Z} ${Z} conflict.txt`,
    '? untracked.txt',
    ''
  ].join('\0')
  assert.deepEqual(parseStatus(out), {
    branch: 'feat', head: 'abc', upstream: 'origin/feat', ahead: 2, behind: 3,
    staged: 3, unstaged: 2, untracked: 1, conflicts: 1
  })
  const detached = parseStatus(['# branch.oid abc', '# branch.head (detached)', ''].join('\0'))
  assert.equal(detached.branch, null)
  assert.equal(detached.upstream, null)
})
