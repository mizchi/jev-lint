import { basename, dirname } from 'node:path'
import ts from './compiler.mjs'

function optionsFor(entry) {
  const config = ts.findConfigFile(dirname(entry), ts.sys.fileExists)
  if (!config) return { module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler }
  const read = ts.readConfigFile(config, ts.sys.readFile)
  if (read.error) throw new Error(ts.flattenDiagnosticMessageText(read.error.messageText, '\n'))
  return ts.parseJsonConfigFileContent(read.config, { ...ts.sys, readDirectory: () => [] }, dirname(config)).options
}

const clipped = (s, n) => s.length <= n ? s : s.slice(0, n - 1) + '…'

function targetOf(checker, binding) {
  return binding.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(binding) : binding
}

function describe(checker, binding, source) {
  const symbol = targetOf(checker, binding)
  if (!symbol.declarations?.length) throw new Error('unresolved export ' + binding.name + ' in ' + source.fileName)
  const decl = symbol.valueDeclaration ?? symbol.declarations[0]
  const type = symbol.flags & ts.SymbolFlags.Type ? checker.getDeclaredTypeOfSymbol(symbol) : checker.getTypeOfSymbolAtLocation(symbol, decl)
  let shape = checker.typeToString(type, decl, ts.isTypeAliasDeclaration(decl) ? ts.TypeFormatFlags.InTypeAlias : undefined)
  const memberNames = []
  function membersOf(t, prefix = '') {
    return checker.getPropertiesOfType(t).filter(p => p.name !== 'prototype' && p.declarations?.every(d =>
      !(ts.getCombinedModifierFlags(d) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) &&
      !(d.name && ts.isPrivateIdentifier(d.name)))).map(p => {
        memberNames.push(prefix + p.name)
        const flags = ts.getCombinedModifierFlags(p.valueDeclaration ?? p.declarations[0])
        return (flags & ts.ModifierFlags.Readonly ? 'readonly ' : '') + p.name +
          (p.flags & ts.SymbolFlags.Optional ? '?' : '') + ': ' + checker.typeToString(checker.getTypeOfSymbolAtLocation(p, decl), decl)
      })
  }
  if (ts.isClassLike(decl) || ts.isInterfaceDeclaration(decl)) {
    const members = membersOf(type)
    if (ts.isClassLike(decl)) {
      const ctor = checker.getTypeOfSymbolAtLocation(symbol, decl)
      const constructors = ctor.getConstructSignatures().filter(sig => !sig.declaration ||
        !(ts.getCombinedModifierFlags(sig.declaration) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)))
      members.unshift(...constructors.map(sig => 'new ' + checker.signatureToString(sig)))
      members.push(...membersOf(ctor, 'static ').map(s => 'static ' + s))
    } else {
      members.push(...type.getCallSignatures().map(sig => checker.signatureToString(sig)))
    }
    shape = symbol.name + ' { ' + members.join('; ') + ' }'
  } else if (ts.isTypeAliasDeclaration(decl) && ts.isTypeLiteralNode(decl.type)) {
    membersOf(type)
  } else if (symbol.flags & ts.SymbolFlags.Module && !type.getCallSignatures().length) {
    memberNames.push(...checker.getExportsOfModule(symbol).map(s => s.name).sort())
    shape = 'namespace { ' + memberNames.join(', ') + ' }'
  }
  const doc = ts.displayPartsToString(symbol.getDocumentationComment(checker)).replace(/\s+/g, ' ')
  return binding.name + ' — ' + clipped(shape.replace(/\s+/g, ' '), 340) + (shape.length > 340 && memberNames.length ? ' | members: ' + memberNames.join(', ') : '') + (doc ? ' — ' + clipped(doc, 160) : '')
}

export function typescriptSurface(entry, scan) {
  const program = ts.createProgram([entry], optionsFor(entry))
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(entry)
  if (!source || !ts.isExternalModule(source)) throw new Error('expected a TypeScript module: ' + entry)
  const visited = new Set()
  function exportedNames(file) {
    const mod = checker.getSymbolAtLocation(file)
    const exports = checker.getExportsOfModule(mod)
    if (visited.has(file)) return exports
    visited.add(file)
    const matched = scan(file.fileName.endsWith('.tsx') ? 'Tsx' : 'TypeScript', file.text, {
      export: { kind: 'export_statement' },
    })
    const starts = new Set(matched.map(m => m.range.byteOffset.start))
    const names = new Set()
    function addName(name) {
      if (ts.isBindingPattern(name)) {
        for (const part of name.elements) if (ts.isBindingElement(part)) addName(part.name)
      } else names.add(name.text)
    }
    let previous = 0
    let byteOffset = 0
    for (const stmt of file.statements) {
      const position = stmt.getStart(file)
      byteOffset += Buffer.byteLength(file.text.slice(previous, position))
      previous = position
      if (!starts.has(byteOffset)) continue
      if (ts.isExportDeclaration(stmt)) {
        const imported = stmt.moduleSpecifier && checker.getSymbolAtLocation(stmt.moduleSpecifier)
        if (stmt.moduleSpecifier && !imported) throw new Error('unresolved re-export ' + stmt.moduleSpecifier.getText(file))
        if (stmt.exportClause && ts.isNamedExports(stmt.exportClause)) {
          for (const spec of stmt.exportClause.elements) names.add(spec.name.text)
        } else if (stmt.exportClause) names.add(stmt.exportClause.name.text)
        else {
          const child = imported?.declarations?.find(ts.isSourceFile)
          if (!child) throw new Error('cannot enumerate re-export ' + stmt.getText(file))
          for (const symbol of exportedNames(child)) if (symbol.name !== 'default') names.add(symbol.name)
        }
      } else if (ts.isExportAssignment(stmt) || stmt.modifiers?.some(m => m.kind === ts.SyntaxKind.DefaultKeyword)) {
        if (stmt.isExportEquals) throw new Error('export = entry points are unsupported: ' + entry)
        names.add('default')
      } else if (ts.isVariableStatement(stmt)) {
        for (const decl of stmt.declarationList.declarations) addName(decl.name)
      } else if (stmt.name) names.add(stmt.name.text)
    }
    const errors = [...program.getSyntacticDiagnostics(file), ...program.getSemanticDiagnostics(file).filter(d => d.code === 2308)]
    if (errors.length) throw new Error(ts.flattenDiagnosticMessageText(errors[0].messageText, '\n'))
    const missing = exports.find(s => !names.has(s.name))
    if (missing) throw new Error('cannot account for export ' + missing.name + ' in ' + file.fileName)
    return exports.filter(s => names.has(s.name))
  }
  const rows = []
  for (const [symbol, bindings] of Map.groupBy(exportedNames(source), s => targetOf(checker, s))) {
    const primary = bindings.find(s => s.name === symbol.name) ?? bindings.find(s => s.name !== 'default') ?? bindings[0]
    rows.push(describe(checker, primary, source))
    for (const alias of bindings) if (alias !== primary) rows.push(alias.name + ' — alias of ' + primary.name)
  }
  return { label: 'TypeScript entry ' + basename(entry), rows }
}
