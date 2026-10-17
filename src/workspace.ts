import { cp, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

import type { Generate, GeneratedScript } from './codegen'
import { readVersion } from './package-json'
import { type Project, TYPES_PACKAGE } from './project'
import { findSyntaxProblems, type SyntaxProblem } from './syntax'

/** Where a checker sees the project with every SFC replaced by its generated script. */
export interface Workspace {
  /** Generated tsconfig to hand to the checker. */
  configPath: string
  /** Generated script → the SFC it came from. */
  scripts: Map<string, string>
  /** SFC → text read for this run (mapping regenerates from exactly this text). */
  sources: Map<string, string>
  /**
   * SFCs whose generated script does not parse. They are NOT type-checked: importers get a declaration
   * stub instead, so the rest of the program still is.
   */
  unparseable: Map<string, SyntaxProblem>
  /** SFCs whose script was generated in this run; the rest came from the cache. */
  regenerated: number
}

interface ManifestEntry {
  source: string
  /** Hash of the SFC text the script was generated from. */
  hash: string
  /** Set when the generated script did not parse: the cached file is then a declaration stub. */
  problem?: SyntaxProblem
}

interface Manifest {
  key: string
  /** Generated script or stub → its SFC. */
  files: Record<string, ManifestEntry>
}

/** What importers of an unparseable SFC see: a component that accepts anything. */
const STUB = `import type { DefineComponent } from 'vue'\n\ndeclare const component: DefineComponent<Record<string, unknown>>\nexport default component\n`

const languageCoreRoot = dirname(Bun.resolveSync('@vue/language-core/package.json', import.meta.dir))
const languageCoreVersion = await readVersion(join(languageCoreRoot, 'package.json'))
const toolVersion = await readVersion(join(import.meta.dir, '..', 'package.json'))

function isUnder(path: string, dir: string): boolean {
  return path === dir || path.startsWith(dir + sep)
}

/** A Vue language plugin is a function; language-core keeps its tsconfig entry on `__moduleConfig`. */
function pluginName(plugin: Function): string {
  const config: unknown = '__moduleConfig' in plugin ? plugin.__moduleConfig : undefined
  if (typeof config === 'string') return config
  if (config && typeof config === 'object' && 'name' in config && typeof config.name === 'string') return config.name
  return plugin.name
}

function parseProblem(value: unknown): SyntaxProblem | undefined {
  if (!value || typeof value !== 'object') return undefined
  if (!('line' in value && 'column' in value && 'code' in value && 'message' in value && 'text' in value)) return undefined
  const { line, column, code, message, text } = value
  if (typeof line !== 'number' || typeof column !== 'number' || typeof code !== 'number') return undefined
  if (typeof message !== 'string' || typeof text !== 'string') return undefined
  return { line, column, code, message, text }
}

function parseEntry(value: unknown): ManifestEntry | undefined {
  if (!value || typeof value !== 'object' || !('source' in value) || !('hash' in value)) return undefined
  if (typeof value.source !== 'string' || typeof value.hash !== 'string') return undefined
  const problem = 'problem' in value ? parseProblem(value.problem) : undefined
  if ('problem' in value && !problem) return undefined
  return problem ? { source: value.source, hash: value.hash, problem } : { source: value.source, hash: value.hash }
}

/** The manifest is our own cache file, but a cache from another version or a broken write is just empty. */
async function readManifest(path: string): Promise<Manifest> {
  const data: unknown = await Bun.file(path)
    .json()
    .catch(() => undefined)
  if (!data || typeof data !== 'object' || !('key' in data) || typeof data.key !== 'string') return { key: '', files: {} }
  const files: Manifest['files'] = {}
  if ('files' in data && data.files && typeof data.files === 'object') {
    for (const [target, value] of Object.entries(data.files)) {
      const entry = parseEntry(value)
      if (entry) files[target] = entry
    }
  }
  return { key: data.key, files }
}

/**
 * Writes the generated scripts under node_modules/.cache/vue-typecheck/<config>/ mirroring the project
 * layout, plus a tsconfig that extends the project's:
 * - `rootDirs` joins the project and the cache, so a relative `./Foo.vue` resolves to `Foo.vue.ts`
 *   (TypeScript tries `<specifier>.ts` for an unknown extension);
 * - every `paths` alias gets a cache fallback, so `~/components/Foo.vue` resolves the same way;
 * - `files` lists the program's own files plus the scripts, as TypeScript 6 expanded them.
 * Only SFCs whose text changed are regenerated; scripts of deleted SFCs are removed, or `rootDirs`
 * would keep resolving imports of a file that no longer exists. A script that does not parse is
 * replaced by a `Foo.vue.d.ts` stub (see findSyntaxProblems for why it must never reach the checker).
 */
export async function prepareWorkspace(project: Project, generate: Generate): Promise<Workspace> {
  const cacheDir = join(project.root, 'node_modules', '.cache', 'vue-typecheck', Bun.hash(project.configPath).toString(36))
  const mirror = (path: string) => join(cacheDir, relative(project.root, path))
  const key = Bun.hash(
    JSON.stringify([toolVersion, languageCoreVersion, project.root, project.paths, project.vueOptions], (_, value: unknown) =>
      typeof value === 'function' ? pluginName(value) : value,
    ),
  ).toString(36)

  const manifestPath = join(cacheDir, 'manifest.json')
  const previous = await readManifest(manifestPath)
  if (previous.key !== key) {
    await rm(cacheDir, { recursive: true, force: true })
    previous.files = {}
  }
  const cachedBySource = new Map(Object.entries(previous.files).map(([target, entry]) => [entry.source, { target, ...entry }]))

  const manifest: Manifest = { key, files: {} }
  const sources = new Map<string, string>()
  const fresh = new Map<string, { source: string; hash: string; script: GeneratedScript }>()
  await Promise.all(
    project.vueFiles.map(async (source) => {
      const text = await Bun.file(source).text()
      sources.set(source, text)
      const hash = Bun.hash(text).toString(36)
      const cached = cachedBySource.get(source)
      if (cached?.hash === hash && (await Bun.file(cached.target).exists())) {
        manifest.files[cached.target] = { source, hash, ...(cached.problem && { problem: cached.problem }) }
        return
      }
      const script = generate(source, text)
      if (script) fresh.set(mirror(source) + script.extension, { source, hash, script })
    }),
  )

  const problems = findSyntaxProblems(new Map([...fresh].map(([target, { script }]) => [target, script.text])))
  await Promise.all(
    [...fresh].map(async ([target, { source, hash, script }]) => {
      await mkdir(dirname(target), { recursive: true })
      const stub = mirror(source) + '.d.ts'
      const problem = problems.get(target)
      if (problem) {
        await rm(target, { force: true })
        await writeFile(stub, STUB)
        manifest.files[stub] = { source, hash, problem }
      } else {
        await rm(stub, { force: true })
        await writeFile(target, script.text)
        manifest.files[target] = { source, hash }
      }
    }),
  )
  await Promise.all(
    Object.keys(previous.files)
      .filter((target) => !(target in manifest.files))
      .map((target) => rm(target, { force: true })),
  )

  const typesDir = join(cacheDir, 'node_modules', TYPES_PACKAGE)
  if (!(await Bun.file(join(typesDir, 'package.json')).exists())) {
    await mkdir(typesDir, { recursive: true })
    await cp(join(languageCoreRoot, 'types'), typesDir, { recursive: true })
    await writeFile(join(typesDir, 'package.json'), JSON.stringify({ name: TYPES_PACKAGE, private: true }))
  }

  const nodeModules = sep + 'node_modules' + sep
  const mirrorable = (path: string) => isUnder(path, project.root) && !path.includes(nodeModules)
  const paths: Record<string, string[]> = {}
  for (const [pattern, targets] of Object.entries(project.paths)) {
    paths[pattern] = [...targets, ...targets.filter(mirrorable).map(mirror)]
  }
  const baseRootDirs = project.compilerOptions.rootDirs ?? []
  const rootDirs = [...new Set([...baseRootDirs, project.root, ...baseRootDirs.filter(mirrorable).map(mirror), cacheDir])]
  const isVue = new Set(project.vueFiles)
  const configPath = join(cacheDir, 'tsconfig.json')
  await mkdir(cacheDir, { recursive: true })
  await writeFile(
    configPath,
    JSON.stringify(
      {
        extends: project.configPath,
        compilerOptions: { rootDirs, paths },
        files: [...project.fileNames.filter((file) => !isVue.has(file) && !file.endsWith('.vue')), ...Object.keys(manifest.files)],
        include: [],
      },
      null,
      2,
    ),
  )
  await writeFile(manifestPath, JSON.stringify(manifest))

  const entries = Object.entries(manifest.files)
  return {
    configPath,
    scripts: new Map(entries.filter(([, entry]) => !entry.problem).map(([target, entry]) => [target, entry.source])),
    sources,
    unparseable: new Map(entries.flatMap(([, entry]) => (entry.problem ? [[entry.source, entry.problem] as const] : []))),
    regenerated: fresh.size,
  }
}
