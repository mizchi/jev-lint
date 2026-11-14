# Releasing jev-lint

The npm package and Claude plugin use the same version. A release changes
`package.json`, both root versions in `package-lock.json`,
`.claude-plugin/plugin.json` and `.claude-plugin/marketplace.json` together.
The current package identity is generated in [project facts](project-facts.md).

## One-time publisher setup

The package already exists on npm. Its owner registers the GitHub repository
and exact workflow filename after `release.yml` is present on main:

```sh
npm login --auth-type=web
npm trust github jev-lint --repo mizchi/jev-lint --file release.yml --allow-publish -y
npm trust list jev-lint
```

Account 2FA is required. The registration must allow direct publishing; a
staging-only publisher cannot run this workflow's `npm publish`. No long-lived
npm publish token is configured in GitHub. See the [npm trusted publishing
documentation](https://docs.npmjs.com/trusted-publishers/) and
[npm trust reference](https://docs.npmjs.com/cli/v11/commands/npm-trust).

`.github/release-tags-ruleset.json` is the proposed admin-only policy for
creating, moving and deleting `v*` tags. Committing this file does not activate
the repository setting. A repository administrator applies it once after
reviewing the policy. Existing protections must be inspected before updating.

## Prepare a version

Replace the example version below with the intended unpublished version.

```sh
npm version 0.8.0 --no-git-tag-version --ignore-scripts
# Update both Claude plugin manifests to the same version.
# Add the version's release notes to CHANGELOG.md.
just docs-facts
just release-check
just package-check
source ~/.profile
just docs-check --record .jev-lint/documents-baseline.json
just ci
```

`release-check` rejects mismatched package/lock/plugin versions, a wrong tag,
incorrect package/repository identity and missing, empty or duplicate changelog
sections. Refresh documentation records after changing registered sources.
When metadata changes make replay stale, refresh the documentation record before
running the full CI gate. Review and merge the release commit into main first.

`package-check` performs a fresh `npm pack`, installs that tarball in an isolated
temporary consumer and checks all public JavaScript exports and TypeScript
declarations. It also loads every packaged rule, matches real source with
ast-grep, checks keyless initialization, and exercises offline documentation
and introspection plans. Fixture evaluations remain repository-only.
It also dry-runs the exact npm publish command from the release workflow.

## Tag workflow

```sh
git switch main
git pull --ff-only origin main
git tag -a v0.8.0 -m "Release v0.8.0"
git push origin v0.8.0
```

Only a `v*` tag push triggers `.github/workflows/release.yml`. The `prepare`
job has read-only repository access and checks that the tagged commit belongs
to main, all versions match and release notes exist. It runs the complete
offline CI and the installed-tarball check, then uploads the tested tarball and
notes as one artifact.

The dependent `publish` job alone receives `id-token: write`. It uses Node 24
and npm 11.19.1, downloads that same artifact
and runs `npm publish` with OIDC and `--ignore-scripts`; repository lifecycle
scripts are not run with publishing permissions. Publications are serialized
across tags, and a registry check rejects versions that would leave their
channel unchanged or move it backward. No release job uses a dependency cache.
Stable versions publish to `latest`; prereleases publish to `next`.

The separate `github-release` job alone receives `contents: write`. Its notes
come from the matching changelog section, and the same tarball is attached to
the release. If this job fails after npm succeeds, rerun the failed job without
repeating npm publication. Trusted publishing supplies provenance.

## Verify publication

```sh
gh run list --workflow release.yml --limit 3
npm view jev-lint@0.8.0 version dist.attestations
npm view jev-lint dist-tags
```

Verify the exact version, provenance and expected dist-tag, then smoke-test the
registry-installed CLI in a clean consumer. A successful ordinary CI run does
not prove npm's publisher registration is correct. `npm whoami` tests interactive
login, not OIDC permissions. If publication fails, inspect the failing step
before retrying. An npm version that has been published cannot be overwritten;
use a new version if any publish already succeeded.
