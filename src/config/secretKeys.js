// Only credentials for explicitly configured self-hosted endpoints.
const BYOK_API_KEYS = [
  {
    base: "note-formatting-custom",
    env: "NOTE_FORMATTING_CUSTOM_API_KEY",
    get: "getNoteFormattingCustomKey",
    save: "saveNoteFormattingCustomKey",
    storeKey: "noteFormattingCustomApiKey",
  },
  {
    base: "translation-custom",
    env: "TRANSLATION_CUSTOM_API_KEY",
    get: "getTranslationCustomKey",
    save: "saveTranslationCustomKey",
    storeKey: "translationCustomApiKey",
  },
  {
    base: "dictation-agent-custom",
    env: "DICTATION_AGENT_CUSTOM_API_KEY",
    get: "getDictationAgentCustomKey",
    save: "saveDictationAgentCustomKey",
    storeKey: "dictationAgentCustomApiKey",
  },
  {
    base: "dictation-agent-vision-custom",
    env: "DICTATION_AGENT_VISION_CUSTOM_API_KEY",
    get: "getDictationAgentVisionCustomKey",
    save: "saveDictationAgentVisionCustomKey",
    storeKey: "dictationAgentVisionCustomApiKey",
  },
  {
    base: "chat-agent-custom",
    env: "CHAT_AGENT_CUSTOM_API_KEY",
    get: "getChatAgentCustomKey",
    save: "saveChatAgentCustomKey",
    storeKey: "chatAgentCustomApiKey",
  },
];
module.exports = { BYOK_API_KEYS };
