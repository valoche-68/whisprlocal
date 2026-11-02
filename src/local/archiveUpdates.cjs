const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const tar = require("tar");
const REPO = "valoche-68/whisprlocal";
function versionOf(tag) {
  if (!/^v?\d+\.\d+\.\d+$/.test(tag)) throw new Error("Invalid stable release version");
  return tag.replace(/^v/, "");
}
function newer(a, b) {
  const x = versionOf(a).split(".").map(Number),
    y = versionOf(b).split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] > y[i];
  }
  return false;
}
function assetUrl(asset) {
  const prefix = `https://github.com/${REPO}/releases/download/`;
  if (!asset?.browser_download_url?.startsWith(prefix))
    throw new Error("Release asset is outside the WhisprLocal repository");
  return asset.browser_download_url;
}
async function checkedResponse(fetch, url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Update request failed (${res.status})`);
  return res;
}
async function releaseInfo(fetch, current) {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Update check failed (${res.status})`);
  const r = await res.json();
  if (r.draft || r.prerelease) return null;
  const version = versionOf(r.tag_name);
  return newer(version, current)
    ? { version, releaseDate: r.published_at, releaseNotes: r.body || "", assets: r.assets || [] }
    : null;
}
async function downloadVerified(fetch, info, format, dir, progress = () => {}) {
  const name = `WhisprLocal-${versionOf(info.version)}-linux-x64.${format}`;
  const asset = info.assets.find((a) => a.name === name);
  const sums = info.assets.find((a) => a.name === "SHA256SUMS");
  if (!asset || !sums) throw new Error("This release is missing its Linux artifact or SHA256SUMS");
  const list = await (await checkedResponse(fetch, assetUrl(sums))).text();
  if (list.length > 1024 * 1024) throw new Error("Checksum list too large");
  const digest = list
    .split(/\r?\n/)
    .map((l) => l.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/))
    .find((m) => m?.[2] === name)?.[1];
  if (!digest) throw new Error("Artifact checksum missing");
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const destination = path.join(dir, name);
  const part = destination + ".part";
  const response = await checkedResponse(fetch, assetUrl(asset));
  const hash = crypto.createHash("sha256");
  let count = 0;
  const handle = await fs.open(part, "w", 0o600);
  try {
    for await (const chunk of response.body) {
      count += chunk.length;
      if (count > 8 * 1024 ** 3) throw new Error("Update too large");
      hash.update(chunk);
      await handle.write(chunk);
      progress({
        percent: asset.size ? (count / asset.size) * 100 : 0,
        transferred: count,
        total: asset.size || count,
      });
    }
    if (hash.digest("hex") !== digest.toLowerCase()) throw new Error("Update checksum mismatch");
  } catch (e) {
    await handle.close();
    await fs.rm(part, { force: true });
    throw e;
  }
  await handle.close();
  await fs.rename(part, destination);
  return destination;
}
function safeEntry(entry) {
  const name = entry.path;
  const clean = path.posix.normalize(name);
  if (path.posix.isAbsolute(name) || clean === ".." || clean.startsWith("../")) return false;
  if (!["File", "OldFile", "Directory", "SymbolicLink", "Link"].includes(entry.type)) return false;
  if (entry.linkpath) {
    const link = path.posix.normalize(
      path.posix.join(entry.type === "Link" ? "" : path.posix.dirname(clean), entry.linkpath)
    );
    if (path.posix.isAbsolute(entry.linkpath) || link === ".." || link.startsWith("../"))
      return false;
  }
  return true;
}
async function stageArchive(file, base, version) {
  // Electron virtualizes app.asar as a directory. Extract in an isolated Node
  // process so disabling ASAR never affects the running application's imports.
  if (process.versions.electron && !process.noAsar) {
    return new Promise((resolve, reject) => {
      execFile(
        process.execPath,
        [path.join(__dirname, "stageUpdate.cjs"), file, base, version],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, timeout: 600000, maxBuffer: 65536 },
        (error, stdout, stderr) => {
          if (error) return reject(new Error(stderr.trim() || error.message));
          try {
            resolve(JSON.parse(stdout).target);
          } catch {
            reject(new Error("Update staging helper returned an invalid result"));
          }
        }
      );
    });
  }
  version = versionOf(version);
  const versions = path.join(base, "versions");
  await fs.mkdir(versions, { recursive: true, mode: 0o700 });
  const target = path.join(versions, version);
  try {
    await fs.access(target);
    throw new Error("Version already staged; remove it explicitly before retrying");
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  let unsafe = false;
  await tar.t({
    file,
    onReadEntry: (e) => {
      if (!safeEntry(e)) unsafe = true;
    },
  });
  if (unsafe) throw new Error("Unsafe archive entry");
  const temp = await fs.mkdtemp(path.join(versions, ".staging-"));
  try {
    await tar.x({ file, cwd: temp, preservePaths: false, strict: true });
    let root = temp;
    try {
      await fs.access(path.join(root, "whisprlocal"));
    } catch {
      const entries = await fs.readdir(temp, { withFileTypes: true });
      if (entries.length !== 1 || !entries[0].isDirectory())
        throw new Error("Archive layout is invalid");
      root = path.join(temp, entries[0].name);
    }
    const st = await fs.stat(path.join(root, "whisprlocal"));
    if (!st.isFile() || !(st.mode & 0o111)) throw new Error("Archive executable missing");
    await fs.rename(root, target);
    if (root !== temp) await fs.rm(temp, { recursive: true, force: true });
    return target;
  } catch (e) {
    await fs.rm(temp, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
}
async function switchVersion(base, target) {
  const versions = await fs.realpath(path.join(base, "versions"));
  const real = await fs.realpath(target);
  if (path.dirname(real) !== versions)
    throw new Error("Update is outside the managed installation");
  await fs.access(path.join(real, "whisprlocal"));
  let previous = null;
  try {
    previous = await fs.realpath(path.join(base, "current"));
  } catch {}
  if (previous === real) return previous;
  const temporary = path.join(base, `.current-${process.pid}`);
  await fs.symlink(real, temporary);
  await fs.rename(temporary, path.join(base, "current"));
  if (previous) {
    const old = path.join(base, `.previous-${process.pid}`);
    await fs.symlink(previous, old);
    await fs.rename(old, path.join(base, "previous"));
  }
  return previous;
}
async function rollback(base) {
  const previous = await fs.realpath(path.join(base, "previous"));
  await switchVersion(base, previous);
  return previous;
}
module.exports = {
  REPO,
  versionOf,
  newer,
  releaseInfo,
  downloadVerified,
  safeEntry,
  stageArchive,
  switchVersion,
  rollback,
};
