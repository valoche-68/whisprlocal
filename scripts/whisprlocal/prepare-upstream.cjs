// Run this trusted script from the current main branch, never from imported code.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
function prepareMigration(repo, tag) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error("Only stable upstream tags are accepted");
  const git = (args, cwd = repo, allowFailure = false) => {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status && !allowFailure) throw new Error(r.stderr || r.stdout || "git failed");
    return r;
  };
  const previous = JSON.parse(fs.readFileSync(path.join(repo, "upstream.json"), "utf8"));
  const identity = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  const commit = git(["rev-parse", `${tag}^{commit}`]).stdout.trim();
  const branch = `upstream/${tag}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "whisprlocal-upstream-"));
  try {
    git(["worktree", "add", "--detach", temp, commit]);
    // Upstream's version is tracked separately. Normalize just this vendor metadata
    // to the previous upstream version, avoiding a predictable package-version conflict.
    for (const file of ["package.json", "package-lock.json"]) {
      const p = path.join(temp, file);
      if (!fs.existsSync(p)) continue;
      const value = JSON.parse(fs.readFileSync(p, "utf8"));
      value.version = previous.version;
      if (value.packages?.[""]) value.packages[""].version = previous.version;
      fs.writeFileSync(p, JSON.stringify(value, null, 2) + "\n");
    }
    git(["add", "package.json", "package-lock.json"], temp);
    const dirty = git(["diff", "--cached", "--quiet"], temp, true).status;
    if (dirty)
      git(
        [
          "-c",
          "user.name=WhisprLocal upstream monitor",
          "-c",
          "user.email=upstream-monitor@users.noreply.github.com",
          "commit",
          "-m",
          `Track upstream ${tag} without changing downstream version metadata`,
        ],
        temp
      );
    const vendor = git(["rev-parse", "HEAD"], temp).stdout.trim();
    git(["switch", "-c", branch]);
    const merge = git(
      [
        "-c",
        "user.name=WhisprLocal upstream monitor",
        "-c",
        "user.email=upstream-monitor@users.noreply.github.com",
        "merge",
        "--no-ff",
        "--no-commit",
        vendor,
      ],
      repo,
      true
    );
    let conflicts = [];
    if (merge.status) {
      conflicts = git(["diff", "--name-only", "--diff-filter=U"])
        .stdout.trim()
        .split("\n")
        .filter(Boolean);
      git(["merge", "--abort"]);
      if (!conflicts.length) throw new Error(merge.stderr || "Upstream merge failed");
      const report = path.join(repo, ".github", "upstream-conflicts", `${tag}.md`);
      fs.mkdirSync(path.dirname(report), { recursive: true });
      fs.writeFileSync(
        report,
        `# Upstream ${tag}: manual migration required\n\nPublication is blocked. No conflicting file was resolved automatically.\n\n${conflicts.map((f) => " - `" + f + "`").join("\n")}\n\nResolve the migration and remove this report before release.\n`
      );
    } else {
      const next = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
      if (next.name !== identity.name || next.version !== identity.version) {
        git(["merge", "--abort"]);
        throw new Error("Upstream changed the downstream identity; manual migration required");
      }
      fs.writeFileSync(
        path.join(repo, "upstream.json"),
        JSON.stringify({ ...previous, version: tag.slice(1), tag, commit }, null, 2) + "\n"
      );
    }
    git(["add", "-A"]);
    git([
      "-c",
      "user.name=WhisprLocal upstream monitor",
      "-c",
      "user.email=upstream-monitor@users.noreply.github.com",
      "commit",
      "-m",
      conflicts.length
        ? `Block upstream ${tag}: migration conflicts`
        : `Merge OpenWhispr ${tag} for human review`,
    ]);
    return { branch, tag, commit, conflicts };
  } finally {
    git(["worktree", "remove", "--force", temp], repo, true);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}
if (require.main === module) {
  try {
    const result = prepareMigration(process.cwd(), process.argv[2]);
    console.log(JSON.stringify(result));
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(
        process.env.GITHUB_OUTPUT,
        `branch=${result.branch}\nconflicted=${Boolean(result.conflicts.length)}\n`
      );
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
  }
}
module.exports = { prepareMigration };
