# Action verification — PR spec-review (composite) Action

Date: 2026-11-16
Scope: `action.yml` (composite GitHub Action at repo root) and `docs/example-spec-review.yml`,
simulated locally against the built CLI (`node dist/cli.js`, from `src/cli.ts` `diffAction` +
`src/diff.ts`). The Action itself has **not** been run on a GitHub-hosted runner yet — see
"What remains" and "Issues found".

## What was verified

Fixtures (all under `test/fixtures/`):

| File | Contents |
| --- | --- |
| `action-base.json` | Realistic OpenAPI 3.0.3 "Pet Store" spec: `GET /pets` (list, optional query param `status` with enum `available\|pending\|sold`), `POST /pets` (create), `DELETE /pets/{id}`, `components.schemas.Pet` and `components.schemas.Error`. Every response carries an `application/json` content schema. |
| `action-breaking.json` | Same spec with two breaking changes the diff engine detects: `DELETE /pets/{id}` removed (`path-removed`) and the `status` query param enum narrowed to `["available"]` (`parameter-enum-narrowed`). Version bumped to 1.1.0. |
| `action-ok.json` | Same spec with only non-breaking changes: new optional query param `limit` on `GET /pets` (`parameter-added-optional`) and a new `GET` operation on `/pets/{id}` (`operation-added`). |

Commands run and observed exit codes (stdout captured):

```text
$ node dist/cli.js diff test/fixtures/action-base.json test/fixtures/action-base.json
breaking:     0
non-breaking: 0
exit=0

$ node dist/cli.js diff test/fixtures/action-base.json test/fixtures/action-breaking.json
breaking:     2
  ✗ [parameter-enum-narrowed] get /pets — enum of query:status narrowed in GET /pets
  ✗ [path-removed]  /pets/{id} — path /pets/{id} was removed
non-breaking: 0
exit=1

$ node dist/cli.js diff test/fixtures/action-base.json test/fixtures/action-ok.json
breaking:     0
non-breaking: 2
  ✓ [parameter-added-optional] get /pets — optional query parameter "limit" added to GET /pets
  ✓ [operation-added] get /pets/{id} — GET /pets/{id} was added
exit=0

$ node dist/cli.js list test/fixtures/action-base.json --json
[ ... 3 tools: listPets, createPet, deletePet ... ]
exit=0
```

Automated checks (`node --import tsx --test test/action-sim.test.ts`) — 6/6 pass:

1. `diff` on identical specs exits 0 (via `spawnSync`, exit code asserted)
2. Breaking changes exit 1 — this is exactly what the Action's composite step turns into a failed PR check
3. Additive-only changes exit 0
4. Base spec parseable by the CLI (`list --json` yields > 0 tools; 3 observed)
5. `action.yml` contains `diff`, `${{ inputs.spec }}` and `args`
6. `docs/example-spec-review.yml` contains `uses: asubilla/OpenApiMCP@main`, `pull_request`, `diff`, and an `openapi.*` paths trigger

## How the Action is wired (reading of `action.yml`)

```yaml
runs:
  using: composite
  steps:
    - uses: actions/setup-node@v4
      with:
        node-version: "20"
    - shell: bash
      run: npx -y "@asubilla/openapimcp@${{ inputs.version }}" "${{ inputs.command }}" "${{ inputs.spec }}" ${{ inputs.args }}
```

- For the example workflow, that expands to
  `npx -y @asubilla/openapimcp@latest diff /tmp/base-openapi.json openapi.json`, which matches
  `diff <old> <new>` in `diffAction` (`spec` = base-branch spec, `args` = PR head spec). Direction is correct.
- The fail gate relies on exit-code propagation: composite `run` steps with `shell: bash` execute as
  `bash --noprofile --norc -eo pipefail`, so the CLI's `process.exitCode = 1` (set in `diffAction` when
  `breaking.length > 0`) fails the step, which fails the PR check. This is wired correctly.
- `${{ inputs.args }}` is deliberately unquoted so callers can pass extra positional args/flags;
  `${{ inputs.spec }}` is quoted so paths with spaces survive.
- Note the Action runs the **published npm package** (`@asubilla/openapimcp@<version>`), not the
  repository source. Local verification therefore exercised `dist/cli.js` built from the current
  source; a runner would exercise whatever `latest` (or the `version` input) resolves to on npm.

