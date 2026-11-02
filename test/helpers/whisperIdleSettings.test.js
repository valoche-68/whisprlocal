const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");

test("Whisper idle preference defaults to five seconds and persists valid choices", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "whisper-idle-settings-" });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, 5);
  assert.equal(useSettingsStore.getState().whisperIdleUnloadEnabled, true);
  for (const value of [5, 10, 30, 60, 300]) {
    useSettingsStore.getState().setWhisperIdleTimeoutSeconds(value);
    assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, value);
    assert.equal(localStorage.getItem("whisperIdleTimeoutSeconds"), String(value));
  }
  for (const value of [0, -1, 2, 2.5, NaN, Infinity]) {
    useSettingsStore.getState().setWhisperIdleTimeoutSeconds(value);
    assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, 300);
  }
});

test("saved timeout restores on startup", async (t) => {
  installBrowserGlobals(t, { initialStorage: { whisperIdleTimeoutSeconds: "30" } });
  const vite = await createRendererServer(t, { cachePrefix: "whisper-idle-restore-" });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, 30);
});

test("invalid saved timeout falls back to five seconds", async (t) => {
  installBrowserGlobals(t, { initialStorage: { whisperIdleTimeoutSeconds: "-100" } });
  const vite = await createRendererServer(t, { cachePrefix: "whisper-idle-invalid-" });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, 5);
});

test("French control renders an associated label and explains the transcription deadline", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "whisper-idle-control-" });
  const { default: i18n } = await vite.ssrLoadModule("/i18n.ts");
  await i18n.changeLanguage("fr");
  t.after(() => i18n.changeLanguage("en"));
  const { default: WhisperIdleSettings } = await vite.ssrLoadModule(
    "/components/settings/WhisperIdleSettings.tsx"
  );
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const html = renderToStaticMarkup(React.createElement(WhisperIdleSettings));
  assert.match(html, /Décharger Whisper après inactivité/);
  assert.match(html, /fin complète de la transcription/);
  const labelFor = html.match(/<label[^>]*for="([^"]+)"/)[1];
  assert.ok(html.includes(`id="${labelFor}"`));
  assert.match(html, /aria-describedby=/);
});

test("turning automatic unloading off and on preserves the selected duration", async (t) => {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t, { cachePrefix: "whisper-idle-toggle-" });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  useSettingsStore.getState().setWhisperIdleTimeoutSeconds(60);
  useSettingsStore.getState().setWhisperIdleUnloadEnabled(false);
  assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, 60);
  assert.equal(localStorage.getItem("whisperIdleUnloadEnabled"), "false");
  useSettingsStore.getState().setWhisperIdleUnloadEnabled(true);
  assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, 60);
  assert.equal(localStorage.getItem("whisperIdleUnloadEnabled"), "true");
});

test("restores the disabled switch and remembered duration after restart", async (t) => {
  installBrowserGlobals(t, {
    initialStorage: { whisperIdleUnloadEnabled: "false", whisperIdleTimeoutSeconds: "60" },
  });
  const vite = await createRendererServer(t, { cachePrefix: "whisper-idle-disabled-" });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  assert.equal(useSettingsStore.getState().whisperIdleUnloadEnabled, false);
  assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, 60);
  const { default: i18n } = await vite.ssrLoadModule("/i18n.ts");
  await i18n.changeLanguage("fr");
  t.after(() => i18n.changeLanguage("en"));
  const { default: Control } = await vite.ssrLoadModule(
    "/components/settings/WhisperIdleSettings.tsx"
  );
  const html = require("react-dom/server").renderToStaticMarkup(
    require("react").createElement(Control)
  );
  assert.match(html, /aria-checked="false"/);
  assert.match(html, /Whisper reste chargé/);
  assert.match(
    html,
    /<button[^>]*disabled=""[^>]*role="combobox"|<button[^>]*role="combobox"[^>]*disabled=""/
  );
});

test("migrates the previous Never value to a disabled switch and keeps it disabled when editing delay", async (t) => {
  installBrowserGlobals(t, { initialStorage: { whisperIdleTimeoutSeconds: "0" } });
  const vite = await createRendererServer(t, { cachePrefix: "whisper-idle-never-migrate-" });
  const { useSettingsStore } = await vite.ssrLoadModule("/stores/settingsStore.ts");
  assert.equal(useSettingsStore.getState().whisperIdleUnloadEnabled, false);
  assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, 5);
  useSettingsStore.getState().setWhisperIdleTimeoutSeconds(30);
  assert.equal(useSettingsStore.getState().whisperIdleUnloadEnabled, false);
  assert.equal(localStorage.getItem("whisperIdleUnloadEnabled"), "false");
});

test("syncs both switch and delay from other application windows", async (t) => {
  const listeners = new Map();
  installBrowserGlobals(t, {
    initialStorage: { customDictionary: '["OpenWhispr"]' },
    window: {
      addEventListener: (name, callback) => listeners.set(name, callback),
      electronAPI: { getOpenAIKey: async () => "", setDictionary: async () => {} },
    },
  });
  const vite = await createRendererServer(t, { cachePrefix: "whisper-idle-window-sync-" });
  const { initializeSettings, useSettingsStore } = await vite.ssrLoadModule(
    "/stores/settingsStore.ts"
  );
  await initializeSettings();
  const change = (key, newValue) =>
    listeners.get("storage")({ key, newValue, storageArea: localStorage });
  change("whisperIdleTimeoutSeconds", "60");
  change("whisperIdleUnloadEnabled", "false");
  assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, 60);
  assert.equal(useSettingsStore.getState().whisperIdleUnloadEnabled, false);
  change("whisperIdleUnloadEnabled", "true");
  assert.equal(useSettingsStore.getState().whisperIdleUnloadEnabled, true);
  change("whisperIdleTimeoutSeconds", "-1");
  assert.equal(useSettingsStore.getState().whisperIdleTimeoutSeconds, 5);
});
