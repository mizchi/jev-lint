// Check every pass, including the predeclared bytes margin. The general eval
// replay also assesses whether a corpus is sensitive to small cutoff changes.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parse } from 'yaml'

const [suite, ...records] = process.argv.slice(2)
assert.ok(suite && records.length, 'usage: node check.mjs <suite directory> <record.json>...')
const expected = parse(readFileSync(join(suite, 'expect.yml'), 'utf8'))
delete expected.default
const fixtures = Object.keys(expected).sort()
for (const file of records) {
  const record = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(record.model, 'jev-1.14.0')
  assert.deepEqual(record.rules, [{ id: 'entry-layout-obscures-workflow', draft: 'fa510dace70d', at: 0.68 }])
  assert.equal(record.passes.length, 7)
  let margin = 1
  for (const pass of record.passes) {
    const seen = []
    for (const answer of pass) {
      const key = answer.file.slice(answer.file.indexOf('fixtures/'))
      seen.push(key)
      assert.equal(answer.rule, record.rules[0].id)
      assert.ok(Number.isFinite(answer.value) && answer.value >= 0 && answer.value <= 1)
      const [label] = expected[key]
      assert.equal(answer.line, label.line)
      assert.equal(answer.value >= 0.68, label.label === 'bad', file + ': ' + key)
      margin = Math.min(margin, Math.abs(answer.value - 0.68))
    }
    assert.deepEqual(seen.sort(), fixtures)
  }
  if (record.suite === 'bytes') assert.ok(margin >= 0.10 - Number.EPSILON, 'bytes margin below 0.10')
  console.log(file + ' passed (' + fixtures.length + ' fixtures × 7, minimum margin ' + margin.toFixed(2) + ')')
}
