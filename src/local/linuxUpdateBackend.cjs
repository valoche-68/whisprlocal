const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { app, net } = require("electron");
const updates = require("./archiveUpdates.cjs");
class LinuxUpdateBackend extends EventEmitter {
  constructor() {
    super();
    this.autoInstallOnAppQuit = false;
    this.isApplying = false;
    app.on("before-quit", () => {
      if (this.autoInstallOnAppQuit && this.staged && !this.deb && !this.isApplying)
        this.launchApplier();
    });
    this.isManaged = false;
    const candidate = path.resolve(path.dirname(process.execPath), "../..");
    if (fs.existsSync(path.join(candidate, "install.json"))) {
      this.base = candidate;
      this.isManaged = true;
    }
    // A separately installed Debian package must not redirect updates for the
    // managed user installation that is actually running.
    this.deb = !this.isManaged && fs.existsSync("/var/lib/dpkg/info/whisprlocal.list");
  }
  setFeedURL() {}
  async checkForUpdates() {
    this.emit("checking-for-update");
    try {
      this.info = await updates.releaseInfo(net.fetch.bind(net), app.getVersion());
      if (this.info) {
        this.emit("update-available", this.info);
        return { isUpdateAvailable: true, updateInfo: this.info };
      }
      this.emit("update-not-available");
      return { isUpdateAvailable: false };
    } catch (e) {
      this.emit("error", e);
      throw e;
    }
  }
  async downloadUpdate() {
    if (!this.info) throw new Error("Check for updates first");
    if (!this.isManaged && !this.deb)
      throw new Error(
        "Install this archive with scripts/whisprlocal/install.sh to enable managed updates"
      );
    try {
      const file = await updates.downloadVerified(
        net.fetch.bind(net),
        this.info,
        this.deb ? "deb" : "tar.gz",
        path.join(app.getPath("userData"), "updates"),
        (p) => this.emit("download-progress", p)
      );
      this.staged = this.deb
        ? file
        : await updates.stageArchive(file, this.base, this.info.version);
      this.emit("update-downloaded", this.info);
    } catch (e) {
      this.emit("error", e);
      throw e;
    }
  }
  quitAndInstall() {
    if (!this.staged) throw new Error("No staged update");
    if (this.deb) {
      const { execFile } = require("node:child_process");
      execFile("pkexec", ["/usr/bin/dpkg", "-i", this.staged], (err) => {
        if (err) this.emit("error", err);
        else {
          app.relaunch();
          app.quit();
        }
      });
      return;
    }
    this.launchApplier();
    app.quit();
  }
  launchApplier() {
    if (this.isApplying) return;
    this.isApplying = true;
    const child = spawn(
      process.execPath,
      [path.join(__dirname, "applyUpdate.cjs"), String(process.pid), this.base, this.staged],
      { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, detached: true, stdio: "ignore" }
    );
    child.unref();
  }
}
module.exports = LinuxUpdateBackend;
