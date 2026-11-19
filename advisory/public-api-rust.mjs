import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

function moduleIndex(path) {
  if (basename(path) === 'index.html') return path
  let dir = dirname(path)
  while (!existsSync(join(dir, 'Cargo.toml'))) {
    if (dirname(dir) === dir) throw new Error('no Cargo manifest for ' + path)
    dir = dirname(dir)
  }
  const manifest = realpathSync(join(dir, 'Cargo.toml'))
  const metadata = JSON.parse(execFileSync('cargo', [
    'metadata', '--offline', '--no-deps', '--format-version', '1', '--manifest-path', manifest,
  ], { cwd: dir, encoding: 'utf8' }))
  const pkg = metadata.packages.find(pkg => realpathSync(pkg.manifest_path) === manifest)
  const library = pkg?.targets.find(target => target.kind.some(kind =>
    ['lib', 'rlib', 'dylib', 'cdylib', 'staticlib', 'proc-macro'].includes(kind)))
  if (!library || (basename(path) !== 'Cargo.toml' && realpathSync(library.src_path) !== realpathSync(path))) {
    throw new Error('select a library crate manifest, its crate root, or a rustdoc module index.html: ' + path)
  }
  const index = join(metadata.target_directory, 'doc', library.name.replaceAll('-', '_'), 'index.html')
  if (!existsSync(index)) throw new Error('build public docs with cargo doc --no-deps, or pass the generated module index.html: ' + index)
  return index
}

export function rustSurface(path, namesOnly) {
  const helper = fileURLToPath(new URL('./rustdoc/module.py', import.meta.url))
  return JSON.parse(execFileSync('python3', ['-I', helper, moduleIndex(path), namesOnly ? 'names' : 'full'], {
    encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
  }))
}
