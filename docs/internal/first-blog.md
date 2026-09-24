## jev-lint とは

今までの Lint ができなかったこととして、命名の一貫性のチェックや、テストコードやコメントが嘘になっていることを検知できない、という問題がありました。

それに対して、 jev-lint というツールを作りました。

https://github.com/mizchi/jev-lint

`npx -y jev-lint` で動きます。

中身は、ast-grep のセレクタで抽出されたコードに対して、自然言語で書いたルールで、jev でバッチでスコアを評価します。

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
  threshold: 0.86
```


node.js で作りましたが、ast-grep に対応してる言語なら全部対応。`npx -y jev-lint` もしくは `npm install jev-lint` で入れてください。

依存は Node 24+ と TYPESAFE_API_KEY だけです。ast-grep は npm 依存として一緒に入ります。
プリセットのルールは現時点で 6 pack 23 ルール。ラベル付き corpus に対して閾値を fit してあり、23 のうち 17 は corpus 上で precision / recall 1.0 ですが、corpus は小さいので、自分のコードでは再フィットする前提です。ここから増やしていきます。

## 拡張できることの例

- 関数名とその実装が一致してるかを評価
- テスト名と、テスト内容が一致してるかを評価
- コメントが実装内容に沿ってるかを確認
- 嘘のプリントデバッグメッセージを出力してないか
- 事前に指定されたアンチパターンの検出

既存の静的な Lint でできない事に注力しています

## できないこと

- 再現性のあるスコアリング
  - 言語理解はLLM なので、モデルの性能でブレます
  - 代わりに `--retry n` で n 回聞いて平均で判定し、`--record` で一度記録した答えは `replay` で閾値を変えて無料で再採点できるようにしています
- ロングコンテキストの文脈的な理解
  - Jev のリクエストは 64K トークン、state は 32K トークンが上限なので、同じファイル程度の短いコンテキストしか扱えません
  - 短いコンテキストの非決定的な検査を大量にやることに特化しています

## なぜ Jev でやったか - その最適化

jev の特性として、一つの State に対して大量の質問をまとめて投げられます (1 リクエストで 1,220 問通ることを確認済み)。jev-lint はデフォルトで 1 state に 256 問まで詰めます。

- ast-grep を使って、ast-grep selector ルールからコード断片を収集
- コード断片に対して、ルールごとにスコアを計算
- 閾値を満たさなければ失敗
- diff mode: 現在の diff に限定してルールを一括で投げる

デフォルトはファイル単位のバッチ (ファイルを 1 回送って、その中の全マッチを聞く) です。`--group auto` を付けると、ルール単位のバッチとどちらが安いかを送る前に見積もって選びます。ルール単位はリクエスト数が減る代わりに精度が少し落ちるので、デフォルトにはしていません。

## コスト感

jev-lint 自体に、ビルトインのルールで検査を掛けたところ、

- 約 9,800 行、23 ルール、1,950 subject に対して、7.7 秒掛かって約 8 円 ($0.055)
- 1 関数の diff に絞って検査して 0.02 円、数ファイルの diff で 0.1〜1 円

`--dry-run` で送る前に見積もれますが、実測より 1 割ほど高めに出ます。あくまで参考値です。繰り返しコード全文を送るような用途だとさすがに膨れそうですね。

これを作ってる過程で、typesafe の最初に配られた $5 の最初のトークンを使い切りました。

## 感想

jev を使った新規性と実用性を考えたとき、やはり「静的検査で取りこぼす処理に、脳を入れて対応する」というのが、自分にとっては一番自然に思えました。

前に作った Similarity も、結局がコピペを繰り返す対策だったので、AIに対する検査器を書く、というのは今後も重要だと考えています。(そのルール自体もAIに考えさせてますが...)

https://github.com/mizchi/similarity


決定的なスコアや閾値設定ではない、という点はやはりネックではあるんですが、precommit hook や、PR ごとにAIに対してアドバイザリーとして挟むぐらいなら現実的に扱えそうです。ここはドッグフーディングしながら育てます。


jev-lint 単独で既存の Lint が不要になるとは全く思ってないですが、今までできなかったことが高速に安価に出来るサンプルになるんじゃないでしょうか。

