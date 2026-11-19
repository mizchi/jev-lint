import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { goSurface } from './public-api-go.mjs'

// This is lexical context for a reader. A name match is not a usage count.
function relatedSignatures(entries) {
  const byName = new Map(entries.map(entry => [entry.name, entry]))
  const peers = new Map(entries.map(entry => [entry, new Set()]))
  for (const entry of entries) {
    for (const token of entry.signature.match(/[\p{ID_Start}$_][\p{ID_Continue}$_]*/gu) ?? []) {
      const other = byName.get(token)
      if (other && other !== entry) {
        peers.get(entry).add(other)
        peers.get(other).add(entry)
      }
    }
  }
  return peers
}

export async function publicApiInputs(out, targets, binary, guide) {
  // Scan stdin so a target repository cannot supply ast-grep configuration.
  function scan(language, source, rules) {
    const spec = Object.entries(rules).map(([id, rule]) => JSON.stringify({ id, language, rule })).join('\n---\n')
    const result = spawnSync(binary, ['scan', '--stdin', '--inline-rules', spec, '--json=compact'], {
      input: source, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
    })
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim() || 'ast-grep failed')
    return JSON.parse(result.stdout)
  }

  const guideText = guide ? readFileSync(guide, 'utf8') : ''
  const outputs = []
  for (const target of targets) {
    const path = resolve(target)
    let surface
    if (statSync(path).isDirectory()) {
      // go list selects the active platform and build tags without loading dependencies.
      const list = spawnSync('go', ['list', '-find', '-json', '.'], {
        cwd: path, encoding: 'utf8', env: { ...process.env, GO111MODULE: 'off', GOWORK: 'off', GOTOOLCHAIN: 'local' },
      })
      if (list.error || list.status !== 0) throw list.error ?? new Error(list.stderr.trim())
      const pkg = JSON.parse(list.stdout)
      const files = [...pkg.GoFiles ?? [], ...pkg.CgoFiles ?? []].sort()
      surface = goSurface(files.map(name => readFileSync(join(path, name), 'utf8')), scan)
    } else if (/^\.(?:[cm]?ts|tsx)$/.test(extname(path))) {
      const { typescriptSurface } = await import('./public-api-typescript.mjs')
      surface = typescriptSurface(path, scan)
    } else {
      throw new Error('expected a TypeScript entry point or a Go package directory: ' + target)
    }
    const entries = surface.bindings
    const rows = entries.map(entry => entry.row).sort()
    const body = ['Surface: ' + surface.label, 'Public names: ' + rows.length, ...rows].join('\n') + '\n'
    const stem = (outputs.length + 1) + '-' + basename(path)
    const inventory = {
      target, file: stem + '.apisurface', count: entries.length,
      aliases: entries.filter(e => e.alias).length, documented: entries.filter(e => !e.alias && e.doc).length,
      bindings: join('bindings', stem),
    }
    outputs.push({ inventory, entries, label: surface.label, packageDoc: surface.packageDoc, body })
  }
  mkdirSync(out)
  for (const {inventory, entries, label, packageDoc, body} of outputs) {
    writeFileSync(join(out, inventory.file), body)
    const dir = join(out, inventory.bindings)
    mkdirSync(dir, {recursive: true})
    const related = relatedSignatures(entries)
    entries.forEach((entry, index) => {
      const heading = ['Surface: ' + label, 'Public binding: ' + entry.name, 'Signature: ' + entry.signature,
        'Declaration documentation:', entry.doc || '(none supplied)']
      const peers = [...related.get(entry)]
      if (peers.length) {
        heading.push('Related public signatures (' + Math.min(6, peers.length) + ' of ' + peers.length + '):')
        for (const peer of peers.slice(0, 6)) heading.push(peer.signature.length <= 400 ? peer.signature : peer.signature.slice(0, 399) + '…')
      }
      if (packageDoc) heading.push('Package documentation:', packageDoc)
      if (guide) heading.push('Public guide (' + basename(guide) + '):', guideText)
      // The ordinal keeps identifiers distinct on case-insensitive filesystems.
      const name = (index + 1) + '-' + encodeURIComponent(entry.name).slice(0, 120) + '.apibinding'
      writeFileSync(join(dir, name), heading.join('\n') + '\n')
    })
  }
  return outputs.map(o => o.inventory)
}
