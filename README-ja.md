# jev-lint

[English](README.md)

従来の linter には検査できなかったものを検査する linter。関数は名前どおりのことをしているか、コメントはまだ真実か、テストは名前が主張する振る舞いを本当に検証しているか。

[`examples/cart.ts`](examples/cart.ts) は 38 行で、嘘が三つ入っている。`null` を返すと書いた doc コメントの下で throw する本体、文字列を返す `isEmpty`、カートを保存もしてしまう `applyDiscount`。[`examples/cart.test.ts`](examples/cart.test.ts) には、主張する振る舞いが壊れていても通るテストがある。どれも型検査は文句を言わない。

```bash
export TYPESAFE_API_KEY=...            # キーは https://typesafe.ai で取る
npx -y jev-lint check examples
```

```
examples/cart.test.ts
     17  flag       This test would still pass if the behaviour its name claims were broken.
         test-name-verifies-claim  0.90  cutoff 0.62  arm bare

examples/cart.ts
     16  flag       The failure contract stated in the documentation on this function -- what it says the function throws, raises, rejects with, panics on, or returns in place of a result when something goes wrong, and under what condition -- is contradicted by the body.
         doc-errors-match-body  0.94  cutoff 0.56  arm located
     16  flag       The comment above this code claims something that is not true of the code.
         comment-describes-declaration  0.89  cutoff 0.56  arm located
     16  flag       This function ($NAME) has a failure path of its own that none of the related tests reaches.
         tests-cover-failure-paths  0.93  cutoff 0.68  arm paired
     22  flag       The body of this function does something materially different from what its name promises.
         fn-name-promises  0.73  cutoff 0.55  arm located
     30  flag       The body of this function does something materially different from what its name promises.
         fn-name-promises  0.71  cutoff 0.55  arm located

6 finding(s), 37 subject(s), 0 cached
7 request(s), 28,542 input tokens, $0.00120, 1791 ms (5678 ms of requests)
```

finding 一件は、ルールの一文をコードの一箇所に当てたもので、モデルの同意の強さ (0.90) がルール同梱の cutoff (0.62) を超えたときに出る。`arm` はモデルに何を見せたか (`bare`: テスト単体、`located`: ファイルごと、`paired`: それを叩くテストと一緒に)。16 行目はコメントの嘘で、三つのルールが三方向から見ている。コメント、その失敗契約、そして throw に届かないテスト。clean なものは一つも flag されていない。この実行は 0.1 セント。

## 何を捕まえるか

レビューでチームが実際に揉める規約、つまりパーサが決められないもの:

- **実装から乖離した名前。** カートの保存もしてしまう `applyDiscount`、文字列が束縛された `isAdmin`、期限切れトークンを一度も渡さない `rejects an expired token` というテスト。
- **嘘になったコメント。** 後のリファクタで関数から切り離された doc コメントが、もう返さない `null` を返すとまだ主張している。
- **設計の一貫性。** モジュールは中身どおりの名前か、`catch` ブロックは失敗を隠していないか、`fetch` にタイムアウトはあるか (タイムアウトを設定する retry ラッパーの中なら不要)。

どれも、コードが自分について宣言している契約と本体の両方を理解した読み手にしか見えない。

コンパイラ、型検査、ESLint が既に決めていることには**使わない**。この種のモデルは自己矛盾したコードには測定可能に強く、`.sort()` の既定が辞書順であるといった特定 API の知識を要する欠陥には測定可能に弱い。そちらは既存のツールに任せる。

## 導入

試すだけならインストールは要らない。Node 24+ と `npx` があればいい。プロジェクトに入れるなら:

```bash
npm install --save-dev jev-lint
npx jev-lint init                      # .jev-lint.yaml を書く
npx jev-lint check src --dry-run       # 何を聞くかと値段。リクエストは飛ばない
```

キーを読み込むのは環境変数からだけで (`TYPESAFE_API_KEY` か `TYPESAFEAI_API_KEY`)、config ファイルからは読まない。config はバージョン管理に入るものであり、キーはそうではないから。モデルに聞かない操作はキー無しで動く。`--dry-run` は値段を出し、`jev-lint rules` は何が走るかを並べ、`jev-lint replay` は記録済みの実行を採点し直し、CI はコミット済みキャッシュからキー無しで lint できる。

