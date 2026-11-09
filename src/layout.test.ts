// node --test src/layout.test.ts   (Node >= 22.18 strips the types itself)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { edgePath, layoutGraph, type LayoutCommit } from './layout.ts'

const c = (hash: string, ...parents: string[]): LayoutCommit => ({ hash, parents })

test('a straight line stays in lane 0', () => {
  const layout = layoutGraph([c('c', 'b'), c('b', 'a'), c('a')])
  assert.deepEqual(layout.cols, [0, 0, 0])
  assert.equal(layout.width, 1)
  assert.equal(layout.edges.length, 2)
})

test('a merge opens a lane for the second parent and closes it at the fork point', () => {
  //  m        m = merge(a2, b1)
  //  |\
  //  | b1
  //  a2 |
  //  |/
  //  base
  const layout = layoutGraph([c('m', 'a2', 'b1'), c('b1', 'base'), c('a2', 'base'), c('base')])
  assert.deepEqual(layout.cols, [0, 1, 0, 0])
  assert.equal(layout.width, 2)
  const intoBase = layout.edges.filter((e) => e.toRow === 3)
  assert.equal(intoBase.length, 2)
  assert.ok(intoBase.every((e) => e.toCol === 0))
  // The second branch keeps its own colour.
  assert.notEqual(layout.colors[1], layout.colors[0])
})

test('two branch tips get separate lanes and meet at their common parent', () => {
  const layout = layoutGraph([c('x', 'base'), c('y', 'base'), c('base')])
  assert.deepEqual(layout.cols, [0, 1, 0])
  assert.equal(layout.edges.filter((e) => e.toRow === 2).length, 2)
})

test('a parent past the loaded page runs off the bottom in its lane', () => {
  const layout = layoutGraph([c('b', 'a')])
  assert.deepEqual(layout.edges, [{ fromRow: 0, fromCol: 0, toRow: 1, toCol: 0, lane: 0, color: 0 }])
})

test('freed lanes are reused', () => {
  // t1 tip on lane 0; t2 tip joins later; after their merge-point the lane frees up for t3.
  const layout = layoutGraph([c('t1', 'p'), c('t2', 'p'), c('p', 'q'), c('t3', 'q'), c('q')])
  assert.deepEqual(layout.cols, [0, 1, 0, 1, 0])
  assert.equal(layout.width, 2)
})

test('a bend across an expanded row stays one row tall, at the node it leaves or reaches', () => {
  const x = (col: number) => col * 10
  // Rows 0 and 1 are 24px apart; a 100px details pane sits between rows 1 and 2.
  const y = (row: number) => row * 24 + (row > 1 ? 100 : 0)
  const leaving = { fromRow: 1, fromCol: 0, toRow: 3, toCol: 0, lane: 1, color: 0 }
  // Leaves row 1 (y 24), bends to lane 1 by y 48, runs straight through the pane to row 2 (y 148),
  // then bends back into the parent at row 3 (y 172).
  assert.equal(
    edgePath(leaving, x, y, 24),
    'M 0 24 C 0 36 10 36 10 48 L 10 148 C 10 160 0 160 0 172'
  )
  const arriving = { fromRow: 0, fromCol: 0, toRow: 2, toCol: 0, lane: 1, color: 0 }
  // Bends out by row 1 (y 24), runs straight to 24px above the parent at row 2 (y 148), bends in.
  assert.equal(
    edgePath(arriving, x, y, 24),
    'M 0 0 C 0 12 10 12 10 24 L 10 124 C 10 136 0 136 0 148'
  )
  // Without a bend limit the old shape comes back: the curve spans the whole gap.
  assert.equal(edgePath(arriving, x, y), 'M 0 0 C 0 12 10 12 10 24 C 10 86 0 86 0 148')
})

test('a long merge edge is cut into two stubs that hold no lane in between', () => {
  // m merges far; f fills the rows between on the first-parent line; side is the merged parent.
  const filler = Array.from({ length: 5 }, (_, i) => c(`f${i}`, i < 4 ? `f${i + 1}` : 'side'))
  const layout = layoutGraph([c('m', 'f0', 'side'), ...filler, c('side')], 3)
  const out = layout.edges.find((e) => e.cut === 'out')
  const into = layout.edges.find((e) => e.cut === 'in')
  assert.deepEqual(out, { fromRow: 0, fromCol: 0, toRow: 1, toCol: 1, lane: 1, color: 1, cut: 'out' })
  assert.deepEqual(into, { fromRow: 5, fromCol: 1, toRow: 6, toCol: 0, lane: 1, color: 1, cut: 'in' })
  // Lane 1 is free between the stubs: a tip there would take it.
  assert.equal(layout.width, 2)
})

test('long merge edges free their lanes, so a run of them does not grow a staircase', () => {
  // Ten merges in a row, each pulling in a commit on another line far below.
  const merges = Array.from({ length: 10 }, (_, i) => c(`m${i}`, i < 9 ? `m${i + 1}` : 'base', `d${i}`))
  const filler = Array.from({ length: 60 }, (_, i) => c(`x${i}`, i < 59 ? `x${i + 1}` : 'base'))
  const side = Array.from({ length: 10 }, (_, i) => c(`d${i}`, i < 9 ? `d${i + 1}` : 'base'))
  const commits = [...merges, ...filler, ...side, c('base')]
  assert.equal(layoutGraph(commits, Infinity).width, 12)
  assert.equal(layoutGraph(commits).width, 4)
})

test('a merge parent past the loaded page is cut only once the gap is already long', () => {
  assert.equal(layoutGraph([c('m', 'a', 'far'), c('a')], 3).edges.some((e) => e.cut), false)
  const filler = Array.from({ length: 4 }, (_, i) => c(`a${i}`, `a${i + 1}`))
  const layout = layoutGraph([c('m', 'a0', 'far'), ...filler], 3)
  assert.deepEqual(layout.edges.filter((e) => e.cut).map((e) => e.cut), ['out'])
})

test('stubs draw one row with an arrowhead at the open end', () => {
  const x = (col: number) => col * 10
  const y = (row: number) => row * 20
  const out = { fromRow: 0, fromCol: 0, toRow: 1, toCol: 1, lane: 1, color: 0, cut: 'out' as const }
  assert.equal(edgePath(out, x, y, 20), 'M 0 0 C 0 5 10 5 10 10 L 10 16 M 7 13 L 10 16 L 13 13')
  const into = { fromRow: 4, fromCol: 1, toRow: 5, toCol: 0, lane: 1, color: 0, cut: 'in' as const }
  assert.equal(edgePath(into, x, y, 20), 'M 7 87 L 10 84 L 13 87 M 10 84 L 10 90 C 10 95 0 95 0 100')
})
