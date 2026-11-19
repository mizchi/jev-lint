// Rejudge only the oversize commits in the first run. Keep both records.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { Jev } from '../../src/jev.ts'
import { loadRules } from '../../src/rules.ts'
import { buildRecord, run } from '../../src/run.ts'

const [checkout, source, output] = process.argv.slice(2)
const initial = JSON.parse(readFileSync(source, 'utf8'))
const pending = initial.answers.filter(row => row.value === null)
assert.ok(pending.length && pending.every(row => /^[a-f0-9]{40}$/.test(row.file)))
const revisions = [...new Set(pending.map(row => row.file))]
const { rules, errors } = loadRules(initial.rules.map(r => join(import.meta.dirname, '../../rules/git', r.id)))
assert.deepEqual(errors, [])
const excerpt = (s, n) => s.length <= n ? s : s.slice(0,n/2) + '\n[… middle omitted …]\n' + s.slice(-n/2)
class CompactCommitClient extends Jev {
  askSplitting(state, questions) {
    return super.askSplitting({...state, message: excerpt(state.message,1800), files: state.files.slice(0,40),
      stat: excerpt(state.stat,2000), diff: excerpt(state.diff,8000),
      note_on_diff: 'Partial commit evidence. The message, file list, stat and diff may be incomplete.'}, questions)
  }
}
const result = await run({cwd: resolve(checkout), paths: [], rules, model: initial.model,
  commits: {range: '--no-walk '+revisions.join(' ')}, client: new CompactCommitClient({
    model: initial.model, baseUrl: 'https://api.typesafe.ai', apiKey: process.env.TYPESAFE_API_KEY
  })})
const record = buildRecord(result, {arm:null, cutoffs:{}, unsureBelow:null})
const keys = new Set(pending.map(row => row.file+'#'+row.rule))
record.answers = record.answers.filter(row => keys.has(row.file+'#'+row.rule))
assert.equal(record.answers.length, keys.size)
assert.ok(record.answers.every(row => Number.isFinite(row.value)))
writeFileSync(output,JSON.stringify(record,null,2)+'\n',{flag:'wx'})
