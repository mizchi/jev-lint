// This evaluation needs the published name inventory; expanding every ORM signature exceeds the default Node heap.
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from '../../../../advisory/compiler.mjs'

const [packageDir, output] = process.argv.slice(2).map(path => resolve(path))
const pkg = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
assert.equal(pkg.version, '0.41.0')
for (const dialect of ['mysql-core', 'singlestore-core']) {
  const entry = pkg.exports['./' + dialect].import
  const file = join(packageDir, entry.types)
  const program = ts.createProgram([file], { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, types: [] })
  const checker = program.getTypeChecker()
  const module = checker.getSymbolAtLocation(program.getSourceFile(file))
  const names = checker.getExportsOfModule(module).map(symbol => symbol.name).sort()
  const runtime = await import(pathToFileURL(join(packageDir, entry.default)).href)
  assert.ok(Object.hasOwn(runtime, 'int'))
  assert.equal(Object.hasOwn(runtime, 'singlestoreTable'), dialect === 'singlestore-core')
  const declarations = names.map(name => Object.hasOwn(runtime, name)
    ? 'export declare const ' + name + ': unknown;' : 'export type ' + name + ' = unknown;')
  writeFileSync(join(output, dialect + '.ts'), declarations.join('\n'))
}
