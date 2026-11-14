skills-sync:
    npm run skills:sync

skills-check:
    npm run skills:check

ci:
    pnpm run ci

docs-facts *args:
    node --experimental-strip-types tools/docs-facts.ts {{args}}

docs-check *args:
    node --experimental-strip-types src/cli.ts docs {{args}}

docs-replay:
    node --experimental-strip-types src/cli.ts docs --replay .jev-lint/documents-baseline.json

docs-eval *args:
    node --experimental-strip-types tools/eval-documents.ts {{args}}

adoption-build:
    node --experimental-strip-types tools/build-adoption-eval.ts

adoption-eval *args:
    node --experimental-strip-types tools/eval-adoption.ts {{args}}

adversarial-eval *args:
    node --experimental-strip-types tools/eval-adversarial.ts {{args}}

relations-eval *args:
    node --experimental-strip-types tools/eval-relations.ts {{args}}

relations-negative-check *args:
    node --experimental-strip-types tools/check-relation-negatives.ts {{args}}

relations-extended-build:
    node --experimental-strip-types tools/build-relation-extended.ts

relations-extended-eval *args:
    node --experimental-strip-types tools/eval-relations.ts --corpus experiments/relations/extended {{args}}

relations-workflow-build:
    node --experimental-strip-types tools/build-relation-workflow.ts

relations-workflow-eval *args:
    node --experimental-strip-types tools/eval-relation-workflow.ts {{args}}

export-scan-contract target *args:
    node --experimental-strip-types tools/export-scan-contract.ts {{quote(target)}} {{args}}

export-relation-contract target *args:
    node --experimental-strip-types tools/export-relation-contract.ts {{quote(target)}} {{args}}

clef-plan *args:
    pnpm run eval:clef --dry-run {{args}}

clef-eval *args:
    pnpm run eval:clef {{args}}

clef-replay *args:
    pnpm run eval:clef --replay {{args}}
