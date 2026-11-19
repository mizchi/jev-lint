import { createRequire } from 'node:module'
import { resolve } from 'node:path'

// The generator can use the caller's compiler when the CLI is installed globally.
// Never resolve or execute dependencies from the Git tree being inspected.
function compiler() {
  const sources = [[import.meta.url,'typescript'],[import.meta.url,'typescript-classic'],[resolve('package.json'),'typescript']]
  for (const [from,name] of sources) {
    const load = createRequire(from)
    let entry
    try { entry = load.resolve(name) } catch { continue }
    const api = load(entry)
    if (typeof api.createProgram === 'function' && typeof api.createSourceFile === 'function') return api
  }
  throw new Error('advisory-inputs needs the classic TypeScript compiler API. Run it from a tooling directory with typescript@5.9.3 installed.')
}

export default compiler()
