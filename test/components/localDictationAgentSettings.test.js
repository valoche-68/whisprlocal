const test = require("node:test");
const assert = require("node:assert/strict");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("local assistant settings retain text inference and prompts without unsupported screen capture controls", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, {
    cachePrefix: "whisprlocal-text-assistant-settings-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `export function useTranslation() { return { t: (key) => key }; }`,
      "/stores/settingsStore": `
        const state = { useDictationAgent: true, setUseDictationAgent() {}, voiceAgentScreenContext: true, useDictationAgentVisionModel: true };
        export const useSettingsStore = (select) => select(state);
      `,
      "/stores/policyStore": `export const usePolicyStore = (select) => select({ status: "unmanaged", policy: null });`,
      "/utils/agentName": `export const useAgentName = () => ({ agentName: "Local assistant", setAgentName() {} });`,
      "/InferenceConfigEditor": `import React from "react"; export default function Editor({scope}) { return React.createElement("div", {"data-inference-scope": scope}); }`,
      "/ui/PromptStudio": `import React from "react"; export default function Studio({kind}) { return React.createElement("div", {"data-prompt-kind": kind}); }`,
    },
  });
  const { default: Settings } = await vite.ssrLoadModule(
    "/components/settings/DictationAgentSettings.tsx"
  );
  const markup = renderToStaticMarkup(React.createElement(Settings));
  assert.match(markup, /dictationAgent\.enabled/);
  assert.match(markup, /data-inference-scope="dictationAgent"/);
  assert.match(markup, /data-prompt-kind="dictationAgent"/);
  assert.match(markup, /settingsPage\.agentConfig\.agentName/);
  assert.doesNotMatch(markup, /dictationAgent\.screenContext/);
  assert.doesNotMatch(markup, /data-inference-scope="dictationAgentVision"/);
});
