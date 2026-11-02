// Detached helper: the current executable remains available for rollback.
const { spawn } = require("node:child_process");
const path = require("node:path");
const { switchVersion } = require("./archiveUpdates.cjs");
async function main() {
  const [pidText, base, target] = process.argv.slice(2);
  const pid = Number(pidText);
  if (!Number.isInteger(pid) || pid < 2) throw new Error("Invalid parent PID");
  for (let n = 0; n < 240; n++) {
    try {
      process.kill(pid, 0);
    } catch {
      await switchVersion(base, target);
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      spawn(path.join(base, "current", "whisprlocal"), [], {
        detached: true,
        stdio: "ignore",
        env,
      }).unref();
      return;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Application did not close; update remains staged");
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
