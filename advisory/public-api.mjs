import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import { goSurface } from './public-api-go.mjs'

export async function publicApiInputs(out, targets, binary) {
  // Scan stdin so a target repository cannot supply ast-grep configuration.
  function scan(language, source, rules) {
    const spec = Object.entries(rules).map(([id, rule]) => JSON.stringify({ id, language, rule })).join('\n---\n')
    const result = spawnSync(binary, ['scan', '--stdin', '--inline-rules', spec, '--json=compact'], {
      input: source, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024,
    })
    if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.trim() || 'ast-grep failed')
    return JSON.parse(result.stdout)
  }

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
    const rows = surface.rows.sort()
    const body = ['Surface: ' + surface.label, 'Public names: ' + rows.length, ...rows].join('\n') + '\n'
    outputs.push({ target, file: (outputs.length + 1) + '-' + basename(path) + '.apisurface', count: rows.length, body })
  }
  mkdirSync(out)
  for (const {file, body} of outputs) writeFileSync(join(out, file), body)
  return outputs.map(({body, ...inventory}) => inventory)
}
