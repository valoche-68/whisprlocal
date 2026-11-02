const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const files = fs
  .readdirSync("test/helpers")
  .filter((f) => /^(whisper|llama|gpu|cliBridge|localServer|clipboardRestore).*\.test\.js$/.test(f))
  .map((f) => "test/helpers/" + f);
const os = require("node:os");
const path = require("node:path");
const cache = fs.mkdtempSync(path.join(os.tmpdir(), "whisprlocal-tests-"));
const result = spawnSync(process.execPath, ["--import", "tsx", "--test", ...files], {
  stdio: "inherit",
  env: {
    ...process.env,
    REQUIRE_DB_TESTS: "1",
    XDG_CACHE_HOME: cache,
    DESKTOP_SESSION: "",
    XDG_SESSION_DESKTOP: "",
    KDE_FULL_SESSION: "",
    KDE_SESSION_VERSION: "",
    XDG_SESSION_TYPE: "x11",
    WAYLAND_DISPLAY: "",
    XDG_CURRENT_DESKTOP: "",
  },
});
fs.rmSync(cache, { recursive: true, force: true });
process.exitCode = result.status ?? 1;
