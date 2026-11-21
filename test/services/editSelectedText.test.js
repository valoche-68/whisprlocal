const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

async function editor(t, settings = {}) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "openwhispr-selection-edit-" });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  const { usePolicyStore } = await vite.ssrLoadModule("/stores/policyStore.ts");
  usePolicyStore.setState({ status: "unmanaged", policy: null });
  useSettingsStore.setState({
    useDictationAgent: true,
    dictationAgentMode: "self-hosted",
    dictationAgentProvider: "local",
    dictationAgentModel: "qwen3.5-4b",
    dictationAgentRemoteUrl: "http://127.0.0.1:11434",
    dictationAgentCustomApiKey: "assistant-token",
    isSignedIn: false,
    ...settings,
  });
  const service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  t.after(() => service.destroy());
  const { editSelectedText } = await vite.ssrLoadModule("/services/editSelectedText.ts");
  return { service, editSelectedText };
}

test("a self-hosted edit uses its scoped endpoint and token; no image is uploaded", async (t) => {
  const { service, editSelectedText } = await editor(t);
  const invoke = t.mock.method(service, "processText", async (_text, _model, _name, options) => {
    const marker = options.systemPrompt.match(/__OPENWHISPR_SELECTION_COMPLETE_[0-9a-f-]+/)[0];
    return `Revised text.${marker}`;
  });
  assert.equal(
    await editSelectedText("Rewrite", "Original", {
      attachment: { image: "image-fixture", mediaType: "image/png" },
      signal: new AbortController().signal,
    }),
    "Revised text."
  );
  assert.equal(invoke.mock.callCount(), 1);
  const [, model, , options] = invoke.mock.calls[0].arguments;
  assert.equal(model, "qwen3.5-4b");
  assert.equal(options.provider, "lan");
  assert.equal(options.lanUrl, "http://127.0.0.1:11434");
  assert.equal(options.customApiKey, "assistant-token");
  assert.equal(options.screenContext, undefined);
});

test("selection questions return the existing editor verdict; partial edits are rejected", async (t) => {
  const { service, editSelectedText } = await editor(t);
  let response = "__OPENWHISPR_SELECTION_QUESTION__";
  t.mock.method(service, "processText", async () => response);
  const options = { signal: new AbortController().signal };
  assert.equal(await editSelectedText("Explain this", "Original text", options), null);
  response = "Truncated replacement";
  await assert.rejects(editSelectedText("Rewrite this", "Original text", options), {
    code: "SELECTION_EDIT_INVALID_RESPONSE",
  });
});

test("an edit ending at the nonce, with no closing underscores, is accepted; a partial one is not", async (t) => {
  const { service, editSelectedText } = await editor(t);
  let cut = 0;
  t.mock.method(service, "processText", async (...args) => {
    const nonce = args[3].systemPrompt.match(/__OPENWHISPR_SELECTION_COMPLETE_[0-9a-f-]+/)[0];
    return `Revised.${nonce.slice(0, nonce.length - cut)}`;
  });
  const options = { signal: new AbortController().signal };
  assert.equal(await editSelectedText("Rewrite this", "Original.", options), "Revised.");
  cut = 1;
  await assert.rejects(editSelectedText("Rewrite this", "Original.", options), {
    code: "SELECTION_EDIT_INVALID_RESPONSE",
  });
});

test("the local editor uses its JSON contract and drops an answer after cancellation", async (t) => {
  const { service, editSelectedText } = await editor(t, {
    dictationAgentMode: "local",
    dictationAgentProvider: "local",
    dictationAgentModel: "qwen3.5-4b",
  });
  const controller = new AbortController();
  let config;
  t.mock.method(service, "processText", async (_text, _model, _name, options) => {
    config = options;
    return '{"replacement":"Edited locally."}';
  });
  assert.equal(
    await editSelectedText("Rewrite", "Original", { signal: controller.signal }),
    "Edited locally."
  );
  assert.equal(config.responseFormat.type, "json_object");
  assert.equal(config.disableThinking, true);
  controller.abort();
  await assert.rejects(editSelectedText("Rewrite", "Original", { signal: controller.signal }), {
    name: "AbortError",
  });
});

for (const mode of ["self-hosted", "local"]) {
  test(`the ${mode} selection editor preserves the selected app's Tone & Style`, async (t) => {
    const { service, editSelectedText } = await editor(t, {
      dictationAgentMode: mode,
      toneStyleEnabled: true,
      toneStyles: { personal: "very_casual", work: "formal", email: "formal", other: "formal" },
      customDictionary: ["ZephyrWidget"],
      customPrompts: { dictationAgent: "Use British spelling for {{agentName}}." },
    });
    let prompt;
    t.mock.method(service, "processText", async (_text, _model, _name, config) => {
      prompt = config.systemPrompt;
      const marker = prompt.match(/__OPENWHISPR_SELECTION_COMPLETE_[0-9a-f-]+/)?.[0] ?? "";
      return mode === "self-hosted" ? `edited${marker}` : '{"replacement":"edited"}';
    });
    await editSelectedText("Rewrite this", "Original", {
      appCategory: "personal",
      signal: new AbortController().signal,
    });
    assert.match(prompt, /user's personal message style/);
    assert.match(prompt, /all lowercase/);
    assert.match(prompt, /code and commands.*never restyled/);
    assert.match(prompt, /Use British spelling/);
    assert.match(prompt, /ZephyrWidget/);
  });
}
