# Repository instructions

## Closure and clean-up

This package reaches users through npm; nothing is installed locally from this checkout. Codex runs a pinned registry version (`npx -y jev-decision-mcp@<version>` in `~/.codex/config.toml`).

When a change is complete:

1. Run `npm test` (it builds first) and commit locally.
2. Remove the build output and dependencies: `dist/` and `node_modules/`.

For documentation-only changes to repository instructions, review the diff and commit locally; no version bump, dependency installation, build or test run is needed.

## Releases

- Publishing happens through GitHub: a published GitHub release triggers `.github/workflows/publish-npm.yml`, and `publish-registry.yml` is started by hand. Bump the version and publish only when Stefan explicitly asks for a release.
- When a release fixes a defect or dependency security issue in a published version, deprecate the affected versions after verifying that the replacement is available on npm. Use narrowly scoped `npm deprecate jev-decision-mcp@<affected-version> "Upgrade to jev-decision-mcp <fixed-version> or later: <reason>."` notices; do not deprecate all older versions merely because a new version exists.
- Verify each notice with `npm view jev-decision-mcp@<affected-version> deprecated`. Deprecation needs npm maintainer authentication separately from the publishing workflow. If authentication blocks it, report the exact versions still pending and do not claim deprecation is complete.
- After a release, the pinned version in `~/.codex/config.toml` has to change for Codex to use it. Ask before editing that file.

## Git workflow

- Commit locally as work progresses. Push only when Stefan asks; when a milestone is done, ask once whether to push now or not yet. A push to `main` runs `.github/workflows/ci.yml`.
- Use plain `git` on `main`. Create branches or pull requests only when asked.
