import { defineConfig } from 'tsdown'

// Host half: plain ESM with runtime peers external; vendored engine bundles in.
// The optional ../../lib/* dynamic imports (PDF/PPTX, absent by design) stay
// external: they fail at runtime into the upstream try/catch skip.
const host = defineConfig({
  name: 'dsh-plugin-lookatstudy',
  entry: ['src/index.ts'],
  format: 'esm',
  dts: true,
  outDir: 'lib',
  clean: false,
  external: [/^@deepseek-ai\//, /^react$/, /^(\.\.\/)+lib\//],
})

// Browser half: the dsh client-bundle contract (see packages/client/tsdown.client.ts).
// CJS wrapped in window.__ModuleLoader__.load({ id, factory }) — the shell's
// frozen module table answers the injected require for platform modules
// (react) and the documented runtime exemption; everything else inlines.
const client = defineConfig({
  name: 'dsh-plugin-lookatstudy/client',
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  clean: false,
  sourcemap: true,
  external: ['react', '@deepseek-ai/dsh-client-runtime/client'],
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: "dsh-plugin-lookatstudy", factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
})

export default [host, client]
