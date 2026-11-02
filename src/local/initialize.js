if (!localStorage.getItem("whisprlocalProfileImported")) {
  const values = window.electronAPI?.readMigrationPreferences?.() || {};
  for (const [key, value] of Object.entries(values))
    if (typeof value === "string") localStorage.setItem(key, value);
  localStorage.setItem("whisprlocalProfileImported", "true");
}
// Must be imported before settingsStore. Never import account sessions or cloud secrets.
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
  if (!["local", "self-hosted"].includes(localStorage.getItem(key)))
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
])
  localStorage.setItem(key, "false");
localStorage.setItem("authenticationSkipped", "true");
localStorage.setItem("skipAuth", "true");
