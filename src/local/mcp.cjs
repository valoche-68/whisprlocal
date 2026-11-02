const { operations } = require("./operations.cjs");
const { invoke, readBridge } = require("./bridgeClient.cjs");
const readline = require("node:readline");
const versions = ["2025-06-18", "2025-03-26", "2024-11-05"];
async function dispatch(message, bridge) {
  if (message?.jsonrpc !== "2.0" || typeof message.method !== "string")
    throw Object.assign(new Error("Invalid request"), { rpcCode: -32600 });
  if (message.id === undefined) return undefined;
  switch (message.method) {
    case "initialize":
      return {
        protocolVersion: versions.includes(message.params?.protocolVersion)
          ? message.params.protocolVersion
          : versions[0],
        capabilities: { tools: {} },
        serverInfo: { name: "whisprlocal", version: "0.1.0" },
        instructions:
          "Local application data. Deletion and updates modify the user's files; ask for user approval in your MCP client. The desktop application must be running.",
      };
    case "ping":
      return {};
    case "tools/list":
      return {
        tools: operations.map(({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          annotations,
        })),
      };
    case "tools/call":
      try {
        const result = await invoke(message.params?.name, message.params?.arguments ?? {}, bridge);
        return { content: [{ type: "text", text: JSON.stringify(result) }], isError: false };
      } catch (e) {
        return { content: [{ type: "text", text: e.message }], isError: true };
      }
    default:
      throw Object.assign(new Error("Method not found"), { rpcCode: -32601 });
  }
}
async function serve(input = process.stdin, output = process.stdout) {
  const bridge = readBridge();
  await invoke("health", {}, bridge);
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  for await (const line of lines) {
    let message;
    try {
      if (Buffer.byteLength(line) > 1024 * 1024) throw new Error("Message too large");
      message = JSON.parse(line);
    } catch {
      output.write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32700, message: "Parse error" },
        }) + "\n"
      );
      continue;
    }
    try {
      const result = await dispatch(message, bridge);
      if (result !== undefined)
        output.write(JSON.stringify({ jsonrpc: "2.0", id: message.id, result }) + "\n");
    } catch (e) {
      if (message.id !== undefined)
        output.write(
          JSON.stringify({
            jsonrpc: "2.0",
            id: message.id,
            error: { code: e.rpcCode || -32603, message: e.message },
          }) + "\n"
        );
    }
  }
}
module.exports = { serve, dispatch };
