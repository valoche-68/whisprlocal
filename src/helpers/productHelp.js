const { compareAppVersions, isCanonicalAppVersion } = require("./appVersion");
const { DOCS_ORIGIN: ORIGIN, bundledHelp: bundled } = require("./productHelpFallback");
const topics = require("../config/productHelpTopics.json");
const AgentStreamRequestRegistry = require("./agentStreamRequestRegistry");

const ENDPOINT = `${ORIGIN}/mcp`;
const MAX_RESPONSE_BYTES = 128 * 1024;
// Bound the whole model payload: oversize evidence falls back explicitly.
const MAX_TEXT = 12000;
const MAX_TOTAL_TEXT = 24000;

function validPage(value) {
  return (
    typeof value === "string" &&
    value.length <= 160 &&
    /^\/(?:help|guides|platform|integrations)\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/.test(value)
  );
}

async function readBounded(response) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error("Help response too large");
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    await reader.cancel().catch(() => {});
  }
}

function parseRpc(text, id) {
  const messages = text.trim().startsWith("{")
    ? [text]
    : text
        .split(/\r?\n\r?\n/)
        .map((block) =>
          block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
        )
        .filter(Boolean);
  for (const message of messages) {
    const parsed = JSON.parse(message);
    if (parsed.id !== id) continue;
    if (parsed.error || parsed.result?.isError || !parsed.result)
      throw new Error("Help unavailable");
    return parsed.result;
  }
  throw new Error("Missing help response");
}

function createProductHelp() {
  return {
    async lookup({ topic } = {}) {
      if (!Object.hasOwn(topics, topic)) throw new Error("Unknown help topic");
      return bundled(topic, "local-edition");
    },
  };
}

function remoteHelpPolicyState(snapshot, appVersion) {
  if (snapshot?.success !== true || typeof snapshot.managed !== "boolean") return "unavailable";
  if (!snapshot.managed) return "allowed";
  const policy = snapshot.policy;
  if (!policy?.features || !Array.isArray(policy.llm?.allowedModes)) return "unavailable";
  if (
    policy.minAppVersion &&
    (!isCanonicalAppVersion(policy.minAppVersion) || !isCanonicalAppVersion(appVersion))
  )
    return "unavailable";
  return (policy.minAppVersion && compareAppVersions(appVersion, policy.minAppVersion) < 0) ||
    policy.features.agentEnabled === false ||
    policy.features.webSearchEnabled !== true ||
    !policy.llm.allowedModes.some((mode) => mode === "openwhispr" || mode === "providers")
    ? "blocked"
    : "allowed";
}

function remoteHelpAllowed(snapshot, appVersion) {
  return remoteHelpPolicyState(snapshot, appVersion) === "allowed";
}

function registerProductHelpIpc({ ipcMain, fetch, canLookup, getBasics }) {
  const help = createProductHelp({ fetch });
  const requests = new AgentStreamRequestRegistry();
  const active = new Map();
  ipcMain.handle("product-help-basics", () => getBasics());
  ipcMain.handle("product-help", async (event, id, input) => {
    if (typeof id !== "string" || id.length > 100 || !id || (active.get(event.sender.id) || 0) >= 4)
      throw new Error("Help request unavailable");
    const sender = event.sender;
    const controller = requests.begin(sender.id, id);
    active.set(sender.id, (active.get(sender.id) || 0) + 1);
    const destroyed = () => requests.cancelSender(sender.id);
    sender.once("destroyed", destroyed);
    try {
      // The shared resolver owns the deadline and cached-policy fallback.
      const policySignal = controller.signal;
      const allowed = await new Promise((resolve) => {
        const stop = () => resolve("unavailable");
        policySignal.addEventListener("abort", stop, { once: true });
        Promise.resolve()
          .then(() => canLookup(event, policySignal))
          .then(resolve, () => resolve("unavailable"))
          .finally(() => policySignal.removeEventListener("abort", stop));
      });
      return await help.lookup(input || {}, { signal: controller.signal, allowed });
    } finally {
      const remaining = (active.get(sender.id) || 1) - 1;
      if (remaining) active.set(sender.id, remaining);
      else active.delete(sender.id);
      sender.removeListener("destroyed", destroyed);
      requests.complete(sender.id, id, controller);
    }
  });
  ipcMain.on("product-help-cancel", (event, id) => requests.cancel(event.sender.id, id));
}

module.exports = {
  createProductHelp,
  registerProductHelpIpc,
  remoteHelpAllowed,
  remoteHelpPolicyState,
};
