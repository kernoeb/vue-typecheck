import { describe, expect, test } from 'bun:test'

import { parseCheckerOutput, stoppedBeforeTypeChecking } from '../src/checkers'

/* Real outputs, trimmed: the parser is the contract with two external tools' text formats. */
const TSC = `src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.
src/b.ts(10,1): error TS2345: Argument of type 'string | number' is not assignable to parameter of type 'number'.
  Type 'string' is not assignable to type 'number'.
error TS5083: Cannot read file '/x/tsconfig.base.json'.
`

const BUN = `src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.
src/b.vue.ts(58,50): error TS1003: Identifier expected.
note: Stopped before type checking 5 files. Fix the errors above to see the rest.
Found 2 errors in 2 files, checked 0 files [29.12ms]

  1  src/a.ts:3
  1  src/b.vue.ts:58
`

describe('parseCheckerOutput', () => {
  test('tsc: positions, codes and multi-line messages; global errors have no file', () => {
    expect(parseCheckerOutput(TSC, '/p')).toEqual([
      { file: '/p/src/a.ts', line: 3, column: 7, code: 2322, message: "Type 'string' is not assignable to type 'number'." },
      {
        file: '/p/src/b.ts',
        line: 10,
        column: 1,
        code: 2345,
        message:
          "Argument of type 'string | number' is not assignable to parameter of type 'number'.\n  Type 'string' is not assignable to type 'number'.",
      },
      { file: '', line: 0, column: 0, code: 5083, message: "Cannot read file '/x/tsconfig.base.json'." },
    ])
  })

  test('bun check: the summary and its file table are not diagnostics', () => {
    expect(parseCheckerOutput(BUN, '/p').map((diagnostic) => `${diagnostic.file}:${diagnostic.line}:${diagnostic.code}`)).toEqual([
      '/p/src/a.ts:3:2322',
      '/p/src/b.vue.ts:58:1003',
    ])
  })
})

describe('stoppedBeforeTypeChecking', () => {
  test('bun check saying it type-checked nothing is detected; a normal run is not', () => {
    expect(stoppedBeforeTypeChecking(BUN)).toBe('note: Stopped before type checking 5 files. Fix the errors above to see the rest.')
    expect(stoppedBeforeTypeChecking(TSC)).toBeUndefined()
  })
})
