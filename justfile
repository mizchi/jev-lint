skills-sync:
    npm run skills:sync

skills-check:
    npm run skills:check

clef-plan *args:
    pnpm run eval:clef --dry-run {{args}}

clef-eval *args:
    pnpm run eval:clef {{args}}

clef-replay *args:
    pnpm run eval:clef --replay {{args}}
