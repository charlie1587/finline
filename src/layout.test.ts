// node --test src/layout.test.ts   (Node >= 22.18 strips the types itself)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { layoutGraph, type LayoutCommit } from './layout.ts'

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
