const named = field => ({ has: { field, pattern: '$' + field.toUpperCase() } })
const isPublic = name => /^\p{Lu}/u.test(name)
const top = { not: { inside: { kind: 'block', stopBy: 'end' } } }
const either = (...kinds) => ({ any: kinds.map(kind => ({ kind })) })

// Repeated names in a Go var or const spec are sibling identifiers. Its type
// is a type_identifier and its right hand side is nested in an expression_list.
const types = either('type_spec', 'type_alias')
const directStruct = { kind: 'field_declaration_list', inside: { kind: 'struct_type', inside: types } }
const rules = {
  comment: { kind: 'comment' },
  package: { kind: 'package_identifier', inside: { kind: 'package_clause' } },
  type: { all: [{ kind: 'type_spec' }, top, named('name'), named('type')] },
  alias: { all: [{ kind: 'type_alias' }, top, named('name'), named('type')] },
  var: { kind: 'identifier', inside: { kind: 'var_spec', pattern: '$SPEC' }, ...top },
  const: { kind: 'identifier', inside: { kind: 'const_spec', pattern: '$SPEC' }, ...top },
  annotation: { any: ['var_spec', 'const_spec'].map(kind => ({ kind, ...named('type') })), ...top },
  func: { kind: 'function_declaration', ...named('name') },
  method: { kind: 'method_declaration', all: [named('receiver'), named('name')] },
  body: { kind: 'block', inside: either('function_declaration', 'method_declaration') },
  field: { kind: 'field_identifier', inside: { kind: 'field_declaration', ...named('type'), inside: directStruct } },
  embedded: { kind: 'field_declaration', not: { has: { field: 'name', pattern: '$NAME' } }, inside: directStruct },
  iface: { kind: 'method_elem', ...named('name'), inside: { kind: 'interface_type', inside: types } },
  constraint: { kind: 'type_elem', inside: { kind: 'interface_type', inside: types } },
  error: { kind: 'ERROR' },
}

const offset = node => node.range.byteOffset
const encloses = (parent, child) => offset(parent).start <= offset(child).start && offset(parent).end >= offset(child).end
const compact = text => text.replace(/\s+/g, ' ').trim()
const clipped = text => text.length <= 220 ? text : text.slice(0, 219) + '…'

export function goSurface(sources, scan) {
  const bindings = new Map()
  const packages = new Set()
  const packageDocs = new Set()
  for (const source of sources) {
    const hits = Map.groupBy(scan('Go', source, rules), hit => hit.ruleId)
    const lines = source.split('\n')
    const comments = new Map((hits.get('comment') ?? [])
      .filter(c => /^\s*(?:\/\/|\/\*)/.test(lines[c.range.start.line]))
      .map(c => [c.range.end.line, c]))
    function documentation(hit) {
      const group = []
      let line = hit.range.start.line - 1
      while (comments.has(line)) {
        const c = comments.get(line)
        if (!/^\/\/(?:go:|line )/.test(c.text)) group.unshift(c.text.replace(/^\/\/ ?|^\/\*|\*\/$/g, '').trim())
        line = c.range.start.line - 1
      }
      return group.join('\n')
    }
    function add(name, signature, hit, row = signature, memberDocs = []) {
      const doc = [documentation(hit), ...memberDocs].filter(Boolean).join('\n')
      bindings.set(name, { name, signature, row, doc })
    }
    if (hits.has('error')) throw new Error('Go syntax error: ' + hits.get('error')[0].text.slice(0, 80))
    for (const pkg of hits.get('package') ?? []) {
      packages.add(pkg.text)
      const doc = documentation(pkg)
      if (doc) packageDocs.add(doc)
    }
    for (const t of [...hits.get('type') ?? [], ...hits.get('alias') ?? []]) {
      const { NAME, TYPE } = t.metaVariables.single
      if (!isPublic(NAME.text)) continue
      const memberDocs = []
      let shape = compact(TYPE.text)
      if (/^(?:struct|interface)\s*\{/.test(shape)) {
        const members = []
        for (const field of hits.get('field') ?? []) {
          if (!encloses(TYPE, field) || !isPublic(field.text)) continue
          members.push(field.text + ' ' + compact(field.metaVariables.single.TYPE.text))
          const doc = documentation(field)
          if (doc) memberDocs.push(field.text + ' — ' + doc)
        }
        for (const field of hits.get('embedded') ?? []) {
          const name = field.text.split(/[\s\[`]/)[0].split('.').at(-1).replace(/^\*/, '')
          if (encloses(TYPE, field) && isPublic(name)) members.push(compact(field.text))
        }
        for (const item of hits.get('constraint') ?? []) {
          if (encloses(TYPE, item)) members.push(compact(item.text))
        }
        for (const method of hits.get('iface') ?? []) {
          const name = method.metaVariables.single.NAME.text
          if (!encloses(TYPE, method) || !isPublic(name)) continue
          members.push(compact(method.text))
          const doc = documentation(method)
          if (doc) memberDocs.push(name + ' — ' + doc)
        }
        shape = shape.slice(0, shape.indexOf('{')).trim() + ' { ' + members.join('; ') + ' }'
      }
      add(NAME.text, 'type ' + NAME.text + (t.ruleId === 'alias' ? ' = ' : ' ') + shape, t, undefined, memberDocs)
    }
    for (const kind of ['var', 'const']) {
      for (const hit of hits.get(kind) ?? []) {
        if (!isPublic(hit.text)) continue
        const annotation = (hits.get('annotation') ?? []).find(spec => encloses(spec, hit))
        const type = annotation?.metaVariables.single.TYPE.text
        add(hit.text, kind + ' ' + hit.text + (type ? ' ' + clipped(compact(type)) : ''), hit)
      }
    }
    const bytes = Buffer.from(source)
    for (const hit of [...hits.get('func') ?? [], ...hits.get('method') ?? []]) {
      const { NAME, RECEIVER } = hit.metaVariables.single
      if (!isPublic(NAME.text)) continue
      const receiver = RECEIVER?.text.replace(/\[[\s\S]*\]/, '').match(/([\p{L}_][\p{L}\p{N}_]*)\s*\)$/u)?.[1]
      if (RECEIVER && (!receiver || !isPublic(receiver))) continue
      const body = (hits.get('body') ?? []).find(block => encloses(hit, block))
      const signature = bytes.subarray(offset(NAME).end, body ? offset(body).start : offset(hit).end).toString()
      const name = (receiver ? receiver + '.' : '') + NAME.text
      add(name, 'func ' + name + compact(signature), hit, 'func ' + name + clipped(compact(signature)))
    }
  }
  if (packages.size !== 1 || packages.has('main')) throw new Error('expected one importable Go package')
  return { label: 'Go package ' + [...packages][0], bindings: [...bindings.values()], packageDoc: [...packageDocs].join('\n') }
}
