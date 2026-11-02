#!/usr/bin/env node
const { operations } = require("./operations.cjs");
const { invoke } = require("./bridgeClient.cjs");
async function main(args = process.argv.slice(2)) {
  if (args[0] === "--mcp" || args[0] === "mcp") return require("./mcp.cjs").serve();
  if (args[0] === "--cli") args.shift();
  if (args[0] === "profile" && args[1] === "migrate") {
    if (!args[2])
      throw new Error("Usage: whisprlocal --cli profile migrate <source-profile> [target-profile]");
    const path = require("node:path"),
      os = require("node:os");
    const target =
      args[3] ||
      path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config"), "whisprlocal");
    console.log(
      JSON.stringify(
        await require("./profileMigration.cjs").migrate({ source: args[2], target }),
        null,
        2
      )
    );
    return;
  }

  if (!args.length || args.includes("--help")) {
    console.log(
      "WhisprLocal — local API client (application must be open)\nUsage: whisprlocal --cli <group> <operation> [id] [--key value] [--json '{...}']\n       whisprlocal --mcp\n\nOperations:\n" +
        operations.map((o) => "  " + o.name.replaceAll("_", " ")).join("\n")
    );
    return;
  }
  let name = args.shift();
  if (!operations.some((o) => o.name === name)) name += "_" + args.shift();
  const values = {};
  while (args.length) {
    const flag = args.shift();
    if (flag === "--json") {
      Object.assign(values, JSON.parse(args.shift()));
      continue;
    }
    if (!flag.startsWith("--")) {
      if (name === "transcribe_file") values.path = flag;
      else values.id = Number(flag);
      continue;
    }
    const key = flag.slice(2).replaceAll("-", "_");
    const raw = args.shift();
    if (raw === undefined) throw new Error(`Missing value for ${flag}`);
    const prop = operations.find((o) => o.name === name)?.inputSchema.properties[key];
    values[key] =
      prop?.type === "integer" ? Number(raw) : prop?.type === "array" ? JSON.parse(raw) : raw;
  }
  console.log(JSON.stringify(await invoke(name, values), null, 2));
}
if (require.main === module)
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
module.exports = { main };
