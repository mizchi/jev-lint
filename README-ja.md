# jev-lint

[English](README.md)

[Jev](https://typesafe.ai/) — 自然言語の問いに、テキストではなく較正された確率を返す高速な分類器 — を使って、パーサには決められないことを決める lint ツール。

この関数は間違っている。そして、手元のどのツールもそれを言わない。

```ts
/** Returns the cart, or null when no cart has this id. */
export function getCart(id: string): Cart {
  const cart = carts.get(id);
  if (!cart) throw new Error(`no cart ${id}`);
  return cart;
}
```

コメントは `null` を返すと約束している。本体は throw する。戻り値型は `Cart | null` ですらなく `Cart` だ。型検査も lint も通る。

jev-lint のルールは一文でできている。[ast-grep](https://ast-grep.github.io) のマッチャーがどのコードを見るかを決め、その一文 — ここでは *the comment above this code claims something that is not true of the code* — をモデルに問い、確率が返る。**判定されるコードは API に送られる**。キーはその代金で、手元で動くのはマッチャーだけ。

```bash
export TYPESAFE_API_KEY=...            # https://typesafe.ai
npx -y jev-lint check examples
```

```
examples/cart.ts
     16  flag  The comment above this code claims something that is not true of the code.
         comment-describes-declaration  0.89  cutoff 0.56
...
```

0.89 はモデルの同意の強さ、0.56 はこのルールが同梱する cutoff で、これを下回ったものは報告されない。2 ファイルで finding 六件、0.1 セント。[もっと大きい実行の費用](docs/cost.md)は外挿ではなく実測してある。

## 何を捕まえるか

48 の問いが出荷されていて、その多くは複数言語で聞かれる（合わせて 99 ルール）。おおまかには:

- **名前と、その名前が指すもの。** 関数、メソッド、束縛、型、クラス、trait、モジュール。npm script とそれが走らせるコマンド。sqlc のクエリ名とその SQL。カートの保存もしてしまう `applyDiscount`、文字列が束縛された `isAdmin`。
- **名前が含意する保証。** `safe*` は安全か、`pure*` は純粋か、冪等を名乗る関数は冪等か、Go の `MustX` は名前が約束する失敗で panic するか。
- **コメントと、その下のコード。** 宣言の上の doc コメント、ブロック内のコメント、そして宣言された失敗契約 (`@throws`、`# Errors`、`Raises:`) と本体。
- **テストと、それが主張していること。** 名前が主張する振る舞いが壊れていても通るテスト、どのテストも到達しない失敗パス、振る舞いの主張の代わりに置かれたスナップショット、対象を置き換えてしまったモック。
- **黙ってしまう失敗。** 失敗を隠す `catch`、条件と噛み合わないエラーメッセージ、イベントと噛み合わないログレベル。
- **シェルスクリプトが、読み手に見えない形でマシンに何をするか。** ダウンロードしたコードの実行、渡されていない秘密の読み取り、永続化の設置、自分の範囲を越える削除、防御の無効化、侵入口の開放、外部からの命令の受け取り、実行内容の隠蔽。
- **その文書は読む価値があるか。** slop、埋め草、水増し、曖昧さ。扱う内容の一覧で始まる節、次回予告で終わる節。
- **`AGENTS.md` を実行できるか。** 各節の指示が明瞭で、ファイル内のほかの指示と矛盾しないか。
- **コミットメッセージと、その diff。** そして **変更と、リポジトリが自分のために書いた指示** — その変更自身のツリーにある `AGENTS.md`。なければ `CLAUDE.md` を使う。ただし diff に照らせる指示だけで、「生成ファイルを手で編集しない」は裁き、「TDD で書く」は裁かない。

[RULES.md](RULES.md) に全部ある。各ルールの cutoff と、自分の fixtures での成績付きで。これらが一つの族なのは、どれも**コードが自分について宣言している主張**を、コードが実際にやっていることに照らすからだ。その照合は、両方を読んだ読み手にしか見えない。

コンパイラ、型検査、ESLint が既に決めていることには**使わない**。この種のモデルは自己矛盾したコードには強く、`.sort()` の既定が辞書順であるといった特定 API の知識を要する欠陥には弱い。[測定と証拠](docs/deepdive.md)。そちらは既存のツールに任せる。

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
| `jev-lint commits --base main` | 各コミットのメッセージを diff に、各変更をリポジトリ自身の `AGENTS.md` に照らす |
| `jev-lint commits --staged` | staged の変更をリポジトリの指示と照合。コミットメッセージはまだない |
| `jev-lint run typescript/fn-name-promises src` | ルール一つ。自作なら `--file mine.yml` |
| `jev-lint rules` | 読み込まれた全ルール。問い、cutoff、ファイル |

ルールを選ぶのは config で、ESLint と同じ形。`init` は同梱ルールを全部 on にして書き出すので、そこから削る:

```yaml
files: [src, test]
exclude: [test/fixtures]
rules:
  typescript/fn-name-promises: on
  rust/fn-name-promises: off
  typescript/comment-describes-block: { threshold: 0.7, severity: error }
```

回答値が `threshold` 以上なら finding になる。旧名の `at` も警告付きで読み込む。
`hooks.precommit` では、この `rules:` を継承するか、staged review 専用のルールを選べる。
詳しくは [hook の説明](docs/use-hooks.md)。

言語別ルールは `language/id` で指定する。省略した同梱 id も全言語を選ぶが、
意図しない言語まで有効になるため警告を出す。言語名前空間のない自作ルールは例外。

finding 一つ、またはファイル一つを黙らせるには、どのコメント構文でも:

```ts
// jev-lint-ignore-next-line fn-name-promises
// jev-lint-ignore-file
```

抑制された subject は送られないので、抑制はトークンの節約にもなる。

**CI と git hook** — `review --base "$GITHUB_BASE_REF" --format github` が PR に注釈を付ける。`jev-lint init --pre-commit` と `--pre-push` が hook を書く。どちらもルールを `severity: error` に上げるまでブロックしないし、同梱ルールにそれを持つものは無い。[docs/use-hooks.md](docs/use-hooks.md) に詳細があり、オフラインだとコミットが止まる終了コードの話もそこにある。

## 何が同梱されるか

`rules/<language>/<id>/` の下に 99 ルール。どれが走るかは渡したファイルが決める。選ぶものはない。

| 渡すもの | 走るもの |
| --- | --- |
| `.ts` `.tsx` `.js` `.jsx` | `typescript/` — 23 ルール、第一級 |
| `.rs` | `rust/` — 9、第一級 |
| `.py` `.go` | `python/` — 14、`go/` — 9 |
| `.mbt` | `moonbit/` — 20。[パーサを宣言](docs/reference.md#a-language-ast-grep-does-not-have-built-in)すれば走る |
| `.sh` `.bash` `.zsh` | `shell/` — 8。スクリプトが読み手に見えない形でマシンに何をするか |
| `.md` `.mdx` | `markdown/` — 11 の文章ルール |
| `package.json`、sqlc の `.sql` | `json/` — 1、`text/` — 1 |
| コミット | `git/` — 2 |

`typescript` と `rust` が第一級で、その下の全ルールが fixtures、expectations、受理済み baseline を持つ。残りは同じ基準で較正済みだが、まだ約束はしていない。[RULES.md](RULES.md) に 99 個全部の問い、cutoff、自分の fixtures での成績がある。

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

リポジトリは skill を同梱している。jev-lint の走らせ方と同梱ルールの使い方に加え、各リポジトリでコード、独自 grammar、テキスト、Git のルールを作るための独立したガイドがある:

[プロジェクトごとのルール作成ガイド](skills/jev-lint/references/writing-project-rules.md)

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