## 使う

| | |
| --- | --- |
| `jev-lint check src` | ファイル全体を裁く |
| `jev-lint review --base main` | diff が触れた行だけ。finding が集中する場所を、ごく安く |
| `jev-lint commits --base main` | 各コミットのメッセージを、その diff に照らす |
| `jev-lint run fn-name-promises src` | ルール一つ。自作なら `--file mine.yml` |
| `jev-lint rules` | 読み込まれた全ルール。問い、cutoff、ファイル |

ルールを選ぶのは config で、ESLint と同じ形。`init` は同梱ルールを全部 on にして書き出すので、そこから削る:

```yaml
files: [src, test]
exclude: [test/fixtures]
rules:
  fn-name-promises: on
  rust/fn-name-promises: off          # その id の一言語だけ
  comment-describes-block: { at: 0.7, severity: error }
```

finding 一つ、またはファイル一つを黙らせるには、どのコメント構文でも:

```ts
// jev-lint-ignore-next-line fn-name-promises
// jev-lint-ignore-file
```

抑制された subject は送られないので、抑制はトークンの節約にもなる。

**CI と git hook** — `review --base "$GITHUB_BASE_REF" --format github` が PR に注釈を付ける。`jev-lint init --pre-commit` と `--pre-push` が hook を書く。どちらもルールを `severity: error` に上げるまでブロックしないし、同梱ルールにそれを持つものは無い。[docs/use-hooks.md](docs/use-hooks.md) に詳細があり、オフラインだとコミットが止まる終了コードの話もそこにある。

## 何が同梱されるか

`rules/<language>/<id>/` の下に 98 ルール。どれが走るかは渡したファイルが決める。選ぶものはない。

