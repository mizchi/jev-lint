const named = field => ({ has: { field, pattern: '$' + field.toUpperCase() } })
const isPublic = name => /^\p{Lu}/u.test(name)
const top = { not: { inside: { kind: 'block', stopBy: 'end' } } }
const either = (...kinds) => ({ any: kinds.map(kind => ({ kind })) })

// Repeated names in a Go var or const spec are sibling identifiers. Its type
// is a type_identifier and its right hand side is nested in an expression_list.
const types = either('type_spec', 'type_alias')
const directStruct = { kind: 'field_declaration_list', inside: { kind: 'struct_type', inside: types } }
const rules = {
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
  const rows = new Set()
  const packages = new Set()
  for (const source of sources) {
    const hits = Map.groupBy(scan('Go', source, rules), hit => hit.ruleId)
    if (hits.has('error')) throw new Error('Go syntax error: ' + hits.get('error')[0].text.slice(0, 80))
    for (const pkg of hits.get('package') ?? []) packages.add(pkg.text)
    for (const t of [...hits.get('type') ?? [], ...hits.get('alias') ?? []]) {
      const { NAME, TYPE } = t.metaVariables.single
      if (!isPublic(NAME.text)) continue
      let shape = compact(TYPE.text)
      if (/^(?:struct|interface)\s*\{/.test(shape)) {
        const members = []
        for (const field of hits.get('field') ?? []) {
          if (encloses(TYPE, field) && isPublic(field.text)) members.push(field.text + ' ' + compact(field.metaVariables.single.TYPE.text))
        }
        for (const field of hits.get('embedded') ?? []) {
          const name = field.text.split(/[\s\[`]/)[0].split('.').at(-1).replace(/^\*/, '')
          if (encloses(TYPE, field) && isPublic(name)) members.push(compact(field.text))
        }
        for (const item of hits.get('constraint') ?? []) {
          if (encloses(TYPE, item)) members.push(compact(item.text))
        }
        for (const method of hits.get('iface') ?? []) {
          if (encloses(TYPE, method) && isPublic(method.metaVariables.single.NAME.text)) members.push(compact(method.text))
        }
        shape = shape.slice(0, shape.indexOf('{')).trim() + ' { ' + members.join('; ') + ' }'
      }
      rows.add('type ' + NAME.text + (t.ruleId === 'alias' ? ' = ' : ' ') + shape)
    }
    for (const kind of ['var', 'const']) {
      for (const hit of hits.get(kind) ?? []) {
        if (!isPublic(hit.text)) continue
        const annotation = (hits.get('annotation') ?? []).find(spec => encloses(spec, hit))
        const type = annotation?.metaVariables.single.TYPE.text
        rows.add(kind + ' ' + hit.text + (type ? ' ' + clipped(compact(type)) : ''))
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
      rows.add('func ' + (receiver ? receiver + '.' : '') + NAME.text + clipped(compact(signature)))
    }
  }
  if (packages.size !== 1 || packages.has('main')) throw new Error('expected one importable Go package')
  return { label: 'Go package ' + [...packages][0], rows: [...rows] }
}
