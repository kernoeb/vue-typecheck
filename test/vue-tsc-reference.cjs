// Reference run: vue-tsc on the TypeScript 6 JS API. Needs Node: under Bun, vue-tsc's patch of
// tsc.js (it hooks fs.readFileSync while Node loads the module) never fires and the Vue plugin is
// silently skipped. Usage: node test/vue-tsc-reference.cjs --noEmit -p <tsconfig>
require('vue-tsc').run(require.resolve('@typescript/old/lib/tsc'))
