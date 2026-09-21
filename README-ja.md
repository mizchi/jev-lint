# jev-lint

[English](README.md)

従来の linter には検査できなかったものを検査する linter。関数は名前どおりのことをしているか、コメントはまだ真実か、テストは名前が主張する振る舞いを本当に検証しているか。

**TypeScript、JavaScript、Rust、Python、Go** のルールを同梱し、Markdown、`package.json`、sqlc の `.sql`、git のコミットにも当たる。自作ルールは ast-grep が解析するどの言語にも書ける (Java、Kotlin、Swift、C、C++、C#、Ruby、PHP、Lua、Dart、Scala、Elixir、Haskell、Solidity、Bash、HTML、CSS、JSON、YAML)。マッチャーが ast-grep そのものだから。自分でコンパイルした tree-sitter grammar も config で宣言すれば使える ([MoonBit を含む](docs/reference.md#a-language-ast-grep-does-not-have-built-in))。

[`examples/cart.ts`](examples/cart.ts) は 38 行で、嘘が三つ入っている。`null` を返すと書いた doc コメントの下で throw する本体、文字列を返す `isEmpty`、カートを保存もしてしまう `applyDiscount`。[`examples/cart.test.ts`](examples/cart.test.ts) には、主張する振る舞いが壊れていても通るテストがある。どれも型検査は文句を言わない。

```bash
$ export TYPESAFE_API_KEY=...
$ npx -y jev-lint check examples
```

```
examples/cart.test.ts
     17  flag       This test would still pass if the behaviour its name claims were broken.
         test-name-verifies-claim  0.91  cutoff 0.62  arm bare

examples/cart.ts
     16  flag       The failure contract stated in the documentation on this function -- what it says the function throws, raises, rejects with, panics on, or returns in place of a result when something goes wrong, and under what condition -- is contradicted by the body.
         doc-errors-match-body  0.94  cutoff 0.56  arm located
     16  flag       The comment above this code claims something that is not true of the code.
         comment-describes-declaration  0.91  cutoff 0.56  arm located
     16  flag       This function ($NAME) has a failure path of its own that none of the related tests reaches.
         tests-cover-failure-paths  0.92  cutoff 0.68  arm paired
     16  flag       The body of this function does something materially different from what its name promises.
         fn-name-promises  0.56  cutoff 0.55  arm located
     22  flag       The body of this function does something materially different from what its name promises.
         fn-name-promises  0.73  cutoff 0.55  arm located
     30  flag       The body of this function does something materially different from what its name promises.
         fn-name-promises  0.78  cutoff 0.55  arm located

no files for go (9 rules), javascript (1 rule), json (1 rule), markdown (11 rules), python (12 rules), rust (8 rules), text (1 rule)
7 rule(s) matched nothing: typescript/catch-hides-failure, typescript/comment-describes-block, typescript/idempotent-name, typescript/log-level-matches-event, typescript/log-message-matches-event, typescript/pure-name-is-pure, typescript/safe-name-is-safe
  A matcher that misses is invisible everywhere else -- check these before trusting a clean run.

7 finding(s), 37 subject(s), 0 cached
7 request(s), 28,613 input tokens, $0.00120, 745 ms (4549 ms of requests)
```

finding 一件は、ルールの一文をコードの一箇所に当てたもので、モデルの同意の強さ (0.91) がルール同梱の cutoff (0.62) を超えたときに出る。`arm` はモデルに何を見せたか (`bare`: テスト単体、`located`: ファイルごと、`paired`: それを叩くテストと一緒に)。16 行目はコメントの嘘で、四つのルールが四方向から見ている。コメント、その失敗契約、名前、そして throw に届かないテスト。clean なものは一つも flag されていない。この実行は 0.1 セント。

## 何を見るか

従来の lint はパーサが決められることを決める。レビューでチームが実際に揉める規約はそういうものではない:

- **実装から乖離した名前。** カートの保存もしてしまう `applyDiscount`、文字列が束縛された `isAdmin`、期限切れトークンを一度も渡さない `rejects an expired token` というテスト。
- **嘘になったコメント。** 後のリファクタで関数から切り離された doc コメントが、もう返さない `null` を返すとまだ主張している。
- **設計の一貫性。** モジュールは中身どおりの名前か、`catch` ブロックは失敗を隠していないか、`fetch` にタイムアウトはあるか (タイムアウトを設定する retry ラッパーの中なら不要)。

どれも、コードが自分について宣言している契約と本体の両方を理解した読み手にしか見えない。jev-lint はその問いをモデルに一文ずつ投げ、cutoff を超えて返ってきたものを報告する。

コンパイラ、型検査、ESLint が既に決めていることには**使わない**。この種のモデルは自己矛盾したコードには測定可能に強く、`.sort()` の既定が辞書順であるといった特定 API の知識を要する欠陥には測定可能に弱い。そちらは既存のツールに任せる。

## 仕組み

ルールは [ast-grep](https://ast-grep.github.io) のマッチャーと一文の組。同梱の `fn-name-promises` を短縮したもの:

```yaml
- id: fn-name-promises
  languages: [TypeScript, Tsx, JavaScript, Jsx]
  kind: noul                # 固有の cutoff を持つ yes/no の述語
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
  at: 0.55
```

マッチャーは正確で、無料で、ローカルで走る。**どのコードを見るか** (名前のある関数すべて) を決めて `$NAME` を渡す。一文は**それが問題かどうか**を決め、答えるのは [Jev](https://typesafe.ai)、チャットではなくテキストについての言明を採点するために作られたモデル。`applyDiscount` がカートの保存もしているかはどのパーサにも言えないが、名前と本体を見た読み手には言えるし、ファイルを文脈として渡されたモデルにも言える。`state: located` がそのファイル、`kind: noul` は答えが「言明が成り立つ確率」であること、`at: 0.55` はラベル付きコーパスに当てはめた cutoff。

これを安く済ませているのがバッチ処理。一ファイル内のマッチはまとめて一つのリクエストで運ばれ、ファイルは一度だけ、各質問はそれ自身のテキストだけを載せて、送信前にプランナーが測るトークン予算の下に詰められる。`--dry-run` は何も送らずに、あなたのコードに対する計画と価格を出す。このリポジトリを一周するといくらかは [一周の費用](#一周の費用) に。

## そうでないもの

決定的ではないし、常に正しくもない。このリポジトリで測ると finding の五件に一件ほどは誤りで、cutoff 近くのスコアは実行ごとに数百分の一動く。jev-lint はそれを隠さず、前提として組んである:

- **判定はキャッシュされる。** ルールとコードの内容がキーなので、同じコミットへの二回の実行は一致し、CI はコミットされたキャッシュから API キーなしで lint できる。
- **`--retry 3`** は全部を三回聞き、平均で決め、毎回は再現しなかった finding を人が判断するものとして印を付ける。再試行は安い。マッチャーと計画は一度で、繰り返すのは問いだけ。
- **`--loose`** は cutoff 未満で、その半分は超えたものを列挙する。同梱ルール自身の eval では、ルールが見える欠陥を全部含み、clean は二十件に一件しか入らない帯。読む人のためのもので、finding にはならない。リクエストは増えない。`/jev-lint:review` は finding の後にこの帯を読む。
- **cutoff は自分で当てはめる。** `jev-lint gaps` はルールが clean と欠陥をそもそも分離できているかを見せ、`jev-lint calibrate --labels` はラベル付けしたコードに cutoff を当てはめ、`jev-lint replay` は記録した実行を新しい cutoff で無料に採点し直す。同梱の cutoff は出発点で、このパッケージのコーパスに当てはめたものであって、あなたのコードにではない。

finding は人が判断する候補として読む。従うべき判決ではない。

## Quick start

```bash
export TYPESAFE_API_KEY=...            # https://typesafe.ai
npx -y jev-lint check src --dry-run    # 何を聞くかと価格。リクエストは送らない
npx -y jev-lint check src              # 聞く
```

これにインストールは要らない。Node 20+。`check` は同梱ルール全部 (`rules/<language>/<id>/` の下の 65 個) を読み込み、どれが走るかは渡したファイルが決める。`.ts` には TypeScript のルールが、`.md` には Markdown のルールが当たり、ファイルの無い言語は実行の最後に idle として列挙される。選ぶものはない。

### 何が同梱され、何に当たるか

| 渡すもの | 走るもの | 聞くこと (例) |
| --- | --- | --- |
| `.ts` `.tsx` `.js` `.jsx` | `typescript/` — 21 ルール、first tier | 関数は名前どおりのことをしているか、その上のコメントはまだ真実か、主張が壊れていてもこのテストは通るか、`catch` は失敗を隠していないか |
| `.rs` | `rust/` — 8、first tier | 関数、コメント、テスト、束縛について同じこと。`# Errors` / `# Panics` と本体の突き合わせ |
| `.py` | `python/` — 12 | TypeScript ルールの移植。`Raises:` と本体の突き合わせ |
| `.go` | `go/` — 9 | 移植に加えて `must-name-panics`: `MustX` は名前が約束する失敗で panic するか |
| `.mbt` | `moonbit/` — 19 | MoonBit のファイルが持ちうるルールは全部: 命名、保証、コメント、失敗契約、ログ、テストとスナップショット。MoonBit は ast-grep 組み込みの文法ではないので、[parser を宣言](docs/reference.md#a-language-ast-grep-does-not-have-built-in)すれば動く。宣言が無ければ skip され、その旨が出る |
| `package.json` | `json/` — 1 | script の名前は実行するコマンドを表しているか |
| `.sql` (sqlc のカタログ) | `text/` — 1 | `-- name: GetUserByEmail` はその下の SQL を表しているか |
| `.md` `.mdx` | `markdown/` — 11 | この文書は slop か、filler か、曖昧か、水増しか (JevSlop の八つのシグナル、0–4 で採点)。節は次の予告で終わっていないか、議題の宣言で始まっていないか、立てた問いを放置していないか |
| コミット — `jev-lint commits` | `git/` — 1 | コミットメッセージは diff を説明しているか |

どのルールも「コードが自分について立てた主張」への一つの問いで、[RULES.md](RULES.md) に 65 個全部が、問い、cutoff、自身の fixture での成績付きで並んでいる。first tier の二言語がリリースの基準を担う。`typescript/` と `rust/` の下のルールは全部 fixture、期待値、受理済み baseline を持つ。残りは同じ基準で calibrate してあるが、まだ約束はしていない。

```bash
npx -y jev-lint check src                    # コードのルール。そこにある言語の分だけ
npx -y jev-lint check docs README.md         # markdown のルールを文章に
npx -y jev-lint commits --base main          # 各コミットのメッセージを diff と突き合わせる
npx -y jev-lint review --base main           # ブランチが触った行だけ
npx -y jev-lint rules                        # 読み込まれた全ルール: 問い、cutoff、ファイル
```

finding の読み方は[このページ冒頭](#jev-lint)のとおり。行、ルールの一文、ルール同梱の cutoff に対するモデルの同意、そして arm (何を見せたか)。cutoff 未満のスコアは finding ではなく表示もされない。`--loose` はそのすぐ下の帯を読む人のために出す。

### ルール一つだけ、または自作のルール

```bash
npx -y jev-lint run fn-name-promises src        # 同梱ルール一つ。その id を持つ全言語で
npx -y jev-lint run rust/fn-name-promises src   # ...または一言語で
npx -y jev-lint run --file myrule.yml src       # 自作のルールファイル。他は読み込まない
```

### プロジェクトに入れる

```bash
npm install --save-dev jev-lint
npx jev-lint init                     # .jev-lint.yaml を書く: files と、全ルール on
```

ESLint と同じく、config がルールを選ぶ。`init` は同梱ルール全部を on で列挙するので、要らないものを消すか off にし、変えたいものを上書きする:

```yaml
files: [src, test]
exclude: [test/fixtures]
rules:
  fn-name-promises: on
  rust/fn-name-promises: off          # id のうち一言語だけ
  comment-describes-block: { at: 0.7, severity: error }
  my-rule: warning                    # .jev-lint/rules/ から
```

id はその id を持つ全言語のルール、`lang/id` は一言語分。config があって `rules:` が無ければ何も走らず、そう言う。config が無ければ同梱ルール全部が走る。API キーは環境変数からだけ読み、このファイルからは決して読まない。`apiKey:` を書くとエラー。判定キャッシュは `.jev-lint/baseline.json` で、コミットする前提: 同じコミットへの実行はそこから答え、CI はキー無しで lint できる。`-R <dir>` はその一回だけ、同梱と `.jev-lint/rules/` の代わりにそのディレクトリを読む。

### コミット

コミットメッセージは主張で、diff はその本体。同じ種類の欠陥が、リポジトリが変更ごとに主張を書く唯一の場所に出る。

```bash
npx -y jev-lint commits --base main   # 各メッセージは diff を説明しているか
npx -y jev-lint commits               # まだ push していないコミット (@{upstream}..HEAD)
npx jev-lint init --pre-push          # push のたびにそれを走らせる hook
gh pr view --json title,body -q '.title + "\n\n" + .body' \
  | npx -y jev-lint commits --squash main..HEAD --message-file -   # PR の説明をブランチ全体と突き合わせる
```

マージでないコミット一つが一 subject。メッセージが判定対象で、diff (上限あり、stat は必ず全部、切った場合はそう明示) がその根拠。同梱ルールは `git/commit-message-describes-diff`: メッセージが修正、削除、「振る舞いの変更なし」を名乗るのに diff がそれをしていない、あるいは diff が既定値を変え、テストを落とし、依存を足しているのにメッセージが触れていない。簡潔な subject 行、本文の「ついでに」、変更に添えた lockfile、正確に逆の revert は finding にしない。

### コーディングエージェント向け

このリポジトリは skill を同梱している。jev-lint の走らせ方、どの同梱パックを使うか、検証済み 16 ルールのクックブック、calibrate の手順。エージェントはこの README を読まずに jev-lint をプロジェクトに入れたりルールを書いたりできる。このツールを見たことのないエージェント二体が、skill だけから初回で動くルールを書いた。報告された穴は skill に取り込んである。

Claude Code plugin として。`/jev-lint:review`、`/jev-lint:commits`、`/jev-lint:prose`、`/jev-lint:new-rule` も入る:

```
/plugin marketplace add mizchi/jev-lint
/plugin install jev-lint@jev-lint
```

Claude Code、Codex、Cursor、その他 [skills](https://skills.sh) CLI が知るエージェント向けの skill として、現在のプロジェクトに:

```bash
npx skills add mizchi/jev-lint --skill jev-lint
```

`--skill jev-lint` が要る。リポジトリには `jev-lint-repo` も入っていて、こちらは jev-lint 自身を変更するメンテナ用の skill で、利用者が欲しいものではない。

**ツリーではなく diff をレビューする。** review モードは diff が触った行だけを判定する。finding はどうせそこに集中するし、費用は 1 セントの端数。CI では:

```bash
jev-lint review --base "$GITHUB_BASE_REF" --format github
```

コミットごとには:

```bash
jev-lint init --pre-commit      # .git/hooks/pre-commit を書く
```

この hook は `jev-lint review --staged --fail-on error` を走らせる。コミットに含まれるものだけ、finding は全部表示、コミットを止めるのは `severity: error` のルールだけ。同梱ルールにそれは無いので、初期状態の hook は口は出すが拒否はしないレビュアー。あなたのコードでそれに値するとわかったルールから `error` に上げる。環境に API キーが無ければ黙って退く。既存の hook は上書きせず、足すべき一行を表示する。

終了コード: `0` clean、`1` finding あり、`2` 設定エラー、`3` リクエスト失敗。`--format github` では、ルールが `severity: error` と言わない限り finding は `warning` として注釈され、同梱ルールにそれは無い。ビルドを落とせる確率的レビュアーは切られる運命にある。あなたのコードで値することを示したルールから、ルール単位で上げる。

finding 一つ、またはファイル一つを黙らせるには:

```ts
// jev-lint-ignore-next-line fn-name-promises
export function summarize(rows: Row[]): Total { … }

// jev-lint-ignore-file
```

抑制された subject は送信されないので、抑制はそのトークンも節約する。

出力の二行はノイズではない。**`N rules matched nothing`** は、何にもマッチしなかったマッチャーが見える唯一の場所。このページ冒頭の実行では、TypeScript の七ルールが二ファイルの中に `catch` も log 呼び出しも `safe*` という名前も見つけられず、リストはそれを言っている (ファイルが一つも無い言語はその前の `no files for` の行で、取りこぼしではない)。**`N without a verdict`** はリクエストが失敗したということで、失敗のある実行を clean なリポジトリとは読まない。

全フラグと設定ファイルの優先順位は [docs/reference.md](docs/reference.md#commands-and-flags) に。

## 一周の費用

このリポジトリは自分自身を lint する。`.jev-lint.yaml` は同梱パックを `src`、`tools`、`test`、`package.json` に向け、埋め込み欠陥を持つ `test/fixtures` は `exclude:` で外してある。全 23 ルール、キャッシュなし、家庭回線のラップトップで一周、`docs/data/self-lint-2026-09-20.json` に記録:

| | |
| --- | --- |
| 判定した subject | 2,307 |
| リクエスト | 79、同時最大 32 |
| 入力トークン | 2,158,047 |
| 出力トークン | 44,236 |
| 価格 | $0.0906 |
| 実時間 | 5.1 s (リクエスト時間の合計 54.7 s。五回で 3.6–5.1 s) |
| モデル | `jev-1.13.0`、2026-09-20 |
| finding | 6 |

subject 1,000 件あたり 3.9 セント。同じツリーへの `--dry-run` の見積もりは 2,458,269 入力トークンで、サーバの課金より 13.9% 上。dry run は見積書ではなく予算の上限として使う。一コミットの diff への `review` は別の桁で、outline cap と sibling-deviates 節の背後の三コミットのレビューは 255,822 トークン、$0.011、8 s。

実時間はリクエスト時間を並列度で割ったものではない。サーバは入力トークンで課金し制限する。約 1.6M のバケツが毎秒 200–250k で補充され、尽きると素の 429 が返る。この実行は 2.15M なので、クライアントはそのバケツの鏡に合わせてペースを取り、その中で最大 32 リクエストを同時に送る。以前の固定並列度 4 では同じ実行が 9.6 s。32 を超えるとサーバ側の遅延が抱えている量に応じて伸び、実時間は下がらなくなる。

六件の finding のうち二件はルールの言うとおり。計算を名乗る `computeCalls` は渡された entry の全シンボルに `calls` と `calledBy` を代入し、`toRecord` は時計を読む。残り四件は cutoff から 0.17 以内で (doc コメント、パスか null を持つ束縛、テストの束縛二つ)、議論の余地がある。同じツリーへの以前の実行は、名前が「exactly one batch」と約束しながら本体は placement を数えるだけのテスト、数値を持つ `passed` というカウンタ、七箇所を試す関数の上で「four places」と数えるコメント、ラベルへのパスを持つ `labels` を捕まえた。全部直した。`jev-lint replay docs/data/self-lint-2026-09-20.json` は API キーなしでこの表を再現する。

## ルール

全ルールの cutoff、state、fixture、同梱 cutoff での precision と recall を並べた一覧が [RULES.md](RULES.md)。`npm run rules:md` が `rules/` から生成し、テストスイートが検査する。

`rules/` に 65 ルールが同梱されている。言語ごとに一ディレクトリ、その下にルールごとに一ディレクトリ、それぞれに証拠となるケース付き。プロジェクト自身の `rules/` が無いときに使われる。二言語が first tier。`typescript` (21 ルール。TypeScript、Tsx、JavaScript、Jsx を受け入れる) と `rust` (8) で、その下の全ルールが fixture、期待値、受理済み baseline を持つ。`python` (12) と `go` (9) は second tier。TypeScript ルールから同じ一文で移植し、同じ基準で calibrate してあるが、まだ約束はしていない。`javascript` (1) と `json` (1) はそこにしか収まらないもの、`git` (1) はコミットメッセージのルール、`text` (1) は sqlc クエリのルール、`markdown` (11) は文章のルール: JevSlop から移植した八つの品質シグナルと、認知リズムの文章規範からの三つの検査 (Prior art 参照)。複数言語の下にある同じ id は一つのルールの複数言語版で、その一文のコピーがずれていればローダーが警告する。以下は問いの内容で分類し、TypeScript のルール名で挙げる。各ルールがどの言語にあるかは `docs/reference.md` の表に:

**命名** — コードは自称どおりのことをしているか?

| rule | 問い |
| --- | --- |
| `fn-name-promises` | この関数の本体は名前が約束することをしているか? |
| `var-name-describes-value` | この束縛の名前は束縛された値を表しているか? |
| `test-name-describes-code` | このテストのコードは名前の言うことをしているか? |
| `test-name-verifies-claim` | 名前が主張する振る舞いが壊れていても、このテストは通るか? |
| `module-name-describes-contents` | このモジュールは中身どおりの名前か? |
| `module-naming-consistent` | このモジュールの export は同じ種類の操作に同じ語を使っているか? |
| `type-name-describes-shape` | この型の名前は、ファイルが組み立てて使うとおりのメンバーを表しているか? (セッションである `UserId`、エラーのリストである `Config`) |

**保証** — 名前が特定の約束をしている。本体は守っているか?

| rule | 問い |
| --- | --- |
| `safe-name-is-safe` | `safe*` / `try*` / `*OrNull`: 失敗はまだ throw として漏れるか? |
| `idempotent-name` | `ensure*` / `upsert*` / `register*`: 二回目の呼び出しは一回目と違うことをするか? |
| `pure-name-is-pure` | `compute*` / `format*` / `parse*` / `to*`: 本体は外に手を伸ばすか (引数の変更、キャッシュへの書き込み、時計や環境の読み取り)? |
| `catch-hides-failure` | その逆: `safe*` / `try*` / `*OrNull` と名乗って*いない*関数の `catch` が、名前や戻り型が結果を約束しているのに、既定値や空の値や何も返さない |

このパックの背後のコーパスでは、`fn-name-promises` は 22 件のラベル付き欠陥をその cutoff で一つも flag しない。一般的な問いが分離しないところを、狭い約束が分離する。

**テスト** — 構造上、名前を検証できないテスト

| rule | 問い |
| --- | --- |
| `test-mocks-subject` | タイトルが主張する振る舞いをスタブがやっていて、アサーションはスタブを読み返しているだけか? |
| `snapshot-only-behaviour-claim` | タイトルが主張する性質を、レンダ全体のスナップショットは切り出せていないか? |
| `describe-names-subject` | `describe("X")` ブロックのタイトルは、中のテストが叩くものを名指ししているか? |
| `tests-cover-failure-paths` | この export された関数に、ファイルの関連テストのどれも届かない失敗経路 (throw、reject、エラー結果、ガード) はあるか? `paired` arm 上の唯一のルールで、そのテストの抜粋を運ぶ |

テストは各フレームワークが書く形のまま認識する。jest、vitest (in-source 含む)、options オブジェクトと `t.test` サブテストを持つ node:test、Playwright の `test.describe`、三つの形の `Deno.test`、bun の `test.if`。一つの組み込みマッチャー (`matches: jev-test-call`) が全部を担い、問いにはテストの住所が付く。describe 二段の下の `it("leaves the others")` なら `suite \`cart\` > suite \`removeItem\``。

**コメント** — コメントはまだ真実か?

| rule | 問い |
| --- | --- |
| `comment-describes-declaration` | この宣言の上のコメントはまだ成り立つか? |
| `comment-describes-block` | 本体の中のコメントはその下の行を説明しているか? |
| `doc-errors-match-body` | doc の失敗契約 (JSDoc の `@throws`、docstring の `Raises:`、rustdoc の `# Errors` / `# Panics`) は本体が throw、raise、返却、panic するものと一致するか? それが*真実*かを検査するものは他にない |

**メッセージ** — 人間向けのメッセージと、コードがやること

| rule | 問い |
| --- | --- |
| `log-level-matches-event` | このログ呼び出しのレベルは、それが乗っている経路の深刻さと合っているか? |
| `log-message-matches-event` | メッセージはその経路の出来事を表しているか? (miss 側の分岐で `"cache hit"`、候補数を記録する `"deleted %d rows"`) |
| `error-message-matches-condition` | throw されるエラーのメッセージは、分岐が検査した条件を表しているか? (権限検査から出る `"user not found"`) |

**設定** — 設定ファイルの中の名前 (ast-grep は JSON と YAML を解析する)

| rule | 問い |
| --- | --- |
| `script-name-does` | この `package.json` script の名前は実行するコマンドを表しているか? |
| `commit-message-describes-diff` | このコミットのメッセージは diff を説明しているか? (`jev-lint commits`。PR の説明をブランチと突き合わせるには `--squash`) |
| `query-name-describes-sql` | sqlc クエリの `-- name:` はその下の SQL を表しているか? どの文法も解析しないファイルへの最初のルール。`subject: block` がヘッダごとにファイルを分割する |
| `must-name-panics` (Go のみ) | `Must*` 関数は、名前が約束する失敗で、返すのではなく panic するか? |

どこでも意図的に聞かないこと: スタイル、冗長さ、それが存在すべきか。軸は一つだけ。主張は偽か。

自身の eval では、65 ルール中 56 が同梱 cutoff で precision と recall 1.00 に達する。届かない九つはそれぞれ、ルールには見えないラベル付き欠陥を一つ見逃し、どれかはルールファイルに書いてある。eval は小さい。65 ルールで 467 のラベル付き欠陥、ルールあたり一から三十一。そしてマーカーは無い。以前の版は各欠陥の上、モデルに見せるファイルの中に `// DEFECT: named seconds, holds milliseconds` を置いていて、それが生む当てはめはルールより良かった。`jev-lint eval --replay` はリクエストなしで全数値を再導出する。パックがこのリポジトリ自身のコードと未見のコードで見つけたものを含む完全な表は [docs/reference.md](docs/reference.md#the-shipped-packs) に。同じ方法で作って測り、出荷しなかったルールがさらに 21 個あり、`experiments/rule-candidates/<lang>/` に同じレイアウトで、理由を書いた報告と一緒に置いてある。

## ルールを足す

ルールは YAML ファイル一つ。`.jev-lint/rules/` に置く。平置き (`.jev-lint/rules/mine.yml`) でも、fixture と baseline を横に置きたければ同梱ルールのレイアウト `.jev-lint/rules/<language>/<id>/rule.yml` でもよく、config の `rules:` で同梱ルールと同じように名指しする。ast-grep が理解するものは `rule:` にそのまま書ける。`pattern`、`kind`、`regex`、`all`/`any`/`not`、`inside`/`has`、`utils`、`constraints`:

```yaml
id: catch-hides-failure
languages: [TypeScript, Tsx]
rule:
  kind: catch_clause
subject: enclosing          # 節ではなく、マッチを囲む関数を判定する
ask: This catch block swallows a failure the caller needed to know about.
note: logging and rethrowing is fine; returning a default silently is not.
severity: info
```

ルールが機能するかは三つの決定で決まり、それぞれがフィールド:

| フィールド | 選択肢 | 答える問い |
| --- | --- | --- |
| `rule` | ast-grep の任意のマッチャー | どのコードを見るか。**わざと広くマッチさせる**: マッチャーが取りこぼしたノードは決して聞かれず、モデルが「無関係」と言う方が厳密なマッチャーより安い |
| `subject` | `node` (既定)、`enclosing`、`file` | どのコードを判定するか。最も多い失敗は、答えを含みえないコードについて聞くこと。`catch` 節単体では、その失敗が重要だったかは示せない |
| `state` | `bare`、`local`、`paired`、`located` (既定)、`graph`、`full` | モデルが他に何を見るか。品質のつまみではない。答えを含む最小の文脈。`paired` はファイルの関連テストの抜粋を足す。証拠がそこにある問い向け |

ルールが名前についてのものなら名前を capture する。`has: { field: name, pattern: $NAME }` は `$NAME` をその名でモデルに渡し、「この本体は `$NAME` が約束することをしているか」は「これは良い名前か」より鋭い問い。

それから、何かしているか確かめる:

```bash
jev-lint rules                                      # 読み込まれたか、または検証エラー
jev-lint check src --dry-run --show-subjects        # 見つけたノードと capture
jev-lint check src --at catch-hides-failure=2 --retry 3   # score は 0-3 で走る
```

### Eval: ルールに同梱するケース

cutoff は選ぶものではなく当てはめるもので、ルールは測られたケースの分しか良くない。各ルールのディレクトリが言語の下にそれを持つ:

```
rules/typescript/catch-hides-failure/
  rule.yml                 一言語。Rust 版は rules/rust/ の下に
  fixtures/handlers.ts     実コードのように読めるコード -- マーカーは入れない
  expect.yml               fixtures/handlers.ts: [{ line: 12, label: bad, window: 0, reason: "..." }]
  baseline.json            受理した実行: 回答、cutoff、ルール草稿のハッシュ
```

言語ディレクトリは自分の文法しか受け入れない (`typescript` は ECMAScript の四つ) ので、ある言語のマッチャーが別の言語のファイルに当たることはない。二言語の下の同じ id は一つのルールの二言語版。finding と `--at` で id を共有し、一文の二つのコピーがずれればローダーが警告する。first tier は `typescript` と `rust` の二言語で、その下の同梱ルールは全部 fixture、expect ファイル、受理済み baseline を持つ。他の言語ディレクトリのルールは baseline なしで出荷されることがあり、uncalibrated として列挙される。

期待値は `expect.yml` に置き、コードには決して置かない。ケースの上の `// DEFECT: named seconds, holds milliseconds` はモデルに見せるファイルの中にあり、当てはめはルールではなくラベルを測ることになる。このリポジトリ自身のコーパスがかつて 22 ルールを 1.00/1.00 と主張し、実際は 17 だったのはそれが原因。難しい clean ケース、怠惰なルールなら flag するものを入れる。

```bash
jev-lint eval rules/typescript/catch-hides-failure --repeat 3   # 三回聞き、同梱 cutoff で採点
jev-lint eval rules/typescript/catch-hides-failure --accept     # ...そしてその実行を baseline にする
jev-lint eval --replay                                 # 全ルール、リクエストなし: CI のゲート
```

採点はルールの**同梱** cutoff で、パスの平均に対して行う。出荷されているままのルールがまだケースを正しく判定するか。当てはめた cutoff は横に表示するだけで、使わない。`--replay` は現在の cutoff で全 baseline をリクエストなしに採点し直し、baseline 受理時に正しくて今は違うケース、または一文、criteria、マッチャー、subject、state がそれ以降に変わったルールで失敗する。それらの回答は別の問いへのもので、eval をもう一度走らせて受理し直す必要がある。このリポジトリの `npm run ci` はこれで終わる。

全フィールド、`score` と `noul` の違い、測定付きの state arm、一文を文法間で共有する方法は [docs/reference.md](docs/reference.md#rule-fields) に。

## さらに読む

[CHANGELOG.md](CHANGELOG.md) に全リリース、[RULES.md](RULES.md) に全同梱ルールとその当てはめ。

| | |
| --- | --- |
| [docs/reference.md](docs/reference.md) | 全フラグと全フィールド、calibrate の全容、バッチの軸、実コードで期待できること、限界 |
| [docs/deepdive.md](docs/deepdive.md) | 測定してまだ真であること全部と、その証拠 |
| [docs/internal.md](docs/internal.md) | コードの仕組み。変更する人向け |
| [docs/findings.md](docs/findings.md) | ノート。起きた順に、間違った寄り道も含めて |

## Prior art

モデルに lint の問いを投げる発想は [mizchi/jev-playground](https://github.com/mizchi/jev-playground) の `eslint-plugin-jev` から。ここで違うのは、単一ノードの ESLint セレクタではなく関係を持つ多言語マッチャー、ESLint のファイル単位同期コールバックではなく専用ランナー、diff に絞った review モード、固定の選択ではなく測定した軸としての state arm、そして閾値を監査可能にする record/replay。

同じモデルの上の姉妹プロジェクト二つがこのツールの一部を形作っていて、並べて読む価値がある:

- [devagrawal09/jev-review](https://github.com/devagrawal09/jev-review) — パッチ全体をスクリーニングし、最も強いシグナルを `choice` と `score` の問いで追うレビューワークフロー。構造化 criteria、screen-then-classify の形 (`--explain`、`--loose`)、テストギャップのスクリーン (`paired` arm と `tests-cover-failure-paths`)、diff の subject (`jev-lint commits`) はそこから取って、ここで測った。それぞれの測定結果は `docs/findings.md` §14 に。
- [TKY-27/JevSlop](https://github.com/TKY-27/JevSlop) (MIT) — note.com 記事の AI Slop Score: 八つの文章品質シグナルと記事全体の判定一つ、それぞれ五段階のルーブリック。`rules/markdown/` の九ルールはそのルーブリックを、高スコアが常にルールの名指す欠陥を意味するようそのまま、または反転させて、Markdown ファイル全体に適用したもの。欠陥ではなく量を名指していた二つのルーブリックは分離するまで言い換えが必要で、その方法はルールファイルに書いてある。JevSlop が自身について言うとおり、文章の特性であって、著者の確率ではない。
- [k16shikano の認知リズムの文章規範](https://gist.github.com/k16shikano/eb2929f13ed19c97188393d297be8432) — 説明文のための日本語の規範で、その執筆後チェックはこのツールがコードに投げる問いを投げる。文は主題を更新しているか、それとも文書を更新しているだけか? `rules/markdown/` の三ルールがその検査 (`section-ends-with-a-preview`、`section-opens-with-an-agenda`、`document-abandons-a-question`)、さらに二つが出荷しない理由付きの候補で、`/jev-lint:prose` は規範の機械的な漏出テストと並べてこれらを走らせる。規範のジャンル (記事と章) を前提に読むので、リファレンスや findings のログがリファレンスらしいことをしていると flag する。

MIT.
