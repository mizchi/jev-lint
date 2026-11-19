import assert from 'node:assert/strict'
import { test } from 'node:test'
import { discoverContracts } from '../../../advisory/contracts.mjs'

const contract = 'export interface Walker { identity(s: {id:number,phase:number}): number; branches(s: {id:number,phase:number}): number[] }'
const source = 'import type {Walker} from "./api.js"; export const provider: Walker = { identity: s => s.id, branches: s => s.phase ? [1] : [] }'
const files = consumer => new Map([['api.ts',contract],['provider.ts',source],['search.ts',`import type {Walker} from "./api.js"; export function explore(w:Walker,s:{id:number,phase:number}) { const seen = new Set<number>(); ${consumer} }`]])
const candidates = body => discoverContracts(files(body),{}).cases.filter(c=>c.rule==='state-key-preserves-behavior')
test('join a provider with a visited-set guard on the same typed key',()=>{
  const result=candidates('const k=w.identity(s); if (seen.has(k)) return; seen.add(k); return w.branches(s)')
  assert.equal(result.length,1)
  for(const file of ['api.ts','provider.ts','search.ts']) assert.ok(result[0].text.includes(file))
  assert.match(result[0].text,/s\.phase/)
})
test('a log or a guard on a different value does not establish pruning by this key',()=>{
  assert.equal(candidates('const k=w.identity(s); console.log(k); if(seen.has(0)) return; seen.add(0)').length,0)
})

test('the pinned scan reports the reproduced composition and clears the complete key', async()=>{
  const { readFileSync } = await import('node:fs')
  const { loadRules,ruleTextHash } = await import('../../../src/rules.ts')
  const { join } = await import('node:path')
  const read = name => JSON.parse(readFileSync(join(import.meta.dirname,name),'utf8'))
  const [rule] = loadRules(join(import.meta.dirname,'../../../rules/text/state-key-preserves-behavior')).rules
  const run = read('idealis.json')
  assert.equal(run.rules[0].draft,ruleTextHash(rule))
  assert.equal(run.rules[0].at,rule.at)
  assert.equal(run.rules[0].nextCheck,rule.nextCheck)
  assert.equal(rule.category,'advisory')
  const inventory = read('idealis-inventory.json')
  assert.equal(inventory.revision, read('../../../advisory/idealis.json').revision)
  const files = inventory.candidates.map(c=>c.file).sort()
  assert.deepEqual(run.answers.map(a=>a.file).sort(),files)
  assert.equal(files.length,2)
  for (const row of run.answers) {
    const candidate = inventory.candidates.find(c=>c.file===row.file)
    assert.ok(Number.isFinite(row.value))
    assert.equal(row.value>=rule.at,candidate.id.includes('src/compose.ts'))
  }
  for(const pass of read('hints.json').passes) {
    assert.equal(pass.length,2)
    for(const row of pass) {
      assert.ok(Number.isFinite(row.value))
      assert.equal(row.value>=0.7,row.file==='candidate.hintreview')
      if (row.file==='candidate.hintreview') assert.ok(row.text.endsWith(rule.nextCheck))
    }
  }
})
