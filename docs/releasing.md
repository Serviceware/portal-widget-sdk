# Releasing

`@serviceware-oss/portal-widget-sdk` and `@serviceware-oss/portal-widget-cli` are published to
npmjs.com by [`.github/workflows/release.yml`](../.github/workflows/release.yml).

Everything up to the publish is manual and local. CI holds no npm token, writes no versions, opens no
pull requests, and runs only when a human starts it.

## How a release happens

Both packages are a **fixed version group** (`.changeset/config.json`), so they always carry the same
version and always ship together. One release, one version, one tag — a release never leaves one package
behind on an older version.

You prepare the whole release locally. CI only builds and publishes, and it publishes the tag you name.

1. Make your changes and add a changeset describing them:

   ```bash
   pnpm changeset              # pick the bump, write the summary
   ```

2. Apply the version bumps. This consumes the pending changesets, rewrites both `package.json`s to the
   same new version, updates the changelogs, and deletes the changeset files:

   ```bash
   pnpm version-packages
   ```

3. Commit and tag the release commit:

   ```bash
   git commit -am "chore: release v0.1.0"
   git tag v0.1.0
   ```

4. Push the commit and the tag together:

   ```bash
   git push --follow-tags
   ```

5. Actions → **Release** → **Run workflow**, and enter the tag (`v0.1.0`). The tag is a required input.

The job checks out `refs/tags/<tag>`, prints the tag, commit and the two package versions, builds, and
publishes both packages with provenance. Because it checks out the tag rather than a branch, what ships
is exactly what you tagged, however long ago you pushed it. A branch name or a bare SHA is not a valid
input — the checkout fails.

If a publish fails after the other package already went out, do not re-run: that version is taken on the
registry and npm will reject it with E403. Cut a new patch version instead.

## One-time setup

npm will not let you configure a trusted publisher for a package that does not exist yet
([npm/cli#8544](https://github.com/npm/cli/issues/8544)), so there is one unavoidable bootstrap
publish per package.

### 1. npm organisation

Create the org `serviceware-oss` on npmjs.com (free for public packages). Add at least two owners,
each a named Serviceware account with 2FA. No shared mailbox as a recovery address.

### 2. Bootstrap each package name

From a clean machine, once per package. Publish the version that is **currently in the repo**
(`0.0.0`) — not a higher one, or the release workflow will try to publish `0.0.0` on its next run.

```bash
npm login                               # as an org member with publish rights
npm publish ./packages/sdk --access public   # provenance is not available here; that is fine
npm deprecate "@serviceware-oss/portal-widget-sdk@0.0.0" "bootstrap placeholder, do not use"
```

Repeat for `./packages/cli`. The real first release (`0.1.0`) then comes from CI with provenance.

### 3. Trusted publisher, per package

npmjs.com → **Packages** → the package → **Settings** → **Trusted publishing**:

| Field | Value |
|---|---|
| Publisher | GitHub Actions |
| Organization or user | `Serviceware` |
| Repository | `portal-widget-sdk` |
| Workflow filename | `release.yml` |
| Environment | `release` |

All five fields matter. Without the environment, any branch that can reach `release.yml` can publish;
without the workflow filename, any workflow in the repository can.

### 4. Lock the package down

Same settings page → **Publishing access** → *Require two-factor authentication and disallow tokens*.
This is what makes step 3 the only way in. Do it after step 3, not before.

### 5. GitHub environment

Repository → **Settings** → **Environments** → **New environment** → `release`:

- **Deployment branches and tags**: selected refs → `main`.
- No environment secrets. There is nothing to put there.
- Required reviewers are optional — the manual trigger is already the human gate. Add them if you want
  a second pair of eyes on every publish.

The environment must exist and be named `release`, because npm's trusted publisher config pins it.

### 6. Remove any old credential

Repository → **Settings** → **Secrets and variables** → **Actions** → delete `NPM_TOKEN` if present.
Then revoke the bootstrap login from npmjs.com → **Access Tokens**, and confirm the list is empty.

## Checks

```bash
# No workflow references a publish token:
grep -rn "NPM_TOKEN\|NODE_AUTH_TOKEN" .github/workflows/        # expect no matches

# Exactly one job can mint an OIDC token:
grep -rn "id-token: write" .github/workflows/                   # expect exactly one line

# Nothing in CI can write to the repository or open PRs:
grep -rn "contents: write\|pull-requests: write" .github/workflows/   # expect no matches

# Every action is pinned to a full SHA:
grep -rhn "uses:" .github/workflows/ | grep -v "@[0-9a-f]\{40\}" # expect no matches
```

After a release, from any machine:

```bash
npm audit signatures                    # in a project that depends on the package
npm view @serviceware-oss/portal-widget-sdk --json | jq '.dist.attestations'
```

Provenance proves which workflow run built the tarball. It does not prove the tarball is benign.
