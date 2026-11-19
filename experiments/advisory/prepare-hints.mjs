// Rebuild the comparison from the recorded CLI findings and their original evidence.
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import assert from 'node:assert/strict'

const here = import.meta.dirname
const repo = resolve(here, '../..')
const [evidenceDir, out, revision = 'run'] = process.argv.slice(2)
assert.ok(out, 'usage: node prepare-hints.mjs <generated vlmkit directory> <new output directory>')
assert.ok(['run','before'].includes(revision))
mkdirSync(out)
const labels = {}
for (const dataset of ['fixtures', 'input']) {
  const json = execFileSync(process.execPath, [join(repo, 'src/cli.ts'), 'replay', join(here, dataset+'-'+revision+'.json'), '--no-config', '--json'], {encoding:'utf8'})
  const findings = JSON.parse(json).findings
  // A historic regression and a reviewed false alarm exercise both directions of investigation.
  const selected = dataset === 'fixtures' ? findings : findings.filter(f =>
    ['da824980e0039af62c8ad20c.lsp','ea4c5599d9f980390be10015.parnas'].includes(f.file))
  assert.equal(selected.length, dataset === 'fixtures' ? 5 : 2)
  for (const finding of selected) {
    assert.equal(finding.category, 'advisory')
    assert.ok(finding.nextCheck)
    const dir = dataset === 'fixtures' ? join(repo, 'rules/text', finding.rule, 'fixtures') : evidenceDir
    const body = readFileSync(join(dir, finding.file), 'utf8')
    for (const [i,hint] of ['Review the relevant code before making a change.', finding.nextCheck].entries()) {
      const name = dataset+'-'+finding.file+'-'+i+'.hintreview'
      const text = ['Question', finding.message, 'Evidence', body, 'Proposed next check', hint].join('\n')
      writeFileSync(join(out, name), text)
      labels[name] = [{line:1, rule:'next-check-actionable', label:i ? 'bad':'clean', reason:i ?
        'The proposed check names a contract-specific comparison with an observable outcome.' :
        'The generic reminder supplies no check or deciding observation.'}]
    }
  }
}
writeFileSync(join(out,'labels.json'),JSON.stringify(labels,null,2)+'\n')
