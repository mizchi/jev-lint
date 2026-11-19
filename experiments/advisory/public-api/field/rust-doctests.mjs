// Compare rustdoc's implicit Rust fence with the same example explicitly tagged.
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [cache, output, format = 'rustdoc', group = 'diagnosis'] = process.argv.slice(2)
if (!cache || !output || !['rustdoc', 'markdown'].includes(format) || !['diagnosis', 'holdout'].includes(group)) throw new Error('usage: node rust-doctests.mjs <directory of .crate archives> <new directory> [rustdoc|markdown] [diagnosis|holdout]')
const out = resolve(output)
const tool = fileURLToPath(new URL('../../../../', import.meta.url))
const cases = group === 'holdout' ? [
  { name: 'crossbeam_utils', archive: 'crossbeam-utils', version: '0.8.21', edition: '2021', sha: 'd0a5c400df2834b80a4c3327b3aad3a4c4cd4de0629063962b03235697506a28',
    error: 'E0603', guide: 'src/sync/wait_group.rs', start: '/// # Examples', end: 'pub struct WaitGroup',
    modules: ['sync', 'thread'], before: 'use crossbeam_utils::sync::WaitGroup;', after: 'use crossbeam_utils::thread::WaitGroup;' },
] : [
  { name: 'memchr', version: '2.7.6', edition: '2021', sha: 'f52b00d39961fc5b2736ea853c9cc86238e165017a493d1d5c8eac6bdc4cc273',
    start: '# Example: matching one of three possible bytes', end: '# Example: iterating over substring matches',
    modules: ['', 'memmem'], before: 'use memchr::memchr3_iter;', after: 'use memchr::memmem::memchr3_iter;' },
  { name: 'base64', version: '0.22.1', edition: '2018', sha: '72b3254f16251a8381aa12e40e3c4d2f0199f8c6508fbecb9d91f575e0fbb8c6',
    start: '//! #### Decoding\n//!\n#![cfg_attr(feature = "std"', end: '//! #### Encoding',
    modules: ['read', 'write', 'engine::general_purpose'], before: 'read::DecoderReader', after: 'write::DecoderReader' },
]
mkdirSync(out)
const suite = join(out, 'doctests')
mkdirSync(join(suite, 'fixtures'), { recursive: true })
copyFileSync(join(tool, 'rules/text/entry-layout-obscures-workflow/rule.yml'), join(suite, 'rule.yml'))
const labels = ['default: clean']
for (const c of cases) {
  const packageDir = (c.archive ?? c.name) + '-' + c.version
  const archive = join(resolve(cache), packageDir + '.crate')
  assert.equal(createHash('sha256').update(readFileSync(archive)).digest('hex'), c.sha)
  execFileSync('tar', ['-xf', archive, '-C', out])
  const src = join(out, packageDir, 'src/lib.rs')
  const flags = ['--edition=' + c.edition, '--cap-lints', 'allow', '--crate-name', c.name, '--cfg', 'feature="std"', '--cfg', 'feature="alloc"']
  const lib = join(out, 'lib' + c.name + '.rlib')
  execFileSync('rustc', [...flags, '--crate-type', 'rlib', src, '-o', lib])
  execFileSync('rustdoc', [...flags, src, '-o', join(out, 'doc')])
  const source = readFileSync(c.guide ? join(out, packageDir, c.guide) : src, 'utf8')
  const start = source.indexOf(c.start)
  const end = source.indexOf(c.end, start + c.start.length)
  assert.ok(start >= 0 && end > start)
  // base64 emits a different opening fence according to its std feature.
  const guide = source.slice(start, end).replace(/^#!\[cfg_attr\(feature = "std", doc = "```"\)\]$/m, '```')
    .replace(/^#!\[cfg_attr\(not\(feature = "std"\), doc = "```ignore"\)\]\n/m, '').replace(/^\/\/[!/] ?/gm, '').trimEnd() + '\n'
  assert.equal(guide.split(c.before).length, 2)
  const entries = Object.fromEntries(c.modules.map(mod => [[c.name, mod].filter(Boolean).join('::'), join('../doc', c.name, ...mod.split('::'), 'index.html')]))
  for (const side of ['original', 'wrong']) {
    const text = side === 'wrong' ? guide.replace(c.before, c.after) : guide
    const blocks = [...text.matchAll(/^```\n([\s\S]*?)^```$/gm)]
    assert.equal(blocks.length, 1)
    const body = blocks[0][1].replace(/^# ?/gm, '')
    const result = spawnSync('rustc', ['--edition=' + c.edition, '--crate-name', 'consumer', '--extern', c.name + '=' + lib,
      '--emit=metadata', '-o', join(out, 'consumer.rmeta'), '-'], { input: body.includes('fn main()') ? body : 'fn main(){\n' + body + '\n}', encoding: 'utf8' })
    if (result.error) throw result.error
    if (side === 'original') assert.equal(result.status, 0, result.stderr)
    else {
      assert.notEqual(result.status, 0)
      assert.ok(result.stderr.includes('error[' + (c.error ?? 'E0432') + ']'), result.stderr)
    }
    for (const fence of group === 'holdout' ? ['implicit'] : ['implicit', 'tagged']) {
      const key = [c.name, side, fence].join('-')
      const dir = join(out, key)
      mkdirSync(dir)
      writeFileSync(join(dir, 'guide.md'), fence === 'implicit' ? text : text.replace(/^```$/m, '```rust'))
      writeFileSync(join(dir, 'layout.json'), JSON.stringify({ entries, workflows: [{ guide: 'guide.md', guideFormat: format }] }))
      const inventory = JSON.parse(execFileSync(process.execPath, [join(tool, 'src/cli.ts'), 'public-api-inputs',
        join(dir, 'review'), '--api-layout', join(dir, 'layout.json'), '--workflows-only'], { encoding: 'utf8' }))
      const file = 'fixtures/' + key + '.apiworkflow'
      copyFileSync(join(dir, 'review', inventory.workflows[0].file), join(suite, file))
      labels.push(file + ':', '  - {line: 1, window: 0, label: ' + (side === 'original' ? 'clean' : 'bad') +
        ', reason: "' + (side === 'original' ? 'The published import compiles.' : 'rustc rejects the edited import with ' + (c.error ?? 'E0432') + '.') + '"}')
    }
  }
}
writeFileSync(join(suite, 'expect.yml'), labels.join('\n') + '\n')
