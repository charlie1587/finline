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
