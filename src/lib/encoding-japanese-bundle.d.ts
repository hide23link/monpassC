// encoding-japaneseの通常のエントリポイント(src/index.js)は内部で
// `require('../package.json').version` を呼んでおり、これが
// @cloudflare/vitest-pool-workersのworkerdベースのモジュールローダーでは
// 解決に失敗する(wrangler本体のesbuildバンドラー経由では問題なく動く)。
// このパッケージにはpackage.jsonを内部モジュールとして埋め込んだ、
// browserify製の自己完結バンドル(encoding.js)も同梱されており、こちらは
// 両方の環境で問題なく解決できる — src/lib/csv.tsがパッケージ名そのままでは
// なく"encoding-japanese/encoding.js"からimportしているのはこのため。
// このファイルは、そのバンドル用のimportパスに対してTypeScriptの型が
// 存在しないため、@types/encoding-japaneseと同じ型定義を再エクスポートしている。
declare module "encoding-japanese/encoding.js" {
  import Encoding from "encoding-japanese";
  export default Encoding;
}
