if (!localStorage.getItem("whisprlocalProfileImported")) {
  const values = window.electronAPI?.readMigrationPreferences?.() || {};
  for (const [key, value] of Object.entries(values))
    if (typeof value === "string") localStorage.setItem(key, value);
  localStorage.setItem("whisprlocalProfileImported", "true");
}
// Must be imported before settingsStore. Never import account sessions or cloud secrets.
// A legacy Custom speech setup stored its explicitly configured server under provider keys.
for (const [modeKey, legacy, remote] of [
  ["transcriptionMode", "cloudTranscription", "remoteTranscription"],
  ["uploadTranscriptionMode", "uploadCloudTranscription", "uploadRemoteTranscription"],
]) {
  if (
    localStorage.getItem(modeKey) !== "self-hosted" ||
    localStorage.getItem(`${legacy}Provider`) !== "custom" ||
    localStorage.getItem(`${remote}Url`)?.trim()
  ) continue;
  const legacyUrl = localStorage.getItem(`${legacy}BaseUrl`)?.trim();
  if (!legacyUrl) continue;
  try {
    const url = new URL(legacyUrl);
    const host = url.hostname.replace(/\.+$/, "");
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username || url.password ||
      /(^|\.)(openwhispr|openwhisper)\.com$/i.test(host)
    ) continue;
    localStorage.setItem(`${remote}Url`, legacyUrl);
    const model = localStorage.getItem(`${legacy}Model`);
    if (model && !localStorage.getItem(`${remote}Model`)?.trim())
      localStorage.setItem(`${remote}Model`, model);
  } catch {
    // Leave an invalid legacy value unused.
  }
}
const modes = [
  "transcriptionMode",
  "meetingTranscriptionMode",
  "uploadTranscriptionMode",
  "cleanupMode",
  "noteFormattingMode",
  "translationMode",
  "chatAgentMode",
  "dictationAgentMode",
  "dictationAgentVisionMode",
];
for (const key of modes) {
  const availableModes = key === "meetingTranscriptionMode" ? ["local"] : ["local", "self-hosted"];
  if (!availableModes.includes(localStorage.getItem(key)))
    localStorage.setItem(key, "local");
}
for (const [key, mode] of [
  ["useLocalWhisper", "transcriptionMode"],
  ["meetingUseLocalWhisper", "meetingTranscriptionMode"],
  ["uploadUseLocalWhisper", "uploadTranscriptionMode"],
])
  localStorage.setItem(key, localStorage.getItem(mode) === "local" ? "true" : "false");
for (const key of [
  "cloudBackupEnabled",
  "insightsSyncEnabled",
  "telemetryEnabled",
  "isSignedIn",
  "allowOpenAIFallback",
  // Screen-aware inference is not implemented by this local edition.
  "voiceAgentScreenContext",
  "useDictationAgentVisionModel",
])
  localStorage.setItem(key, "false");
localStorage.setItem("authenticationSkipped", "true");
localStorage.setItem("skipAuth", "true");
