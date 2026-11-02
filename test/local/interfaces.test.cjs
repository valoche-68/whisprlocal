const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { readBridge, invoke } = require("../../src/local/bridgeClient.cjs");
const { dispatch } = require("../../src/local/mcp.cjs");
const { isAllowed, setConfigured } = require("../../src/local/networkPolicy.cjs");
test("network policy refuses official and unconfigured services, preserves downloads and explicit servers", () => {
  setConfigured(["https://speech.example.org/v1", "https://api.openwhispr.com"]);
  for (const u of [
    "https://api.openwhispr.com/a",
    "https://auth.openwhispr.com",
    "https://mcp.openwhispr.com",
    "https://openwhisper.com",
    "https://google.com",
    "https://speech.example.org.evil.com",
  ])
    assert.equal(isAllowed(u), false, u);
  for (const u of [
    "http://127.0.0.1:8178/health",
    "http://localhost:8221",
    "file:///tmp/app",
    "https://github.com/OpenWhispr/whisper.cpp/releases",
    "https://huggingface.co/a",
    "https://speech.example.org/v1/transcriptions",
  ])
    assert.equal(isAllowed(u), true, u);
  setConfigured([]);
  assert.equal(isAllowed("https://speech.example.org/v1"), false);
});
test("CLI and MCP use authenticated loopback requests and validate operations", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wl-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const token = "a".repeat(64);
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        data: req.url.includes("/notes") ? [{ id: 1, title: "Bonjour français" }] : { ok: true },
      })
    );
  });
  let port;
  for (let p = 8200; p <= 8219; p++) {
    try {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(p, "127.0.0.1", resolve);
      });
      port = p;
      break;
    } catch {}
  }
  assert.ok(port, "test bridge port");
  t.after(() => server.close());
  const file = path.join(dir, "bridge.json");
  fs.writeFileSync(file, JSON.stringify({ version: 1, port, token }), { mode: 0o600 });
  const bridge = readBridge(file);
  assert.equal(
    (await invoke("notes_list", { limit: 2 }, bridge)).data[0].title,
    "Bonjour français"
  );
  assert.equal(seen.at(-1).auth, `Bearer ${token}`);
  assert.equal(seen.at(-1).url, "/v1/notes/list?limit=2");
  await assert.rejects(invoke("notes_read", { id: "../../etc/passwd" }, bridge), /integer/);
  await assert.rejects(invoke("notes_list", { url: "https://evil.test" }, bridge), /Unknown/);
  const tools = await dispatch({ jsonrpc: "2.0", id: 1, method: "tools/list" }, bridge);
  assert.equal(tools.tools.length, 19);
  assert.ok(tools.tools.find((t) => t.name === "notes_delete").annotations.destructiveHint);
  const result = await dispatch(
    { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "notes_list", arguments: {} } },
    bridge
  );
  assert.equal(result.isError, false);
  assert.match(result.content[0].text, /Bonjour/);
  const cli = spawn(process.execPath, ["src/local/command.cjs", "notes", "list"], {
    env: { ...process.env, WHISPRLOCAL_BRIDGE: file },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let out = "";
  cli.stdout.on("data", (s) => (out += s));
  assert.equal(await new Promise((r) => cli.on("close", r)), 0);
  assert.match(out, /Bonjour/);
  fs.chmodSync(file, 0o644);
  assert.throws(() => readBridge(file), /private/);
  fs.chmodSync(file, 0o600);
  await new Promise((resolve) => server.close(resolve));
  await assert.rejects(invoke("health", {}, bridge), /not running/);
});
test("MCP negotiates a supported protocol and ignores notifications", async () => {
  const reply = await dispatch({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18" },
  });
  assert.equal(reply.protocolVersion, "2025-06-18");
  assert.deepEqual(reply.capabilities, { tools: {} });
  assert.equal(await dispatch({ jsonrpc: "2.0", method: "notifications/initialized" }), undefined);
});