| 渡すもの | 走るもの |
| --- | --- |
| `.ts` `.tsx` `.js` `.jsx` | `typescript/` — 23 ルール、第一級 |
| `.rs` | `rust/` — 9、第一級 |
| `.py` `.go` | `python/` — 14、`go/` — 9 |
| `.mbt` | `moonbit/` — 20。[パーサを宣言](docs/reference.md#a-language-ast-grep-does-not-have-built-in)すれば走る |
| `.sh` `.bash` `.zsh` | `shell/` — 8。スクリプトが読み手に見えない形でマシンに何をするか |
| `.md` `.mdx` | `markdown/` — 11 の文章ルール |
| `package.json`、sqlc の `.sql` | `json/` — 1、`text/` — 1 |
| コミット | `git/` — 1 |

`typescript` と `rust` が第一級で、その下の全ルールが fixtures、expectations、受理済み baseline を持つ。残りは同じ基準で較正済みだが、まだ約束はしていない。[RULES.md](RULES.md) に 98 個全部の問い、cutoff、自分の fixtures での成績がある。

自作ルールは ast-grep が解析するどの言語にも書ける (Java、Kotlin、Swift、C、C++、C#、Ruby、PHP、Lua、Dart、Scala、Elixir、Haskell、Solidity、HTML、CSS、YAML)。自分でコンパイルした grammar も使える。

## 決定的ではないし、常に正しくもない

このリポジトリで測ると、finding 五件に一件ほどが誤りで、cutoff 近傍のスコアは実行ごとに数百分の一動く。jev-lint はそれを誤魔化さずに前提として作られている。判定はルールとコードの内容で**キャッシュ**され、`--retry 3` は三回の**平均**で決めて再現しなかったものに印を付け、`--loose` は cutoff 直下の帯を finding にせず読み手に見せ、**cutoff は自分で当てはめるもの**だ。同梱の cutoff はこのパッケージのコーパスに当てはめたもので、あなたのコードのものではない。

finding は人間が判断するための候補であって、実行すべき判決ではない。

## ルールを書く

ast-grep のマッチャーが**どのコードを見るか**を決め、一文が**それが問題かどうか**を決める:

```yaml
id: catch-hides-failure
languages: [TypeScript, Tsx]
rule: { kind: catch_clause }
subject: enclosing          # マッチした節ではなく、その外側の関数を裁く
ask: This catch block swallows a failure the caller needed to know about.
```

[docs/writing-rules.md](docs/writing-rules.md) が手順で、ルールが同梱する fixtures と当てはめた cutoff もそこにある。

## コーディングエージェント向け

リポジトリは skill を同梱している。jev-lint の走らせ方、どのパックを使うか、検証済みルールのクックブック、較正の手順:

```bash
npx skills add mizchi/jev-lint --skill jev-lint
```

`--skill jev-lint` が重要。このリポジトリは `jev-lint-repo` も抱えていて、そちらは jev-lint 自体を変更するためのメンテナ向け skill。Claude Code plugin として入れると `/jev-lint:review`、`/jev-lint:commits`、`/jev-lint:prose`、`/jev-lint:new-rule` も入る:

```
/plugin marketplace add mizchi/jev-lint
/plugin install jev-lint@jev-lint
```

## ドキュメント

| | |
| --- | --- |
| [RULES.md](RULES.md) | 同梱ルール全部、cutoff と当てはめ |
| [docs/reference.md](docs/reference.md) | 全フラグと全フィールド、calibrate、バッチ、限界 |
| [docs/use-hooks.md](docs/use-hooks.md) | git hook と CI |
| [docs/writing-rules.md](docs/writing-rules.md) | ルールの書き方と、同梱する eval |
| [docs/cost.md](docs/cost.md) | 一周の費用、実測 |
| [docs/deepdive.md](docs/deepdive.md) | 測定してまだ真であること全部と、その証拠 |
| [CHANGELOG.md](CHANGELOG.md) | 全リリース |

`docs/internal/` はこのリポジトリを変更する人向け。アーキテクチャ、findings のノート、計画と仕様。

## Prior art

モデルに lint の問いを投げる発想は [mizchi/jev-playground](https://github.com/mizchi/jev-playground) の `eslint-plugin-jev` から。ここで違うのは、単一ノードの ESLint セレクタではなく関係を持つ多言語マッチャー、ESLint のファイル単位同期コールバックではなく専用ランナー、diff に絞った review モード、固定の選択ではなく測定した軸としての state arm、そして閾値を監査可能にする record/replay。

同じモデルの上の姉妹プロジェクト二つがこのツールの一部を形作っていて、並べて読む価値がある:

- [devagrawal09/jev-review](https://github.com/devagrawal09/jev-review) — パッチ全体をスクリーニングし、最も強いシグナルを `choice` と `score` の問いで追うレビューワークフロー。構造化 criteria、screen-then-classify の形 (`--explain`、`--loose`)、テストギャップのスクリーン (`paired` arm と `tests-cover-failure-paths`)、diff の subject (`jev-lint commits`) はそこから取って、ここで測った。それぞれの測定結果は `docs/internal/findings.md` §14 に。
- [TKY-27/JevSlop](https://github.com/TKY-27/JevSlop) (MIT) — note.com 記事の AI Slop Score: 八つの文章品質シグナルと記事全体の判定一つ、それぞれ五段階のルーブリック。`rules/markdown/` の九ルールはそのルーブリックを、高スコアが常にルールの名指す欠陥を意味するようそのまま、または反転させて、Markdown ファイル全体に適用したもの。欠陥ではなく量を名指していた二つのルーブリックは分離するまで言い換えが必要で、その方法はルールファイルに書いてある。JevSlop が自身について言うとおり、文章の特性であって、著者の確率ではない。
- [k16shikano の認知リズムの文章規範](https://gist.github.com/k16shikano/eb2929f13ed19c97188393d297be8432) — 説明文のための日本語の規範で、その執筆後チェックはこのツールがコードに投げる問いを投げる。文は主題を更新しているか、それとも文書を更新しているだけか? `rules/markdown/` の三ルールがその検査 (`section-ends-with-a-preview`、`section-opens-with-an-agenda`、`document-abandons-a-question`)、さらに二つが出荷しない理由付きの候補で、`/jev-lint:prose` は規範の機械的な漏出テストと並べてこれらを走らせる。規範のジャンル (記事と章) を前提に読むので、リファレンスや findings のログがリファレンスらしいことをしていると flag する。

MIT.
