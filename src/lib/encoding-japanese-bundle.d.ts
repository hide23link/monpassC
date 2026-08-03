// encoding-japanese's default entry (src/index.js) does
// `require('../package.json').version`, which fails to resolve under
// @cloudflare/vitest-pool-workers' workerd-based module loader (works fine
// under wrangler's own esbuild bundler, but not here) — see PLAN.md risk #3
// discussion. The package also ships a self-contained browserify bundle
// (encoding.js) with package.json inlined as an internal numbered module,
// which resolves fine in both environments. This re-exports the same
// @types/encoding-japanese declarations for that bundle's import path.
declare module "encoding-japanese/encoding.js" {
  import Encoding from "encoding-japanese";
  export default Encoding;
}
