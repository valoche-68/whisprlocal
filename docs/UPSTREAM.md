# Upstream migrations and releases

The repository retains OpenWhispr's history but is an independent regular GitHub repository. `upstream.json` pins the source version, tag and commit. WhisprLocal's own version belongs to `package.json` and follows a separate release sequence.

`.github/workflows/upstream.yml` checks stable upstream releases hourly and on manual dispatch. A trusted script from the existing main branch imports the tag without executing its code. Only upstream's package-version metadata is normalized to the preceding upstream version before merging; this avoids changing the downstream identity and does not resolve source conflicts.

A clean migration retains both histories, updates `upstream.json`, pushes `upstream/vX.Y.Z` and opens a draft pull request. A separate read-only job installs and tests the imported code without publication credentials. Passing checks make the PR ready for review. There is no automatic merge.

Conflicts abort the merge, retain the current implementation and commit a report naming the affected files under `.github/upstream-conflicts/`. The PR remains a draft. Resolve the migration manually, preserve downstream behavior and remove the blocking report before preparing a release. An existing migration branch is not overwritten by the hourly monitor.

The release workflow is manual, runs from main and builds Linux x86_64 `.deb`, AppImage and `.tar.gz` artifacts with SHA256SUMS. Build jobs have read permissions. A separate job receives write permission only to upload the completed artifacts into a draft release; it executes no imported build code. A person must publish the draft.

GitHub must allow Actions to create pull requests for the monitor to open one. If organization policy prevents this, the workflow fails visibly and requires a repository administrator to adjust that setting.

Before approving a migration or release, verify the retained visual style in French and English, offline inference, configured self-hosting, CLI/MCP, GPU loading/unloading, network destinations, profile migration and updater rollback. Never replace this edition with an unmodified official build.
