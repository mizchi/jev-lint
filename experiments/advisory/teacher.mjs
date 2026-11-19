// Export the final paired evaluations. Keep the fixture design separate from model judgments.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const directory = import.meta.dirname
const rows = []
for (const source of ['hints-after.json','module-hints.json']) {
  const record = JSON.parse(readFileSync(join(directory,source),'utf8'))
  const [rubric] = record.rules
  const groups = new Map()
  for (const pass of record.passes) {
    const seen = new Set()
    for (const answer of pass) {
      assert.ok(!seen.has(answer.file) && Number.isFinite(answer.value))
      seen.add(answer.file)
      if (!groups.has(answer.file)) groups.set(answer.file,{input:answer.text,scores:[]})
      const group = groups.get(answer.file)
      assert.equal(group.input,answer.text)
      group.scores.push(answer.value)
    }
  }
  for (const [file,{input,scores}] of groups) {
    assert.equal(scores.length,3)
    const parts = /^(.*)-([01])\.hintreview$/.exec(file)
    assert.ok(parts)
    const pairId = source.replace('.json','')+'/'+parts[1]
    const votes = scores.filter(score=>score>=rubric.at).length
    rows.push({id:pairId+'/'+parts[2],pairId,source,subject:file,
      variant:parts[2]==='1'?'shipped':'generic',input,
      inputSha256:createHash('sha256').update(input).digest('hex'),
      rubric:rubric.ask,model:record.model,cutoff:rubric.at,scores,
      labelSource:'jev-majority',actionable:votes>scores.length/2})
  }
}
rows.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
assert.equal(rows.length,34)
assert.equal(new Set(rows.map(row=>row.pairId)).size,17)
const data = rows.map(row=>JSON.stringify(row)).join('\n')+'\n'
const [out] = process.argv.slice(2)
if (out === '--verify') assert.equal(readFileSync(join(directory,'teacher.jsonl'),'utf8'),data)
else if (out) writeFileSync(out,data,{flag:'wx'})
else throw new Error('usage: node teacher.mjs <new output.jsonl> | --verify')
console.log('34 rows, 17 pairs, SHA-256 '+createHash('sha256').update(data).digest('hex'))
