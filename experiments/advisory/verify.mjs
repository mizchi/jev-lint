// Check the exact shipped wording against the answers and follow-ups in the frozen experiment.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRules, ruleTextHash } from '../../src/rules.ts'

const here = import.meta.dirname
const read = name => JSON.parse(readFileSync(join(here,name),'utf8'))
const records = ['fixtures-run.json','input-run.json'].map(read)
const load = file => {
  const result = loadRules(file)
  assert.deepEqual(result.errors, [])
  return result.rules
}
const rules = new Map(load(join(here,'../../rules/text')).map(r=>[r.id,r]))
const expected = new Map()
for (const [index,record] of records.entries()) {
  assert.equal(record.rules.length,5)
  for (const saved of record.rules) {
    const rule = rules.get(saved.id)
    assert.ok(rule && saved.category === 'advisory' && rule.category === 'advisory')
    assert.equal(saved.draft,ruleTextHash(rule))
    assert.equal(saved.at,rule.at)
    assert.ok(rule.nextCheck)
    assert.equal(saved.nextCheck,rule.nextCheck,'re-evaluate the changed next check for '+rule.id)
  }
  for (const answer of record.answers) {
    assert.ok(Number.isFinite(answer.value))
    const rule = rules.get(answer.rule)
    if (answer.value >= rule.at) expected.set((index?'input-':'fixtures-')+answer.file,rule.nextCheck)
  }
}
const tested = read('hints-after.json')
const [rubric] = load(join(here,'hint-review.yml'))
assert.equal(tested.rules[0].draft,ruleTextHash(rubric))
assert.equal(tested.rules[0].at,rubric.at)
assert.equal(tested.passes.length,3)
const expectedCases = new Set([...expected.keys()].filter(k=>k.startsWith('fixtures-') ||
  ['input-da824980e0039af62c8ad20c.lsp','input-ea4c5599d9f980390be10015.parnas'].includes(k)))
assert.equal(expectedCases.size,7)
for (const pass of tested.passes) {
  const pending = new Set([...expectedCases].flatMap(k=>[k+'-0.hintreview',k+'-1.hintreview']))
  for (const row of pass) {
    assert.ok(pending.delete(row.file),'duplicate or unexpected hint review: '+row.file)
    const positive = row.file.endsWith('-1.hintreview')
    const hint = positive ? expected.get(row.file.replace(/-1\.hintreview$/,'')) : 'Review the relevant code before making a change.'
    assert.equal(row.text.split('\nProposed next check\n').at(-1),hint)
    assert.ok(Number.isFinite(row.value))
    assert.equal(row.value>=rubric.at,positive,'hint review changed: '+row.file)
  }
  assert.equal(pending.size,0,'missing hint review')
}
console.log('Verified five advisory policies, seven rendered next checks and seven generic controls in three passes.')

for (const [repo,moduleJudgments,moduleHits] of [['crater',2862,58],['vlmkit',2178,9]]) {
  for (const [kind,total,hits] of [['modules',moduleJudgments,moduleHits],['history',40,0]]) {
    const pack = kind === 'history' ? 'git' : 'text'
    const run = read(repo+'-'+kind+'.json')
    const missing = new Set()
    const values = new Map()
    for (const saved of run.rules) {
      const [rule] = load(join(here,'../../rules',pack,saved.id))
      assert.equal(saved.category,'advisory')
      assert.equal(saved.draft,ruleTextHash(rule))
      assert.equal(saved.at,rule.at)
      // The full module runs preceded the second iteration of the Hyrum instruction.
      if (rule.id !== 'hyrum') assert.equal(saved.nextCheck,rule.nextCheck)
    }
    for (const row of run.answers) {
      const key = row.file+'#'+row.rule
      assert.ok(!values.has(key))
      values.set(key,row.value)
      if (row.value === null) missing.add(key)
    }
    if (repo === 'vlmkit' && kind === 'history') {
      assert.equal(missing.size,30)
      for (const row of read('vlmkit-history-retry.json').answers) {
        const key = row.file+'#'+row.rule
        assert.ok(missing.delete(key))
        values.set(key,row.value)
      }
    }
    assert.equal(missing.size,0)
    assert.equal(values.size,total)
    const scores = [...values.values()]
    assert.ok(scores.every(Number.isFinite))
    assert.equal(scores.filter(v=>v>=0.70).length,hits)
  }
}
