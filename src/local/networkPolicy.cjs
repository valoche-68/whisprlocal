const fs = require("node:fs");
const path = require("node:path");
const DOWNLOAD_HOSTS = new Set([
  "github.com",
  "api.github.com",
  "objects.githubusercontent.com",
  "raw.githubusercontent.com",
  "release-assets.githubusercontent.com",
  "github-releases.githubusercontent.com",
  "huggingface.co",
  "hf.co",
  "us.aws.cdn.hf.co",
  "eu.aws.cdn.hf.co",
  "us.gcp.cdn.hf.co",
  "cdn-lfs.hf.co",
  "cdn-lfs.huggingface.co",
  "cdn-lfs-us-1.huggingface.co",
  "cdn-lfs-eu-1.huggingface.co",
  "cas-bridge.xethub.hf.co",
  "cas-server.xethub.hf.co",
  "transfer.xethub.hf.co",
]);
const configured = new Set();
function official(host) {
  // A trailing DNS dot denotes the same host and must not bypass the ban.
  return /(^|\.)(openwhispr|openwhisper)\.com$/i.test(host.replace(/\.+$/, ""));
}
function isAllowed(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const h = url.hostname.toLowerCase();
  if (official(h)) return false;
  if (["file:", "data:", "blob:", "devtools:", "chrome-extension:"].includes(url.protocol))
    return true;
  if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)) return false;
  if (["localhost", "127.0.0.1", "[::1]"].includes(h)) return true;
  if (configured.has(url.origin)) return true;
  return url.protocol === "https:" && DOWNLOAD_HOSTS.has(h);
}
function setConfigured(urls) {
  configured.clear();
  for (const value of urls) {
    try {
      const u = new URL(value);
      if (!official(u.hostname) && ["http:", "https:"].includes(u.protocol)) {
        configured.add(u.origin);
        configured.add(u.origin.replace(/^http/, "ws"));
      }
    } catch {
      /* Unset endpoint */
    }
  }
}
function audit(url, allowed, transport) {
  const file = process.env.WHISPRLOCAL_NETWORK_AUDIT;
  if (!file) return;
  try {
    const target = new URL(String(url));
    if (["http:", "https:", "ws:", "wss:"].includes(target.protocol))
      fs.appendFileSync(
        file,
        JSON.stringify({
          time: new Date().toISOString(),
          origin: target.origin,
          allowed,
          transport,
        }) + "\n",
        { mode: 0o600 }
      );
  } catch {
    /* Auditing must not affect the request. No paths, query strings or credentials. */
  }
}
function assertAllowed(url) {
  audit(url, isAllowed(String(url)), "node");
  if (!isAllowed(String(url)))
    throw Object.assign(new Error("WhisprLocal blocked an unconfigured network destination"), {
      code: "NETWORK_POLICY",
    });
}
let installed = false;
function install({ app, session }) {
  if (installed) return;
  installed = true;
  const file = path.join(app.getPath("userData"), "self-hosted-origins.json");
  try {
    setConfigured(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    /* New profile */
  }
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    assertAllowed(typeof input === "string" || input instanceof URL ? input : input.url);
    return originalFetch(input, { ...init, redirect: "error" });
  };
  for (const protocol of ["http", "https"]) {
    const mod = require(`node:${protocol}`);
    const request = mod.request;
    mod.request = function (input, ...args) {
      const opts =
        typeof input === "string" || input instanceof URL
          ? input
          : new URL(
              `${input.protocol || protocol + ":"}//${input.hostname || input.host || "localhost"}${input.port ? ":" + input.port : ""}${input.path || "/"}`
            );
      assertAllowed(String(opts));
      return request.call(this, input, ...args);
    };
    mod.get = function (...args) {
      const req = mod.request(...args);
      req.end();
      return req;
    };
  }
  const protect = (s) =>
    s.webRequest.onBeforeRequest((details, done) => {
      const allowed = isAllowed(details.url);
      audit(details.url, allowed, "electron");
      done({ cancel: !allowed });
    });
  app.on("session-created", protect);
  app.whenReady().then(() => {
    protect(session.defaultSession);
    require("electron").ipcMain.handle("whisprlocal-configure-endpoints", (event, urls) => {
      if (
        !event.sender.getURL().startsWith("file:") &&
        !/^http:\/\/127\.0\.0\.1:5183/.test(event.sender.getURL())
      )
        throw new Error("Untrusted window");
      if (
        !Array.isArray(urls) ||
        urls.length > 32 ||
        urls.some((u) => typeof u !== "string" || u.length > 4096)
      )
        throw new Error("Invalid endpoint list");
      setConfigured(urls);
      fs.writeFileSync(
        file,
        JSON.stringify(
          urls
            .map((u) => {
              try {
                return new URL(u).origin;
              } catch {
                return "";
              }
            })
            .filter(Boolean)
        ),
        { mode: 0o600 }
      );
      return true;
    });
  });
}
module.exports = { isAllowed, setConfigured, assertAllowed, install };
