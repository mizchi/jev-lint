// Render the reported instruction using the same gate as check or replay.
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { loadRules, ruleTextHash } from '../../src/rules.ts'
import { decide } from '../../src/gate.ts'

const here = import.meta.dirname
const json = name => JSON.parse(readFileSync(join(here,name+'.json'),'utf8'))
const suites = json('module-case-review').passes[0].map(row => JSON.parse(row.text))
const rows = []
for (const suite of suites) {
  const kind = suite.rule.subject === 'commit' ? 'git' : 'text'
  const dir = join(here,'../../rules',kind,suite.rule.id)
  const [rule] = loadRules(dir).rules
  const baseline = JSON.parse(readFileSync(join(dir,'baseline.json'),'utf8'))
  assert.equal(suite.rule.questionHash,ruleTextHash(rule))
  const example = suite.cases.find(c => c.kind === 'false-negative-risk')
  const answer = baseline.passes[0].find(a => a.file.endsWith('/'+example.file))
  rows.push({name:rule.id, rule, answer, text:example.text})
}
const verify = process.argv[2] === '--verify'
const [craterDir,vlmkitDir,output] = process.argv.slice(2)
const review = verify && json('module-hints')
for (const [repo,evidenceDir,file] of [
  ['crater',craterDir,'pkg-renderer/pkg-renderer/perf_js.mbt.surface'],
  ['vlmkit',vlmkitDir,'packages/vlmkit-core/src/auth-state.ts.surface']
]) {
  const record = json(repo+'-modules')
  const answer = record.answers.find(a => a.file === file && a.rule === 'hyrum')
  const rule = rows.find(r => r.rule.id === 'hyrum').rule
  const name = repo+'-'+basename(file)
  // Live preparation reads the pinned inventory. Offline replay retains the evidence in the record.
  const text = verify ? review.passes[0].find(r=>r.file === name+'-1.hintreview').text.split('\nEvidence\n')[1].split('\nProposed next check\n')[0]
    : readFileSync(join(evidenceDir,file),'utf8')
  rows.push({name, rule, answer, text})
}
const expected = new Map()
for (const {name,rule,answer,text} of rows) {
  const reported = decide({...answer,rule},answer)
  assert.ok(reported.reported && reported.category === 'advisory' && reported.nextCheck)
  for (const [index,hint] of ['Review the relevant code before making a change.',reported.nextCheck].entries()) {
    expected.set(name+'-'+index+'.hintreview',['Question',rule.ask,'Evidence',text,'Proposed next check',hint].join('\n'))
  }
}
if (verify) {
  const [rubric] = loadRules(join(here,'hint-review.yml')).rules
  assert.equal(review.rules[0].draft,ruleTextHash(rubric))
  assert.equal(review.rules[0].at,rubric.at)
  assert.equal(review.passes.length,3)
  for (const pass of review.passes) {
    const seen = new Set()
    for (const row of pass) {
      assert.equal(row.text, expected.get(row.file),row.file)
      assert.ok(!seen.has(row.file) && Number.isFinite(row.value))
      assert.equal(row.value >= rubric.at,row.file.endsWith('-1.hintreview'),row.file)
      seen.add(row.file)
    }
    assert.equal(seen.size,expected.size)
  }
  console.log('Verified eight module/history instructions and two repository examples in three passes.')
} else {
  mkdirSync(output)
  const labels = {}
  for (const [file,body] of expected) {
    writeFileSync(join(output,file),body)
    labels[file] = [{line:1,label:file.endsWith('-1.hintreview')?'bad':'clean',reason:'Does the instruction supply a discriminating check?'}]
  }
  writeFileSync(join(output,'labels.json'),JSON.stringify(labels,null,2)+'\n')
}
