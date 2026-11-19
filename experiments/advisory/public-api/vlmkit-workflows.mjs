// Run against a clean snapshot of the pinned vlmkit revision (see README).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const [snapshot, output, group = 'core-capture'] = process.argv.slice(2)
assert.ok(group === 'core-capture' || group === 'markup')
const cli = resolve(import.meta.dirname, '../../../src/cli.ts')
const entries = group === 'markup' ? {
  '@mizchi/vlmkit-markup': 'packages/vlmkit-markup/src/index.ts',
  '@mizchi/vlmkit-markup/style/design-tokens.ts': 'packages/vlmkit-markup/src/style/design-tokens.ts',
} : {
  '@mizchi/vlmkit-core': 'packages/vlmkit-core/src/index.ts',
  '@mizchi/vlmkit-core/png-utils.ts': 'packages/vlmkit-core/src/png-utils.ts',
  '@mizchi/vlmkit-capture': 'packages/vlmkit-capture/src/index.ts',
  '@mizchi/vlmkit-capture/capturer.ts': 'packages/vlmkit-capture/src/capturer.ts',
}
const examples = group === 'markup' ? [
  { name: 'markup', source: '@mizchi/vlmkit-markup', wrong: '@mizchi/vlmkit-markup/style/design-tokens.ts' },
] : [
  { name: 'core', source: '@mizchi/vlmkit-core', wrong: '@mizchi/vlmkit-core/png-utils.ts' },
  { name: 'capture', source: '@mizchi/vlmkit-capture', wrong: '@mizchi/vlmkit-core' },
]
const workflows = examples.map(({ name }) => ({ guide: 'packages/vlmkit-' + name + '/README.md', heading: group === 'markup' ? 'As a library' : 'Usage' }))
mkdirSync(output)
const suite = join(output, 'suite')
const evidence = join(suite, 'fixtures')
mkdirSync(evidence, { recursive: true })
copyFileSync(resolve(import.meta.dirname, '../../../rules/text/entry-layout-obscures-workflow/rule.yml'), join(suite, 'rule.yml'))
copyFileSync(join(import.meta.dirname, group + '-expect.yml'), join(suite, 'expect.yml'))
for (const variant of ['guide', 'wrong-import']) {
  const root = join(output, variant)
  mkdirSync(root)
  for (const [i, { source, wrong }] of examples.entries()) {
    const path = workflows[i].guide
    const text = readFileSync(join(snapshot, path), 'utf8')
    const from = 'from "' + source + '";'
    assert.equal(text.split(from).length, 2)
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), variant === 'guide' ? text : text.replace(from, 'from "' + wrong + '";'))
  }
  const manifest = join(root, 'layout.json')
  const sources = Object.fromEntries(Object.entries(entries).map(([name, file]) => [name, relative(root, join(snapshot, file))]))
  writeFileSync(manifest, JSON.stringify({ entries: sources, workflows }))
  const inventory = join(root, 'inventory')
  const summary = JSON.parse(execFileSync(process.execPath, [cli, 'public-api-inputs', inventory, '--api-layout', manifest], { encoding: 'utf8' }))
  for (const [i, { name }] of examples.entries()) {
    writeFileSync(join(evidence, name + '-' + variant + '.apiworkflow'), readFileSync(join(inventory, summary.workflows[i].file)))
  }
}
