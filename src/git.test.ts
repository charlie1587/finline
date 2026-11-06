import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseDiffTree } from './git.ts'

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
