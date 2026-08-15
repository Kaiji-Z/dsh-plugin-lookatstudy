import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Rewrite tsx-style relative `.js` specifiers to their `.ts` source when only
 * the source exists, so the livetest driver runs on plain Node type-stripping.
 */
export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context)
  } catch (err) {
    if (err?.code === 'ERR_MODULE_NOT_FOUND' && (specifier.startsWith('./') || specifier.startsWith('../')) && specifier.endsWith('.js') && context.parentURL) {
      const tsUrl = new URL(specifier.slice(0, -3) + '.ts', context.parentURL)
      if (existsSync(fileURLToPath(tsUrl))) return next(tsUrl.href, context)
    }
    throw err
  }
}
