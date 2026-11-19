import ts from './compiler.mjs'

// Require the same local membership set and key at the early exit and insertion.
// A call named "key" in isolation supplies no evidence of state merging.
export function prunedKey(statement, checker) {
  const condition = statement.expression
  if (!ts.isCallExpression(condition) || !ts.isPropertyAccessExpression(condition.expression)
    || condition.expression.name.text !== 'has' || condition.arguments.length !== 1) return
  const branch = statement.thenStatement
  const exit = ts.isBlock(branch) ? branch.statements[0] : branch
  if (!exit || !(ts.isReturnStatement(exit) || ts.isContinueStatement(exit))) return
  const [argument] = condition.arguments
  const receiver = condition.expression.expression
  if (!ts.isIdentifier(argument) || !ts.isIdentifier(receiver) || !ts.isBlock(statement.parent)) return
  const key = checker.getSymbolAtLocation(argument)
  const collection = checker.getSymbolAtLocation(receiver)
  const binding = key?.valueDeclaration
  if (!collection || !binding || !ts.isVariableDeclaration(binding)
    || !(binding.parent.flags & ts.NodeFlags.Const)) return
  const call = binding.initializer
  if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)) return
  const statements = statement.parent.statements
  const inserted = statements.slice(statements.indexOf(statement) + 1).some(s => {
    if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) return false
    const method = s.expression.expression
    const [value] = s.expression.arguments
    return ts.isPropertyAccessExpression(method) && ['add','set'].includes(method.name.text)
      && checker.getSymbolAtLocation(method.expression) === collection && value && checker.getSymbolAtLocation(value) === key
  })
  if (inserted) return call.expression
}

// The type of a callback parameter can grant access to more state than the key reads.
function referencedTypes(factory, checker) {
  const declarations = new Set()
  function visit(node) {
    if (ts.isTypeReferenceNode(node)) {
      let symbol = checker.getSymbolAtLocation(node.typeName)
      if (symbol && symbol.flags & ts.SymbolFlags.Alias) symbol = checker.getAliasedSymbol(symbol)
      for (const declaration of symbol?.declarations ?? []) {
        if (ts.isInterfaceDeclaration(declaration) || ts.isTypeAliasDeclaration(declaration)) declarations.add(declaration)
      }
    }
    ts.forEachChild(node,visit)
  }
  for (const param of factory?.parameters ?? []) if (param.type) visit(param.type)
  if (factory?.type) visit(factory.type)
  return [...declarations]
}

// Summarize syntactic reads against the actual parameter type. Passing a whole
// subobject to a helper may use all of it; never report its children as omitted.
function keyProjection(member, members, checker) {
  const fn = member.initializer ?? member
  const param = fn.parameters?.[0]
  if (!param || !ts.isIdentifier(param.name) || !fn.body) return []
  const symbol = checker.getSymbolAtLocation(param.name)
  const reads = new Set()
  function visit(node) {
    if (ts.isIdentifier(node) && checker.getSymbolAtLocation(node) === symbol) {
      let access = node
      while (ts.isPropertyAccessExpression(access.parent) && access.parent.expression === access) access = access.parent
      reads.add(access.getText())
    }
    ts.forEachChild(node,visit)
  }
  visit(fn.body)
  if (!reads.size || reads.has(param.name.text)) return []
  const leaves = []
  function fields(type, prefix, depth) {
    const props = type.getProperties()
    if (!props.length || !depth) { leaves.push(prefix); return }
    for (const prop of props.slice(0,20)) {
      const t = checker.getTypeOfSymbolAtLocation(prop,param)
      fields(t,prefix+'.'+prop.name,depth-1)
    }
  }
  fields(checker.getTypeAtLocation(param),param.name.text,2)
  const outside = leaves.filter(leaf => ![...reads].some(r => leaf === r || leaf.startsWith(r+'.') || r.startsWith(leaf+'.')))
  const forwards = []
  for (const sibling of members) {
    const method = sibling.initializer ?? sibling
    const first = method.parameters?.[0]
    if (sibling === member || !first || !method.body || !ts.isIdentifier(first.name)) continue
    const arg = checker.getSymbolAtLocation(first.name)
    function find(node) {
      if (ts.isCallExpression(node) && node.arguments.some(a=>ts.isIdentifier(a) && checker.getSymbolAtLocation(a) === arg))
        forwards.push(sibling.name.getText()+' passes the entire state into '+node.expression.getText()+'()')
      ts.forEachChild(node,find)
    }
    find(method.body)
  }
  const summary = ['Identity reads '+[...reads].join(', ')+'.',
    'Additional fields on the input type: '+(outside.join(', ')||'(none identified)')+'.', ...forwards]
  if (outside.length) summary.push('Pair to test: hold the identity inputs fixed and vary '+outside.join(' or ')+
    '. Check whether the provider permits both values and whether the consumer can distinguish them after the visited check.')
  return [summary.join('\n')]

}

export function stateKeyCases(decl, group, guards, excerpt, guidance, checker) {
  const cases = []
  for (const [member, guard] of guards) {
    for (const provider of group.providers) {
      const members = provider.properties ?? provider.members
      const implementation = members.find(m => m.name?.getText() === member)
      if (!implementation) continue
      const location = excerpt(implementation).split('\n')[0]
      const contractNotes = guidance(decl, member)
      const factory = ts.findAncestor(provider,ts.isFunctionLike)
      const caller = ts.findAncestor(guard,n=>ts.isFunctionLike(n) && !ts.findAncestor(n,ts.isFunctionLike))
      const types = referencedTypes(factory,checker).filter(d=>d!==decl).slice(0,8)
      const sections = [
        ...keyProjection(implementation,members,checker),
        'Contract\n'+excerpt(decl), ...contractNotes,
        ...types.map(t=>'Provider parameter or returned state type\n'+excerpt(t,2500)),
        'Identity implementation\n'+excerpt(implementation),
        'Provider and state construction\n'+excerpt(factory ?? provider,6500),
        'Membership guard and consumer\n'+excerpt(caller ?? guard.parent,6500),
      ]
      cases.push({rule:'state-key-preserves-behavior',id:decl.name.text+'.'+member+'@'+location,
        text:sections.join('\n\n')})
    }
  }
  return cases
}
