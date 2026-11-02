const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { operations, validate } = require("./operations.cjs");
const NOT_RUNNING =
  "WhisprLocal is not running. Open the application, then retry. / WhisprLocal est fermé. Ouvrez l’application puis réessayez.";
function readBridge(
  file = process.env.WHISPRLOCAL_BRIDGE ||
    path.join(os.homedir(), ".whisprlocal", "cli-bridge.json")
) {
  let stat, bridge;
  try {
    stat = fs.lstatSync(file);
    bridge = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    throw new Error(NOT_RUNNING);
  }
  if (!stat.isFile() || stat.mode & 0o077 || (process.getuid && stat.uid !== process.getuid()))
    throw new Error("The local bridge token file must be owned by you and private (chmod 600)");
  if (
    bridge.version !== 1 ||
    !Number.isInteger(bridge.port) ||
    bridge.port < 8200 ||
    bridge.port > 8219 ||
    !/^[a-f0-9]{64}$/.test(bridge.token)
  )
    throw new Error("Invalid local bridge descriptor. Restart WhisprLocal.");
  return bridge;
}
function request(bridge, method, route, body) {
  return new Promise((resolve, reject) => {
    const encoded = body === undefined ? null : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: bridge.port,
        path: route,
        method,
        headers: {
          Authorization: `Bearer ${bridge.token}`,
          ...(encoded
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(encoded) }
            : {}),
        },
        timeout: method === "POST" && route === "/v1/transcribe" ? 3600000 : 30000,
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          if (size > 32 * 1024 * 1024) req.destroy(new Error("Local response too large"));
          else chunks.push(chunk);
        });
        res.on("end", () => {
          try {
            const result = chunks.length
              ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
              : { success: true };
            if (res.statusCode >= 400)
              throw new Error(result.error?.message || `Local API error ${res.statusCode}`);
            resolve(result);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on("error", (e) =>
      reject(new Error(["ECONNREFUSED", "ECONNRESET"].includes(e.code) ? NOT_RUNNING : e.message))
    );
    req.on("timeout", () => req.destroy(new Error("Local application timed out")));
    if (encoded) req.write(encoded);
    req.end();
  });
}
async function invoke(name, args = {}, bridge = readBridge()) {
  const op = operations.find((o) => o.name === name);
  if (!op) throw new Error(`Unknown operation: ${name}`);
  validate(op.inputSchema, args);
  let route = op.route;
  const values = { ...args };
  if (route.includes(":id")) {
    route = route.replace(":id", String(values.id));
    delete values.id;
  }
  if (op.method === "GET") {
    const q = new URLSearchParams(values).toString();
    if (q) route += "?" + q;
    return request(bridge, op.method, route);
  }
  return request(bridge, op.method, route, op.method === "DELETE" ? undefined : values);
}
module.exports = { readBridge, request, invoke, NOT_RUNNING };