## How to reproduce manually

```bash
npm run build           # or otherwise produce dist/cli.js
node --import tsx --test test/action-sim.test.ts

node dist/cli.js diff test/fixtures/action-base.json test/fixtures/action-base.json   # expect exit 0
node dist/cli.js diff test/fixtures/action-base.json test/fixtures/action-breaking.json # expect exit 1
node dist/cli.js diff test/fixtures/action-base.json test/fixtures/action-ok.json     # expect exit 0
```

## Issues found (not patched — per scope, these files were left untouched)

1. **Example workflow crashes on a first-time spec.** `docs/example-spec-review.yml` does
   `git show "origin/${base_ref}:openapi.json" > /tmp/base-openapi.json || true`. If the PR adds
   `openapi.json` for the first time, `git show` fails, `|| true` swallows it, and `/tmp/base-openapi.json`
   is left **empty**. Verified locally: `diff` on an empty file throws an uncaught
   `SyntaxError` (stack trace, no clean message) and exits 1. The PR check does fail (fail-closed),
   but with a confusing crash instead of a diff report. Suggested fix: in the fetch step, record whether
   `git show` succeeded (e.g. a step output) and skip the diff step when there is no base spec; or make
   `diffAction` catch load errors and print a clean `error: ...` message.
2. **`diffAction` does not wrap `loadDocument` in try/catch.** A missing/unparseable spec produces an
   uncaught exception with a full stack trace (verified with a nonexistent path — exit 1, stack trace).
   Fail-closed, but noisy. Suggested fix: catch in `diffAction`, write `error: <message>` to stderr,
   set `process.exitCode = 1` (or a distinct code such as 2).
3. **Example workflow hardcodes `openapi.json`** while its `paths:` trigger also lists `openapi.yaml`.
   A YAML spec would hit issue #1 (empty base file → crash) even though the repo is wired for YAML.
   Suggested fix: parameterize the filename or document JSON-only for the example.
4. **`|| true` also masks real `git show` failures** (e.g. permission/corruption), not just "file absent".
5. **Args quoting limitation:** `${{ inputs.args }}` word-splits, so an arg containing spaces cannot be
   passed as one token. Acceptable for typical use (`args: openapi.json`), but worth documenting.
6. **Diff engine coverage gap:** `src/diff.ts` only inspects paths/operations, parameters (added required,
   type changed, enum narrowed) and responses. Removing a parameter entirely is **not** flagged, and
   schema-shape changes inside `components.schemas` (e.g. deleting `Pet.name`) are **not** detected at all.
   The fixtures were chosen within this coverage (path removal + parameter enum narrowing). Teams relying
   on the Action as a breaking-change gate should know property-level breaking changes slip through.
7. **`asubilla/OpenApiMCP@main` casing/naming** differs from the npm package `@asubilla/openapimcp`;
   this is presumably intentional (repo name) but is unverifiable without the repo being public and the
   composite action present on `main`.

## What remains

- The Action has **not been executed on a GitHub-hosted runner** (no workflow run exists yet). This
  verification simulates the CLI behavior the Action wraps and statically inspects the wiring; a first
  real run on a test PR is still needed to catch runner-specific issues (checkout refspec for
  `origin/${{ github.base_ref }}`, npm availability of `@asubilla/openapimcp@latest`, `/tmp` path handling).
- The example workflow assumes the repository `asubilla/OpenApiMCP` exists on GitHub with `action.yml`
  on its default branch, and that `@asubilla/openapimcp` on npm is up to date with that ref.
- Suggested first-run check: open a PR in a scratch API repo adding a breaking change to `openapi.json`
  and confirm the `spec-review` check goes red with the `breaking: N` summary in the step log.

## Verdict

The happy-path wiring is correct: the example workflow invokes the composite action with
`command: diff`, `spec` = extracted base spec, `args` = head spec; the action expands to
`npx @asubilla/openapimcp@<version> diff <base> <head>`; the CLI exits 1 on breaking changes and the
composite `bash -e` step propagates that as a failed check. The example is fragile for first-time
specs (issues #1 and #3) and the failure UX for unparseable specs is poor (issue #2), but nothing
here blocks the gate from failing closed.
