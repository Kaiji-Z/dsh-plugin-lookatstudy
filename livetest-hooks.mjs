import { register } from 'node:module'
import { pathToFileURL } from 'node:url'

register('./livetest-resolve-hooks.mjs', pathToFileURL('./lookatstudy-plugin/'))
