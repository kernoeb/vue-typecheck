import { dirname, join, resolve, sep } from 'node:path'

import ts from '@typescript/typescript6'
import { createParsedCommandLine, type VueCompilerOptions } from '@vue/language-core'

/**
 * Package the generated scripts load their template helper types from. It is written into the cache's
 * own node_modules: language-core turns an absolute `typesRoot` into a path relative to the ORIGINAL
 * .vue file, which is wrong from the cache, while a bare name resolves through the nearest node_modules.
 */
export const TYPES_PACKAGE = 'vue-typecheck-types'

/** A tsconfig resolved for Vue: what to generate, from where, and how its aliases resolve. */
export interface Project {
  /** Absolute path of the tsconfig being checked. */
  configPath: string
  /** Directory mirrored into the cache: the nearest package.json above the tsconfig. */
  root: string
  compilerOptions: ts.CompilerOptions
  vueOptions: VueCompilerOptions
  /** Every root file of the program, .vue included, absolute. */
  fileNames: string[]
  /** SFCs under `root`; SFCs outside it (layers in node_modules) are typed by their own declarations. */
  vueFiles: string[]
  /** `compilerOptions.paths` with absolute targets. */
  paths: Record<string, string[]>
}

export class ConfigError extends Error {}

function findRoot(start: string): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (ts.sys.fileExists(join(dir, 'package.json'))) return dir
    if (dirname(dir) === dir) return start
  }
}

/**
 * Reads the tsconfig with TypeScript 6's JS API. TypeScript 7 has no JS API, and language-core needs
 * one to parse `<script>` blocks; nothing here type-checks.
 */
export function loadProject(configPath: string): Project {
  const absoluteConfig = resolve(configPath)
  if (!ts.sys.fileExists(absoluteConfig)) throw new ConfigError(`tsconfig not found: ${configPath}`)

  const vueParsed = createParsedCommandLine(ts, ts.sys, absoluteConfig)
  const vueOptions: VueCompilerOptions = { ...vueParsed.vueOptions, typesRoot: TYPES_PACKAGE }

  const configErrors: string[] = []
  const parsed = ts.getParsedCommandLineOfConfigFile(
    absoluteConfig,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic) =>
        configErrors.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    },
    undefined,
    undefined,
    vueOptions.extensions.map((extension) => ({
      extension: extension.slice(1),
      isMixedContent: true,
      scriptKind: ts.ScriptKind.Deferred,
    })),
  )
  if (!parsed || configErrors.length > 0) throw new ConfigError(configErrors.join('\n') || `cannot read ${configPath}`)

  const root = findRoot(dirname(absoluteConfig))
  const isVue = (file: string) => vueOptions.extensions.some((extension) => file.endsWith(extension))
  const pathsBase = String(parsed.options.pathsBasePath ?? dirname(absoluteConfig))
  const paths: Record<string, string[]> = {}
  for (const [pattern, targets] of Object.entries(parsed.options.paths ?? {})) {
    paths[pattern] = targets.map((target) => resolve(pathsBase, target))
  }

  return {
    configPath: absoluteConfig,
    root,
    compilerOptions: vueParsed.options,
    vueOptions,
    fileNames: parsed.fileNames,
    vueFiles: parsed.fileNames.filter((file) => isVue(file) && file.startsWith(root + sep)),
    paths,
  }
}
