import ts from '@typescript/typescript6'
import type {} from '@volar/typescript'
import { type CodeInformation, createVueLanguagePlugin, SourceMap } from '@vue/language-core'

import type { Project } from './project'

/** One SFC's TypeScript service script and its map back to the .vue source. */
export interface GeneratedScript {
  text: string
  /** `.ts`, `.tsx`, `.js` or `.jsx`, after the SFC's script lang. */
  extension: string
  map: SourceMap<CodeInformation>
}

export type Generate = (sourcePath: string, sourceText: string) => GeneratedScript | undefined

/**
 * The service script is what vue-tsc and the Vue editor extension check for an SFC: script blocks,
 * the template compiled to TypeScript, and Volar mappings carrying the "should report" rules.
 * Codegen is per file and needs nothing from other files.
 */
export function createGenerator(project: Project): Generate {
  const plugin = createVueLanguagePlugin<string>(ts, project.compilerOptions, project.vueOptions, (id) => id)
  return (sourcePath, sourceText) => {
    const root = plugin.createVirtualCode?.(sourcePath, 'vue', ts.ScriptSnapshot.fromString(sourceText), {
      getAssociatedScript: () => undefined,
    })
    const serviceScript = root && plugin.typescript?.getServiceScript(root)
    if (!serviceScript) return undefined
    const { snapshot, mappings } = serviceScript.code
    return {
      text: snapshot.getText(0, snapshot.getLength()),
      extension: serviceScript.extension,
      map: new SourceMap<CodeInformation>(mappings),
    }
  }
}
