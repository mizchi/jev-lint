## jev-lint とは

tree-sitter のセレクタで抽出されたコードに対して、自然言語で書いたルールで、jev でバッチでスコアを評価します。

たとえば、関数名がその実装と噛み合った命名かどうかを評価する例です。

```
- id: fn-name-promises
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul                # a yes/no predicate with its own cutoff
  rule:
    kind: function_declaration
    has: { field: name, pattern: $NAME }
  ask: >-
    The body of this function does something materially different from what
    its name promises.
  criteria:
    "true": >-
      Someone who read only the name and the parameter list would be wrong
      about what this function does: it changes state when the name says it
      only reads, it can fail when the name promises a value, it handles a
      narrower case than the name claims, or it does substantial work the
      name does not mention.
    "false": >-
      The name and parameter list describe what the body actually does.
  state: located
  at: 0.83
```

注意点として、基本の仕組みはしっかり作ったつもりですが、プリセットのルール自体はまだ練られていません。それはここから増やしていきます。

node.js で書いてますが、ast-grep に対応してる言語なら全部対応。`npx -y jev-lint` もしくは `npm install jev-lint` で入れてください。

依存として、ast-grep と TYPESAFE_API_KEY が必要になります。

## できることの例

- 関数名とその実装が一致してるかを評価
- テスト名と、テスト内容が一致してるかを評価
- コメントが実装内容に沿ってるかを確認
- 事前に指定されたアンチパターンの検出

既存の静的な Lint でできない事に注力しています

## できないこと

- 再現性のあるスコアリング
  - 解釈はLLM なので、ブレます
  - 代わりに何度も同じリプレイして、テストが落ちる閾値を自動調整できるようにしています
- ロングコンテキストの文脈的な理解
  - 125k の推論がないモデルなので、同じファイル程度の短いコンテキストしか扱えません
  - ショートコンテキストの非決定的な検査に特化しています

## なぜ Jev でやったか - その最適化

jev の特性として、一つの State に対して、256個の評価基準を計算することができます。

- ast-grep を使って、ast-grep selector ルールからコードコード断片を収集
- コード断片に対して、ルールごとにスコアを計算
- 閾値を満たさなければ失敗
- diff mode: 現在の diff に限定してクエリを投げます。

コスト感ですが、jev-lint 自体に検査を掛けたところ、

- 6600行の時点の実装に対して、15ルールで検査、7秒掛かって約7円
- 130行の diff に絞って検査して、 0.03円

あくまで参考値です。繰り返しコード全文を送るような用途だとさすがに厳しいです。



毎秒やるのはしんどいですが、PR ごとにアドバイザリーとして挟むぐらいなら現実的で

