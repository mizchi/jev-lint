// Pair the reported investigation with a generic control on the same evidence.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadRules, ruleTextHash } from '../../../src/rules.ts'

const here = import.meta.dirname
const ruleDir = join(here, '../../../rules/text/public-api-surface')
const [rule] = loadRules(ruleDir).rules
const [surfaces, output] = process.argv.slice(2)
const run = JSON.parse(readFileSync(join(here, 'scores.json'), 'utf8'))
assert.equal(run.rules[0].nextCheck, rule.nextCheck)
assert.equal(run.rules[0].draft, ruleTextHash(rule))
assert.equal(run.rules[0].at, rule.at)
const manifest = readFileSync(join(here, 'inputs.sha256'), 'utf8').trim().split('\n').map(line => line.slice(66))
assert.deepEqual(run.answers.map(a => a.file).sort(), manifest.sort())
for (const row of run.answers) assert.ok(Number.isFinite(row.value) && row.value >= 0 && row.value <= 4)
const cases = [
  ['ledger', join(ruleDir, 'fixtures/1-ledger.ts.apisurface')],
  ['queue', join(ruleDir, 'fixtures/5-queue.apisurface')],
  ...run.answers.filter(row => row.value >= rule.at).map(row => [row.file.replaceAll('/', '-'), join(surfaces ?? '.', row.file)]),
]
const bindings = JSON.parse(readFileSync(join(here, 'binding-scores.json'), 'utf8'))
const inputs = readFileSync(join(here, 'bindings.sha256'), 'utf8').trim().split('\n').map(line => line.slice(66))
for (const recorded of bindings.rules) {
  const dir = join(ruleDir, '..', recorded.id)
  const [policy] = loadRules(dir).rules
  assert.equal(recorded.draft, ruleTextHash(policy))
  assert.equal(recorded.nextCheck, policy.nextCheck)
  assert.equal(recorded.at, policy.at)
  const answers = bindings.answers.filter(row => row.rule === policy.id)
  assert.deepEqual(answers.map(row => row.file).sort(), inputs.filter(file => file.endsWith('.' + policy.extensions[0])).sort())
  for (const row of answers) assert.ok(Number.isFinite(row.value))
  if (policy.id === 'public-api-surface') continue
  const fixture = policy.id === 'api-use-is-unclear' ? 'generic' : 'cursor'
  cases.push([policy.id, join(dir, 'fixtures', fixture + '.apibinding'), policy])
}
if (surfaces === '--verify') {
  const hints = JSON.parse(readFileSync(join(here, 'hint-scores.json'), 'utf8'))
  const [judge] = loadRules(join(here, '../hint-review.yml')).rules
  assert.equal(hints.rules[0].draft, ruleTextHash(judge))
  const expected = new Set(cases.flatMap(([name]) => ['specific', 'generic'].map(label => name + '-' + label + '.hintreview')))
  for (const answer of hints.answers) {
    assert.ok(expected.delete(answer.file) && Number.isFinite(answer.value))
    assert.equal(answer.value >= judge.at, answer.file.endsWith('-specific.hintreview'))
  }
  assert.equal(expected.size, 0)
  console.log('Verified public API scores and paired investigations.')
  process.exit(0)
}
mkdirSync(output)
for (const [name, path, policy = rule] of cases) {
  const text = readFileSync(path, 'utf8')
  for (const [label, hint] of [['specific', policy.nextCheck], ['generic', 'Review the relevant code before making a change.']]) {
    writeFileSync(join(output, name + '-' + label + '.hintreview'), policy.ask + '\nEvidence\n' + text + '\nProposed next check\n' + hint)
  }
}
