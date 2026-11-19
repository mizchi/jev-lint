// Each guide is read from the pinned tree. Only the temporary snapshot receives the control edit.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [clones, outArg] = process.argv.slice(2)
const out = resolve(outArg)
const cli = resolve(import.meta.dirname, '../../../../src/cli.ts')
const corpus = JSON.parse(readFileSync(join(import.meta.dirname, 'corpus.json'), 'utf8'))
mkdirSync(out)
const suite = join(out, 'suite')
const cases = join(suite, 'fixtures')
mkdirSync(cases, { recursive: true })
copyFileSync(join(import.meta.dirname, 'expect.yml'), join(suite, 'expect.yml'))
copyFileSync(resolve(import.meta.dirname, '../../../../rules/text/entry-layout-obscures-workflow/rule.yml'), join(suite, 'rule.yml'))
for (const [repo, { revision, entries, workflows, controls }] of Object.entries(corpus)) {
  const source = join(out, repo)
  mkdirSync(source)
  const archive = join(out, repo + '.tar')
  execFileSync('git', ['-C', join(clones, repo), 'archive', '--output', archive, revision])
  execFileSync('tar', ['-xf', archive, '-C', source])
  const layout = join(source, 'jev-workflow-layout.json')
  const generate = (name, selected, firstNumber = 1) => {
    writeFileSync(layout, JSON.stringify({ entries, workflows: selected }))
    const inventory = join(out, repo + '-' + name + '-' + firstNumber)
    const summary = JSON.parse(execFileSync(process.execPath, [cli, 'public-api-inputs', inventory, '--api-layout', layout], { encoding: 'utf8' }))
    for (const [index, { file }] of summary.workflows.entries()) {
      copyFileSync(join(inventory, file), join(cases, repo + '-' + name + '-' + (index + firstNumber) + '.apiworkflow'))
    }
    return summary
  }
  const original = generate('guide', workflows)
  for (const control of controls) {
    const selected = workflows[control.workflow - 1]
    const guide = join(source, selected.guide)
    const text = readFileSync(guide, 'utf8')
    assert.equal(text.split(control.from).length, 2)
    writeFileSync(guide, text.replace(control.from, control.to))
    try {
      generate('control', [selected], control.workflow)
    } finally {
      writeFileSync(guide, text)
    }
  }
  console.log(repo, original.entries.map(entry => entry.publicPath + '=' + entry.count).join(' '))
}
