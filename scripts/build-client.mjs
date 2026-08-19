/**
 * Build `client/bundle.js` from `client/index.js`.
 *
 * The static-install artifact follows the client-modules bundle protocol:
 * `window.__ModuleLoader__.load({ id, factory })` registers a lazy CommonJS
 * factory that receives a `require` resolving framework modules (react is a
 * platform module; every other dependency is inlined). This script is a thin
 * wrapper: it injects `var React = require("react")` and the module/exports
 * scaffolding, then wraps the dynamic-plugin source verbatim.
 *
 * Run: `npm run build:client`
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const sourcePath = join(here, '..', 'client', 'index.js')
const bundlePath = join(here, '..', 'client', 'bundle.js')

const source = readFileSync(sourcePath, 'utf8')

const banner = `/* Generated from client/index.js by scripts/build-client.mjs — do not edit by hand.
 * Regenerate with: npm run build:client
 */
window.__ModuleLoader__.load({
  id: "dsh-plugin-skills-management",
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })
    var React = require("react")
`

const footer = `
    return module.exports
  }
})
`

// The dynamic source references the React global directly; in the static
// bundle the factory's `var React` above satisfies it. Indent the wrapped
// body uniformly for readability of the artifact.
const indented = source
  .split('\n')
  .map((line) => (line.length === 0 ? line : '    ' + line))
  .join('\n')

writeFileSync(bundlePath, banner + indented + footer)
console.log(`built ${bundlePath} (${Buffer.byteLength(bundlePath === bundlePath ? banner + indented + footer : '', 'utf8')} bytes)`)
