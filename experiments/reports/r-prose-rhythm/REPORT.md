# Family R: prose rhythm -- five rules from k16shikano's "cognitive rhythm" norm

Five shipped `rules/markdown/` rules, one corpus. The source is the
"認知リズムを生むための日本語ライティング規範" gist
(<https://gist.github.com/k16shikano/eb2929f13ed19c97188393d297be8432>),
whose section 「緩みと駄文の見分け方」 gives one test -- does a sentence
update the SITUATION (the subject, its data, the narrator's state of
judgment) or the DOCUMENT (what the text will do, what it is not, how it
looks so far, which device it is using) -- a typology of six filler forms,
four allowed document-facing exceptions, and a warning that the commonest
way filler survives an edit is as a short, well-paced declarative. Section
「執筆後の点検手順」 turns that into five mechanical checks, and the five
rules are those checks: the topic test over a section
(`section-narrates-itself`), the tail-preview search
(`section-ends-with-a-preview`), the stanceless-agenda opening
(`section-opens-with-an-agenda`), the boundary check for second-person
address, requests and modesty (`address-outside-boundaries`), and the
tension ledger over a whole document (`document-abandons-a-question`).
No linter can do any of them: 「次は〜を見る」 and 「では、上限は誰が決めるの
か。」 are both a section's last sentence, and only reading decides that
the first is progress commentary and the second is the subject; 「誤解しない
でほしいのだが」 and 「ここまでの話を『WARN を全部消せ』という主張と読まれる
と、それは違う」 are both objection-shaped, and only the presence of the
quoted misreading separates filler from argument. The subject is a section
(`subject: block`, split at every Markdown heading) with the whole
document in the state; the ledger rule takes the whole file as one bare
subject. The corpus is 12 documents I wrote for this (11 Japanese, 1
English), 400-2,400 characters each, 50 sections, each section labelled
per rule, so one section is bad for one rule and a hard clean for another.

Summary (accepted baselines, 3 passes; headroom is cutoff minus the top
clean mean and the lowest defect mean minus cutoff, on the accepted run):

| rule | verdict | at | P / R | tp/fp/fn | flips | clean top / defect floor | headroom | bad / clean (hard) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `section-narrates-itself` | COOKBOOK | 0.60 | 0.95 / 0.95 | 18/1/1 | 2 across the session (0 within the accepted run) | 0.60 / 0.58 | none (classes cross by 0.02) | 19 / 31 (17) |
| `section-ends-with-a-preview` | SHIP | 0.65 | 1.00 / 1.00 | 7/0/0 | 0 | 0.49 / 0.80 | 0.16 / 0.15 | 7 / 43 (11) |
| `section-opens-with-an-agenda` | SHIP, one known miss | 0.72 | 1.00 / 0.83 | 5/0/1 | 0 | 0.20 corpus, 0.60 unseen / 0.91 | 0.12 (over the unseen clean top) / 0.19 | 6 / 44 (16) |
| `address-outside-boundaries` | COOKBOOK | 0.73 | 1.00 / 1.00 | 6/0/0 | 0 | 0.67 / 0.80 | 0.06 / 0.07 | 6 / 44 (19) |
| `document-abandons-a-question` | SHIP, marginal | 0.50 | 1.00 / 1.00 | 4/0/0 | 0 | 0.35 / 0.66 | 0.15 / 0.16 | 4 / 7 (5) |

The one wording rewrite was `section-narrates-itself`, where `gaps` said
`rewrite` and three attempts are recorded in the rule file: the port's ask
asserted that any document-topic sentence is a hit while the criteria
exempted four forms, so the four forms landed mid-scale (0.48-0.71) beside
the short punchy defects (0.47-0.48); folding the exemption into the ask
as a negated compound pushed the exemptions down but compressed the whole
defect band with them (0.43-0.88); the positive one-axis ask with the
exemptions and the short forms spelled out in the criteria brings the
defects back to 0.58-0.96 and the exemptions to 0.60 and under -- a gap of
zero, held by the invented-example frame (「冒頭の売り場にオチを付けておこ
う」, the norm's exception 4) on one side and the norm's own short punchy
example (「言い方の話ではない。問いは、誰が直すかだけである。」) on the
other. That pair is the rule's honest limit. The other four rules kept
`ask`, `criteria` and `note` as ported. Two labels changed after a run
and both changes are argued in `expect.yml`: a preface ending 「それは後で
返す」 was relabelled bad for the preview rule (the criteria list "we
return to this later" verbatim; the 0.80 was right), and a mid-argument
reading instruction was relabelled clean for the narration rule (the port's
`note` hands it to the address rule, where it is bad at 0.91; the two
defects are nested, not disjoint). One fixture was changed after a run: my
own preface for `cache-ttl.md` said 「売り場の話から入る」, which narrates
the text, and the model was right to give it 0.63; and the self-deprecation
in `review-comments.md` was fused to a confession about the subject
(0.66 on the address rule, a soft label), so the modesty formula became a
standalone sentence (0.83).

The unseen run is the family's most useful result: on this repository's
`docs/internal/findings.md`, `docs/deepdive.md` and `experiments/BRIEF.md` every
finding above the cutoffs was a correct reading of the norm applied to a
genre the norm is not for. A findings log's preface that says which
sections supersede which, a deep dive's table of four other documents, a
section that ends "Section 5 is what happened on code nobody planted" --
these are navigation in a reference document and filler in an explanatory
one, and the rules cannot tell the genres apart because the document does
not say which it is. Run these on an article, a chapter, an explainer; not
on a README or a reference.

---

## section-narrates-itself

### Rule

`rules/markdown/section-narrates-itself/rule.yml`. The family header
comment (18 lines, shared by the five files, naming the source and the
subject/state choice) is omitted here; the file's attempt log and
calibration comment are included.

```yaml
id: section-narrates-itself
language: Text
subject: block
split: "^#{1,6}\\s+(?<TITLE>.+?)\\s*#*\\s*$"
extensions: [md, mdx, markdown]
kind: noul
state: located
# 0.60, fitted 2026-09-20 on the fixtures (12 documents, 50 sections: 19
# defects, 31 cleans of which 17 hard, 3 passes; wording attempt 3, above;
# accepted baseline). Defects answer 0.58-0.96: the agendas, tail previews,
# "this is not a best-practices collection" and "first, the definition"
# 0.80-0.96; the device narration "let me put half the answer first" 0.80;
# then the soft floor -- the disclaimer naming no misreading 0.70, "sorry
# this has grown long" 0.69, "in short, this chapter is about the shape of
# values" 0.65, and the norm's own short punchy form "this is not about
# wording; the only question is who fixes it" 0.58. Cleans top at 0.60 and
# 0.55: the two invented-example frames (「〜としよう」 ... 「冒頭の売り場に
# オチを付けておこう」), the norm's exception 4, which the model only half
# exempts; then a mid-argument reading instruction 0.42 (the address
# rule's), "the other half is the override order" 0.40, "that answers half
# the question" 0.34, the opening request 0.32. The classes cross by 0.02:
# at 0.60 the accepted run is P 0.95 R 0.95 (the frame flagged at 0.60, the
# short declaration missed at 0.58), and the run before it had them the
# other way round. There is no headroom on either side. On three unseen
# English documents (docs/internal/findings.md, docs/deepdive.md,
# experiments/BRIEF.md) cleans reached 0.57 (a question with a stance at a
# section head) and the navigational prefaces of the findings log and the
# deep dive answered 0.78-0.80 -- true by the norm, expected of the genre.
# A cookbook cutoff, not a shipped one: a finding between 0.55 and 0.70 is
# for a reader.
at: 0.6
# Wording attempts (the corpus: 12 documents, 50 sections, 20 bad, 3 passes):
#   1. as ported -- ask: "contains a sentence whose topic is the document
#      itself ... rather than its subject"; the four allowed forms only in
#      `criteria.false`. P 0.94 R 0.85 at 0.7, no separating cutoff: the
#      allowed forms answered 0.48-0.71 (the example frame 0.71, "this
#      answers half the question" 0.68, the closing request 0.49) while the
#      short punchy defects answered 0.47-0.48 ("first, the definition";
#      "this is not about wording; the only question is who fixes it"; a
#      mid-section "read what follows from the operator's side"). The ask
#      said every document-topic sentence is true and the criteria exempted
#      four, so the exemptions landed mid-scale.
#   2. the exemption folded into the ask ("... and that is not one of the
#      four allowed forms: ..."), the short forms named in `criteria.true`,
#      author-topic sentences named as situation in `criteria.false`. The
#      allowed forms fell to 0.49 and under, but the negated compound ask
#      compressed the defect band with them: 0.43-0.88, three defects under
#      0.50, no headroom anywhere (P 1.0 R 0.85 at 0.55, head 0.02).
#   3. the ask positive again, on the norm's one axis ("updates only the
#      document ... and says nothing new about its subject or the
#      narrator's judgment"); attempt 2's criteria kept, minus a clause that
#      claimed the mid-argument reading instruction, which the note hands to
#      the address rule. See the calibration comment at `at:`.
ask: >-
  This section contains a sentence that updates only the document -- what
  the text will do next, what it does not cover, how it looks so far, or
  the device it is using -- and says nothing new about its subject or the
  narrator's judgment.
criteria:
  "true": "A sentence in the section updates only the document, not the subject or the narrator's judgment: a progress announcement (\"next we look at\", \"we return to the example shortly\", \"so far this looks like theory\"), an agenda with no stance (\"this section covers A, B and C\", \"first, the definition\"), a declaration of what the text is not, will not do, or is only about (\"this is not a list of techniques\", \"this is not about wording; the only question here is who fixes it\"), a restatement of what the chapter is about with no new information about the subject, a disclaimer that names no specific misreading (\"do not misunderstand, I am not rejecting X\"), or a narration of the writing's own device (\"let me put half the answer first\", \"one more line before we close\"). The short, declarative, well-paced form of any of these is the commonest and is still one."
  "false": "Every sentence updates the situation: the subject's facts, data, events or trade-offs, a person's words, or the narrator's state of judgment -- an assumption later overturned, a suspended decision, a concession, a confession, a hedge about the author's own competence. A sentence whose topic is the author (\"I may be wrong\", \"I have no method for this\") is about the narrator, not the text. Four document-facing forms are allowed and are false: an objection handled by quoting the specific misreading it rejects (\"if this reads as 'delete every WARN', that is wrong\"); the sentence that poses a question or the one that returns its answer, at a section's opening or close (\"that answers half the question\", \"the other half is the override order\"); a request to the reader at the section's opening or close (\"read this as X for now\", \"fill in the rest from your own build\"); and a sentence that opens or closes an invented example (\"suppose that\", \"to give the opening scene its ending\"). A heading is not a sentence."
note: "Judge topic, not tone. A sentence about the subject that happens to be short, or a question about the subject, is not narration. A sentence that names the misreading it rejects in quotation is objection handling, not disclaimer. A section that is itself a preface or a closing may address the reader; the middle of an argument may not, and that is a separate rule -- here only whether the sentence's topic is the text."
```

### Corpus

50 sections across 12 documents; 19 bad, 31 clean of which 17 hard. The
bad cases, one line each:

- `cache-ttl.md:5` 「ここまでだと、概念の説明に見えるだろう。なので、すぐに例へ戻す。」 mid-section -- the norm's first listed filler (how the explanation looks + what the writer does next).
- `cache-ttl.md:23` opens 「本節では、TTL の上限、下限、既定値の三つを扱う。」 -- stanceless agenda.
- `cache-ttl.md:29` ends 「次は、TTL を項目ごとに変える方法を見る。」 -- tail preview.
- `retry-backoff.md:21` 「誤解しないでほしいのだが、リトライそのものを否定したいわけではない。」 -- disclaimer naming no misreading.
- `index-order.md:5` opens 「本節では、複合インデックスの列順、選択率、カバリングの三つを扱う。」 -- agenda.
- `index-order.md:13` ends 「ここまでで列順の話は見えた。次の問いはカバリングである。」 -- the norm's progress form verbatim.
- `index-order.md:23` 「テクニックの列挙はしない。」 -- short punchy declaration of what the text is not.
- `log-levels.md:21` opens 「以下では、INFO の出力量について説明する。」 and ends 「識別子をどう付けるかは、次の節で見る。」.
- `flaky-tests.md:1` 「先に答えを半分だけ置く。」 ... 「それは後で返す。」 -- device narrated.
- `flaky-tests.md:5` ends 「次は、順序に依存するテストを見る。」.
- `flaky-tests.md:21` 「最後にもう一度だけ線を引く。」 mid-section -- the norm's own example of a device declared, short form.
- `narrowing.md:5` 「要するに、この章の主題は型ではなく、値の形である。」 -- restatement of the chapter's theme, no new information.
- `narrowing.md:13` opens 「ここでは、絞り込みが効かない三つの場面を順に述べる。」.
- `review-comments.md:21` 「言い方の話ではない。問いは、誰が直すかだけである。」 mid-section -- the norm's short punchy form.
- `exceptions.md:1` 「この文章は、例外処理のベストプラクティス集ではない。」 -- what the text is not, in a preface.
- `exceptions.md:7` 「話が長くなって恐縮だ。」 mid-argument -- an apology whose topic is the text's length.
- `exceptions.md:17` ends 「これについては、次の節で詳しく見る。」.
- `exceptions.md:25` opens 「まず、境界の定義から。」 -- the shortest agenda.
- `monorepo.md:21` opens "This section covers CI time, disk usage, and onboarding." and ends "We will come back to onboarding." (English).

Hard cleans: the two invented-example frames (`cache-ttl.md:15`,
`build-cache.md:13`), objection handling with the quoted misreading
(`log-levels.md:13`, `review-comments.md:13`), a question posed at a tail
and returned at the next head with 「これで問いの半分には答えたことになる」
and 「残りの半分は〜である」 (`config-order.md:5/13/21`), a request to the
reader in the preface and at the close (`build-cache.md:1/23`), an
assumption overturned (`build-cache.md:5`, `flaky-tests.md:13`), a preview
with a stance (`narrowing.md:1`, `monorepo.md:13`), author-topic hedges and
confessions mid-argument (`retry-backoff.md:5`, `review-comments.md:5`), a
mid-argument reading instruction that the note assigns to the address rule
(`log-levels.md:5`), a 「要するに」 that summarises the subject
(`gc-pauses.md:19`), and dense short-sentence prose with no narration
(`retry-backoff.md:13`, `monorepo.md:5`).

### Attempts

1. As ported: ask "contains a sentence whose topic is the document itself
   ... rather than its subject", exemptions only in `criteria.false`.
   `gaps` (unlabelled): gap 0.21 at 0.35, verdict `rewrite`. `eval` at 0.7:
   P 0.94 R 0.85, tp 17 fp 1 fn 3, 2 flips, no separating cutoff. Allowed
   forms at 0.48-0.71 (example frame 0.71, "answers half the question"
   0.68, opening/closing requests 0.48-0.49); short punchy defects at
   0.47-0.48; one corpus fault found (`cache-ttl.md:1` at 0.63, my preface
   narrated).
2. Exemption folded into the ask as "and that is not one of the four
   allowed forms: ...", short forms named in `criteria.true`, author-topic
   sentences named as situation in `criteria.false`. Allowed forms down to
   0.49 and under, but the negated compound ask compressed the defects to
   0.43-0.88 with three under 0.50: P 1.0 R 0.85 at 0.55, head 0.02.
   Worse.
3. Positive one-axis ask ("updates only the document ... and says nothing
   new about its subject or the narrator's judgment"), attempt 2's criteria
   minus the clause claiming the mid-argument reading instruction (relabelled
   clean per the note). Defects 0.60-0.96, cleans top 0.59 (fit run); the
   accepted run crossed: defects 0.58-0.96, clean top 0.60. Gap 0.00.

### Fit

Fitted cutoff 0.60 (the tool's midpoint 0.58 on the accepted run; 0.60 on
the fit run). Accepted run: P 0.95, R 0.95, tp 18 fp 1 fn 1 (the example
frame `cache-ttl.md:15` flagged at 0.60, the short declaration
`review-comments.md:21` missed at 0.58). Flips: 0 within the accepted run's
three passes; across the session those two cases sat on either side of
0.60 in alternating runs (0.57-0.61 each). Max spread within a case 0.06.
Clean top 0.60 / defect floor 0.58: no headroom.

### Verdict

COOKBOOK. The rule separates the norm's clear filler (0.80-0.96) from
everything the norm calls situation (0.42 and under) with room to spare;
what it cannot do is put the four allowed exceptions under the short punchy
defects -- the invented-example frame and 「言い方の話ではない。問いは〜だけ
である。」 answer the same 0.58-0.60, and no sentence in three attempts
moved them apart. Worth a recipe with a cutoff of 0.60 and a reader for
0.55-0.70; not a cutoff to automate.

### What I would change

Split the rule. The strong band is progress commentary and scope
declaration (the agenda, the tail preview, "this is not X", the device
narrated), which a rule without exceptions would find at 0.80+; the
exceptions only matter for the disclaimer/objection pair and the
question/answer pair, which are a second, narrower rule ("a document-facing
sentence that is not one of the four forms") with its own corpus. The
corpus itself needs two or three more invented-example frames in clean
sections, because the two it has are the whole clean top and both are
Japanese; and an English example frame to see whether 「オチを付けておこう」
is a phrasing problem.

---

## section-ends-with-a-preview

### Rule

```yaml
id: section-ends-with-a-preview
language: Text
subject: block
split: "^#{1,6}\\s+(?<TITLE>.+?)\\s*#*\\s*$"
extensions: [md, mdx, markdown]
kind: noul
state: located
# 0.65, fitted 2026-09-20 on the fixtures (12 documents, 50 sections: 7
# defects, 43 cleans of which 11 hard, 3 passes). Defects answer 0.79-0.96:
# the six 「次は〜を見る」/「次の節で見る」/"We will come back to
# onboarding" tails 0.93-0.96, and a preface whose last sentence promises
# "that I return to later" 0.79 (first labelled clean as a boundary; the
# criteria list the form verbatim and the answer was right). Cleans top at
# 0.50: a section whose last sentence is a question about the subject
# (「では、既定値はどこに書くのか。」, 0.48-0.51 across passes), then 0.19.
# The gap is 0.29; 0.65 leaves 0.14 under and 0.15 over rather than the
# midpoint 0.645. On three unseen English documents cleans topped at 0.32
# and the one finding (a section ending "Section 5 is what happened on code
# nobody planted") answered 0.76.
at: 0.65
ask: >-
  This section ends by announcing what comes next instead of ending on its subject.
criteria:
  "true": "The section's last sentence or two are about the document's progress -- \"next we look at X\", \"the following section takes up Y\", \"so far we have seen A; the next question is B\", \"we return to this later\" -- a bridge placed at the end of the section rather than at the head of the next."
  "false": "The section ends on its subject: a fact, a judgment, an unresolved assumption, a concession, an example's ending, or a question about the subject left open. A final sentence that poses a question about the subject is not a preview; a closing request to the reader at the end of a chapter is a boundary, not a preview; a heading is not a sentence."
note: "Only the section's ending is judged. A preview earlier in the section belongs to the narration rule. The norm's reason: a bridge belongs at the head of the next section, as a counter-question or a confession, and a preview at the tail is progress commentary."
```

### Corpus

50 sections; 7 bad, 43 clean of which 11 hard.

- `cache-ttl.md:29` ends 「次は、TTL を項目ごとに変える方法を見る。」.
- `index-order.md:13` ends 「ここまでで列順の話は見えた。次の問いはカバリングである。」.
- `log-levels.md:21` ends 「識別子をどう付けるかは、次の節で見る。」.
- `flaky-tests.md:1` the preface ends 「それは後で返す。」 -- "we return to this later", which the criteria list; relabelled from clean after the first run.
- `flaky-tests.md:5` ends 「次は、順序に依存するテストを見る。」.
- `exceptions.md:17` ends 「これについては、次の節で詳しく見る。」.
- `monorepo.md:21` ends "We will come back to onboarding."

Hard cleans: sections ending on a question about the subject
(`retry-backoff.md:13`, `config-order.md:5`, `narrowing.md:23`), on an
unresolved assumption (`log-levels.md:5`, `gc-pauses.md:5`), on the closing
of an invented example (`cache-ttl.md:15`, `build-cache.md:13`), on a
closing request to the reader (`build-cache.md:23`), on a concession
(`narrowing.md:13`), and a section with a progress announcement in the
MIDDLE that ends on its subject (`cache-ttl.md:5`).

### Attempts

1. As ported. `gaps` (unlabelled): gap 0.32 at 0.62, verdict `works`.
   `eval` at 0.7: P 0.86 R 1.00, fp = the `flaky-tests.md:1` preface at
   0.80, which was my label's fault, not the rule's. No wording change.

### Fit

Fitted cutoff 0.65 (the tool's midpoint on the accepted run is also
0.65). P 1.00, R 1.00, tp 7 fp 0 fn 0. Flips 0. Defects 0.80-0.96; clean
top 0.49 (the question-ending section, 0.47-0.53 across passes), next
0.19. Max spread 0.06. Headroom 0.16 under, 0.15 over.

### Verdict

SHIP. Separates with headroom on both sides and no flips; the one
question-ending section is the hard case and sits 0.16 under.

### What I would change

Nothing in the rule. The corpus would take two more question-ending
sections and an English one, since the clean top is a single case.

---

## section-opens-with-an-agenda

### Rule

```yaml
id: section-opens-with-an-agenda
language: Text
subject: block
split: "^#{1,6}\\s+(?<TITLE>.+?)\\s*#*\\s*$"
extensions: [md, mdx, markdown]
kind: noul
state: located
# 0.72, fitted 2026-09-20 on the fixtures (12 documents, 50 sections: 6
# defects, 44 cleans of which 16 hard, 3 passes) AND on three unseen
# English documents. Five defects answer 0.91-0.96 (「本節では〜の三つを扱
# う」, 「以下では〜について説明する」, "This section covers CI time, disk
# usage, and onboarding"); the sixth, the one-line form 「まず、境界の定義か
# ら。」, answers 0.48 and is the known miss. Corpus cleans top at 0.20 (the
# counter-questions, the confession, the stance previews all under), which
# made the tool's midpoint 0.35 -- and on the unseen documents two sections
# that are not agendas at all (a paragraph on what each candidate went
# through, a "Spec and plan:" pointer) answered 0.57 and 0.60, and a
# spec's list of report headings 0.63. The corpus clean top was a hole;
# the cutoff is set above the real clean band: 0.12 over 0.60, 0.19 under
# 0.91. The one-line agenda sits inside the real clean band and is not
# recoverable by a cutoff.
at: 0.72
ask: >-
  This section opens with an agenda that carries no stance -- a table of what will be covered -- instead of a question, a discomfort, or a confession.
criteria:
  "true": "The first sentence or two after the heading only list what the section will do (\"this section covers A, B and C\", \"below, we describe X\", \"here we explain the three properties\") with no attitude toward the subject and no tension for the reader."
  "false": "The section opens on the subject: a restated discomfort the previous section left, a counter-question the reader would ask (\"should we have done X first, then?\"), a confession (\"to be honest, I had also counted on\"), a claim the section will test, a reader's likely resistance stated in the reader's words, or a preview that carries a stance (\"there is no better angle on X than this\", \"put another way, this is a story about Y\"). A single sentence of scope with attitude is allowed; a bare table of contents is not."
note: "Only the opening is judged. The test is stance: the same preview with an attitude (\"no better angle than this\") passes and without one (\"this section discusses angles\") fails. A heading is not a sentence, and a section that is only a heading and a list is judged on the list's first item."
```

### Corpus

50 sections; 6 bad, 44 clean of which 16 hard.

- `cache-ttl.md:23` 「本節では、TTL の上限、下限、既定値の三つを扱う。」.
- `index-order.md:5` 「本節では、複合インデックスの列順、選択率、カバリングの三つを扱う。」.
- `log-levels.md:21` 「以下では、INFO の出力量について説明する。」.
- `narrowing.md:13` 「ここでは、絞り込みが効かない三つの場面を順に述べる。」.
- `exceptions.md:25` 「まず、境界の定義から。」 -- the one-line agenda; the known miss.
- `monorepo.md:21` "This section covers CI time, disk usage, and onboarding."

Hard cleans: the counter-question openings (`retry-backoff.md:5`,
`config-order.md:5`, `exceptions.md:7`, `narrowing.md:23`), the confession
(`flaky-tests.md:13`), the previews with a stance (`narrowing.md:1`,
`monorepo.md:13`), the restated discomfort (`index-order.md:13`), the
reader's resistance in the reader's words (`gc-pauses.md:13`,
`review-comments.md:13`), the invented-scene openings (`cache-ttl.md:15`,
`build-cache.md:13`), the opening request (`build-cache.md:1`), and three
sections that open on a declaration about the text that is not a table of
contents (`index-order.md:23` 「テクニックの列挙はしない。」,
`exceptions.md:1`, `flaky-tests.md:1`) -- all under 0.20.

### Attempts

1. As ported. `gaps` (unlabelled): gap 0.43 at 0.71, verdict `works`.
   `eval` at 0.7: P 1.00 R 0.83, the one-line agenda at 0.50. No wording
   change (the brief allows one only on `rewrite`).

### Fit

Fitted cutoff 0.72. The tool's midpoint is 0.35 (corpus clean top 0.20,
defect floor 0.51), and that number is a hole: on the unseen documents two
sections that are not agendas at all answered 0.57 and 0.60 (a paragraph
saying what each candidate went through; a "Spec and plan:" pointer). The
cutoff is set 0.12 over the real clean band and 0.19 under the five clear
defects. P 1.00, R 0.83, tp 5 fp 0 fn 1. Flips 0. Max spread 0.02.

### Verdict

SHIP, with one known miss. The five multi-item agendas answer 0.91-0.96
against a real clean band that reaches 0.60; the one-line 「まず、定義から。」
sits inside that band at 0.48-0.51 and no cutoff recovers it.

### What I would change

The corpus: the clean top of 0.20 was the trap the calibration doc
describes, and the unseen run found it in one pass. Add clean sections
that open with a pointer or a one-sentence description of what was done
(the 0.57-0.60 shapes), and two more one-line agendas, to see whether the
one-line form is a class the rule misses or one case.

---

## address-outside-boundaries

### Rule

```yaml
id: address-outside-boundaries
language: Text
subject: block
split: "^#{1,6}\\s+(?<TITLE>.+?)\\s*#*\\s*$"
extensions: [md, mdx, markdown]
kind: noul
state: located
# 0.73, fitted 2026-09-20 on the fixtures (12 documents, 50 sections: 6
# defects, 44 cleans of which 19 hard, 3 passes). Defects answer 0.79-0.92:
# "I may be wrong about this, but" mid-paragraph 0.92, 「どうか〜の目線で読
# んでほしい」 mid-section 0.91, 「誤解しないでほしいのだが」 0.85, a
# standalone modesty formula 「偉そうに書ける立場でもないのだが。」 0.83 (as
# a clause fused to a confession about the subject it answered 0.66; the
# confession is situation, the formula is not), 「私の理解が浅いだけかもしれ
# ないが」 0.82, 「話が長くなって恐縮だ。」 0.79. Cleans top at 0.66: 「〜を
# 事前に証明する方法を、私は持っていない。」 mid-section, a first-person
# claim that no method exists, which the model reads as half a hedge; then
# 0.35. The gap is 0.13 and 0.73 is its midpoint, 0.07 either side --
# narrow. On three unseen English documents cleans topped at 0.41 and the
# two findings were real: "Read the 12 as ... and note the baseline" inside
# an argument (0.75) and a "Do not quote" inside a list item (0.51, under
# the cutoff, so a miss).
at: 0.73
ask: >-
  This section addresses the reader directly -- a request, an apology, a hedge about the author -- in the middle of an argument rather than at its opening or close.
criteria:
  "true": "In the body of the section's argument, not at its first or last sentences, the text turns to the reader: a request (\"please read this as\"), an apology or self-deprecation (\"forgive the digression\", \"I may be wrong about this\"), a second-person appeal (\"you may feel that\"), or a modesty formula, placed where the reasoning is under way."
  "false": "Direct address, requests and the author's hedges sit at the section's opening or close, where they act as slack between arguments; or the section has none; or what looks like address is the subject's material (a quoted person speaking, a counter-question the reader would ask that the text then answers, an invented scene addressing its character). A concession about the subject (\"that is half right\") is not a hedge about the author."
note: "The norm allows address only at boundaries: the head and tail of a chapter or section. The middle is the argument. A counter-question put in the reader's mouth and immediately taken up is the subject's material and allowed anywhere; a hedge about the author's confidence in the middle is not."
```

### Corpus

50 sections; 6 bad, 44 clean of which 19 hard.

- `retry-backoff.md:5` 「私の理解が浅いだけかもしれないが、」 mid-paragraph -- hedge about the author.
- `retry-backoff.md:21` 「誤解しないでほしいのだが、」 between two paragraphs of argument -- a plea.
- `log-levels.md:5` 「どうか、ここから先は監視する側の目線で読んでほしい。」 mid-section -- a request.
- `review-comments.md:5` 「偉そうに書ける立場でもないのだが。」 mid-section -- a standalone modesty formula (rewritten from a clause fused to a confession, which was 0.66 and a soft label).
- `exceptions.md:7` 「話が長くなって恐縮だ。」 mid-argument -- an apology.
- `monorepo.md:13` "I may be wrong about this, but" inside the section's key paragraph.

Hard cleans: the opening request (`build-cache.md:1`) and the closing one
(`build-cache.md:23`, which also has 「私は持っていない」 mid-section), the
confession at a head (`flaky-tests.md:13`), counter-questions in the
reader's mouth taken up at once (`narrowing.md:23`, `config-order.md:5`),
a colleague quoted inside a scene (`build-cache.md:13`), objection handling
with the quoted misreading mid-section (`log-levels.md:13`), the reader's
resistance quoted (`gc-pauses.md:13`), concessions and assumptions about
the subject (`narrowing.md:13`, `build-cache.md:5`, `gc-pauses.md:5`), and
narration that is not address (`cache-ttl.md:5`, `flaky-tests.md:21`,
`monorepo.md:21`).

### Attempts

1. As ported. `gaps` (unlabelled): gap 0.26 at 0.53, verdict `move`.
   `eval` at 0.7: P 1.00 R 0.83, the fused self-deprecation at 0.66 against
   a clean top of 0.67. Fixture rewritten (a label fix, not a wording one);
   no wording change.

### Fit

Fitted cutoff 0.73, the midpoint of the accepted run's gap (clean top
0.67, defect floor 0.80). P 1.00, R 1.00, tp 6 fp 0 fn 0. Flips 0. Max
spread 0.04. Headroom 0.06 under, 0.07 over.

### Verdict

COOKBOOK. It separates, and every defect is 0.80+, but the clean top is a
single first-person sentence (「〜を事前に証明する方法を、私は持っていない。」)
that the model reads as half a hedge, and the headroom either side is
under 0.10. On the unseen documents one real mid-list request ("Do not
quote") answered 0.51 and was missed, so the defect band on real prose
reaches lower than the corpus's.

### What I would change

The corpus wants more first-person sentences about the subject in
mid-section (the 「私は持っていない」 shape) to learn whether 0.67 is one
case or the class; if it is the class, the `note` should say that a
first-person claim about the state of the art is the subject's material.
And a labelled mid-list request, since the unseen 0.51 says short requests
inside a bullet are read more softly than the same sentence in a paragraph.

---

## document-abandons-a-question

### Rule

```yaml
id: document-abandons-a-question
language: Text
subject: block
extensions: [md, mdx, markdown]
kind: noul
state: bare
# 0.50, fitted 2026-09-20 on the fixtures (11 documents, one subject each:
# 4 defects, 7 cleans of which 5 hard, 3 passes). Defects answer 0.63-0.80:
# the counter-question 「では、選択率を測る前に列順を決めてしまってよかったの
# だろうか。」 posed and walked past 0.80, "We will come back to onboarding"
# as the last line 0.69, 「では、先に〜落としておけばよかったのだろうか」
# never answered 0.64, a preface's 「それは後で返す」 never returned 0.63.
# Cleans top at 0.37: the document whose one open question is its last
# sentence, on purpose; then 0.31 (a question at a section's tail answered
# at the next head) and 0.29 (an assumption overturned). Midpoint of the
# gap, 0.13 either side. The defects are soft because "one deliberately open
# question at the very end" is in the criteria and three of the four
# abandonments sit near an end. A whole-file subject is cut at 48,000
# characters: on the 78 KB docs/internal/findings.md the rule answered 0.60 for
# promises whose delivery lies beyond the cut, which is the cut speaking,
# not the document.
at: 0.5
ask: >-
  This document raises a question, an assumption or a promise that it never returns to.
criteria:
  "true": "Somewhere the text poses a question to the reader or itself, states an assumption in a way that invites its overturning (\"it must be working\"), or promises an answer (\"the other half of the answer comes later\"), and no later passage answers, overturns or delivers it; the reader is left holding it. One deliberately open question at the very end is not abandonment."
  "false": "Every question, invited assumption and promise is returned to: answered, overturned by a later fact, or delivered, even in part -- or the one left open is the last thing the document does, on purpose. A rhetorical question answered in the next sentence counts as returned. A question that is the document's title or heading, answered by the body, counts as returned."
note: "Keep a ledger: list each question, invited assumption and promise, and for each point to the passage that returns it. The judgment is about that ledger, not about whether the answers are good. A document with no question in it has nothing to abandon."
```

### Corpus

11 documents, one subject each; 4 bad, 7 clean of which 5 hard.
`cache-ttl.md` is left out on purpose: it ends with 「次は〜を見る」 and
nothing after, which is a tail preview (the preview rule's defect), not a
promise of an answer; keeping it would have forced a label the norm does
not give.

- `index-order.md` poses 「では、選択率を測る前に列順を決めてしまってよかったのだろうか。」 and walks past it into a preview.
- `flaky-tests.md` promises 「半年後にまた落ちる理由は残りの半分にあって、それは後で返す。」 and never returns it.
- `exceptions.md` opens a section with 「では、先に例外を握りつぶさずに落としておけばよかったのだろうか。」 and never answers it.
- `monorepo.md` says "We will come back to onboarding." as its last line.

Hard cleans: every question returned including a promise delivered in
halves (`config-order.md`), one question left open as the very last
sentence on purpose (`narrowing.md`), an assumption overturned and a
scene's puzzle answered with a closing 読者への委任 (`build-cache.md`), a
title question plus an assumption plus a preview all returned
(`log-levels.md`), a rhetorical question answered next sentence
(`gc-pauses.md`).

### Attempts

1. As ported. `gaps` (unlabelled): gap 0.29 at 0.51, verdict `move`.
   `eval` at 0.7: P 1.00 R 0.25 (three of four defects at 0.63-0.69). No
   wording change; the cutoff was the problem, as `gaps` said.

### Fit

Fitted cutoff 0.50 (the tool's midpoint 0.51). P 1.00, R 1.00, tp 4 fp 0
fn 0. Flips 0 (one at 0.7 on the first run, `flaky-tests.md` 0.58-0.67).
Max spread 0.04. Defects 0.66-0.78, clean top 0.35 (the one-open-at-the-end
document). Headroom 0.15 under, 0.16 over.

### Verdict

SHIP, marginal. It separates with headroom just over 0.10 on eleven
subjects; the defects are soft (three of four near 0.66) because three of
them sit near an end and the criteria allow "one deliberately open question
at the very end". And the whole-file subject is cut at 48,000 characters,
which on the unseen `docs/internal/findings.md` produced a 0.60 for promises whose
delivery lies beyond the cut.

### What I would change

The corpus is thin at 11; it wants 20 documents, with abandonments in the
middle of long documents (where the rule should be strong) and more
deliberately-open endings. The cut is a tool limit: a ledger rule needs
the whole document, so either the rule declares a maximum size and skips
larger files, or `block` without `split` needs a way to say "cut, so no
verdict".

---

## Unseen: `docs/internal/findings.md`, `docs/deepdive.md`, `experiments/BRIEF.md`

English, technical, 77 sections, none of it written for the norm. Run
before the cutoffs were fixed, at `--at 0.5 --retry 3 --loose 40`, recorded
to the scratchpad; findings read against the text and scored against the
shipped cutoffs above.

- **`docs/internal/findings.md`** (78 KB, 48 sections): `section-narrates-itself`
  flags the preface (0.80: "Sections 1-8 record ... Section 12 lists ...
  Section 13 is ..."), §14's opening (0.80: "This section is what was worth
  carrying across ... and what each piece measured as") and §12's opening
  (0.66: "The ones that remain are listed here, because ..."); a §13 head
  that poses its question with a stance ("The question this section answers
  is not 'does it run' ... but is it worth running") sat at 0.57, under.
  `section-ends-with-a-preview` flags §1 (0.76), which ends "Section 5 is
  what happened on code nobody planted." `section-opens-with-an-agenda`:
  nothing at 0.72; the preface at 0.62 and two non-agendas at 0.57/0.60
  are the reason the cutoff is where it is. `address-outside-boundaries`:
  nothing at 0.73; a mid-list "Do not quote ..." answered 0.51, a real
  miss. `document-abandons-a-question`: 0.60 -- over the cutoff -- for a
  document whose promised sections 13-15 lie beyond the 48,000-character
  cut; the cut speaking, not the document.
- **`docs/deepdive.md`** (32 KB, 23 sections): `section-narrates-itself`
  flags the preface (0.78: a table of "four other documents, so you can pick
  the right one") and §7's opening line (0.70: "The largest gaps, kept as a
  list so nothing is quietly assumed"). `address-outside-boundaries` flags
  §"What the corpus numbers are worth" (0.75): "Read the 12 as ... and note
  the baseline it has to be read against" inside the argument, plus a
  parenthetical correction of the author's earlier count -- a correct
  reading. Preview, agenda, abandons: nothing (abandons 0.33).
- **`experiments/BRIEF.md`** (5 KB, 6 sections): `section-opens-with-an-agenda`
  puts "REPORT.md format" at 0.63, under 0.72 -- a spec's list of headings,
  which is a table by nature. Nothing else over 0.47.

Every finding over a cutoff is a true reading of the norm and, for these
three documents, a genre mismatch: a findings log and a reference are
navigational by design. The clean band on real English prose: narrates
≤ 0.57, preview ≤ 0.32, agenda ≤ 0.60 (0.63 on the spec), address ≤ 0.41,
abandons 0.33 on the one document that fit in the cut.

## Cost

From the tool's own summaries: about 710 requests and about 3.7M input
tokens, **$0.18** in total -- `gaps` twice over the five ($0.019; the first
pass I tailed past the table), `eval --repeat 3` ten times across the
five rules and the three narrates attempts ($0.062), the unseen run of five
rules on three documents with `--retry 3` ($0.068), and the five accept
runs ($0.029). Well under the $1.00 ceiling.

## Tooling

- `gaps` reads no labels: with `expect.yml` beside the rule it still
  reports the unlabelled largest step, so for a labelled corpus its
  verdict is weak evidence (`section-opens-with-an-agenda` said `works` on
  a clean top of 0.20 that the unseen run showed was a hole;
  `section-narrates-itself` said `rewrite`, which was right). `eval` with
  `expect.yml` is the measurement; `gaps` is a smoke test.
- `eval` prints `fitted` as the midpoint of the gap, and the family's
  `at:` disagrees with it twice on purpose (agenda 0.72 vs 0.35, from the
  unseen band; preview 0.65 vs 0.65 by coincidence). Nothing in `eval`
  records why, so the comment at `at:` has to.
- A `block` rule without `split` cuts the subject at 48,000 characters
  "with the cut declared", and the abandons rule then judges the promises it
  saw against the returns it could not see: `check <unseen> -R
  rules/markdown/document-abandons-a-question/rule.yml --no-config --cache
  none --retry 3 --at document-abandons-a-question=0.5` gave
  `findings.md:1  0.60  arm bare  3/3 passes` for the 78 KB findings log.
  Nothing in the finding says the subject was cut. Not fixed here (`src/`
  is out of bounds); recorded in the rule's calibration comment.
- No obstacle in `src/`: `rules`, `check --dry-run --show-subjects`,
  `gaps`, `eval --repeat 3 [--accept]`, `eval --replay` and `check --retry
  3 --record --loose` all ran as documented over `subject: block` rules
  with `split:` on Japanese Markdown. `--show-subjects` printed each
  section's line range and `$TITLE`, which is what the labels were written
  from.
- The scratchpad directory is shared between the parallel agents (their
  `corpus/` and `unseen/` files were there when I arrived); I used my own
  subdirectories and copied only my twelve files into the rule
  directories.
