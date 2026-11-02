const str = { type: "string" },
  integer = { type: "integer", minimum: 1 };
const definitions = [
  ["health", "GET", "/v1/health", {}, [], "Check the running local application"],
  [
    "notes_list",
    "GET",
    "/v1/notes/list",
    { limit: integer, folder_id: integer, note_type: str },
    [],
    "List local notes",
  ],
  [
    "notes_search",
    "GET",
    "/v1/notes/search",
    { q: str, limit: integer },
    ["q"],
    "Search local notes",
  ],
  ["notes_read", "GET", "/v1/notes/:id", { id: integer }, ["id"], "Read a local note"],
  [
    "notes_create",
    "POST",
    "/v1/notes/create",
    { title: str, content: str, note_type: str, folder_id: integer },
    [],
    "Create a local note",
  ],
  [
    "notes_update",
    "PATCH",
    "/v1/notes/:id",
    { id: integer, title: str, content: str, enhanced_content: str, folder_id: integer },
    ["id"],
    "Update a local note",
  ],
  ["notes_delete", "DELETE", "/v1/notes/:id", { id: integer }, ["id"], "Delete a local note"],
  ["folders_list", "GET", "/v1/folders/list", {}, [], "List local folders"],
  [
    "folders_create",
    "POST",
    "/v1/folders/create",
    { name: str },
    ["name"],
    "Create a local folder",
  ],
  ["dictionary_list", "GET", "/v1/dictionary/list", {}, [], "Read the local dictionary"],
  [
    "dictionary_update",
    "POST",
    "/v1/dictionary/update",
    { add: { type: "array", items: str }, remove: { type: "array", items: str } },
    [],
    "Add or remove dictionary words",
  ],
  ["snippets_list", "GET", "/v1/snippets/list", {}, [], "Read local text snippets"],
  [
    "snippets_update",
    "POST",
    "/v1/snippets/update",
    {
      add: {
        type: "array",
        items: {
          type: "object",
          properties: { trigger: str, replacement: str },
          required: ["trigger", "replacement"],
          additionalProperties: false,
        },
      },
      remove: { type: "array", items: str },
    },
    [],
    "Add or remove local snippets",
  ],
  [
    "history_list",
    "GET",
    "/v1/transcriptions/list",
    { limit: integer },
    [],
    "List local transcription history",
  ],
  [
    "history_read",
    "GET",
    "/v1/transcriptions/:id",
    { id: integer },
    ["id"],
    "Read a local transcription",
  ],
  [
    "history_delete",
    "DELETE",
    "/v1/transcriptions/:id",
    { id: integer },
    ["id"],
    "Delete a transcription",
  ],
  [
    "history_delete_audio",
    "DELETE",
    "/v1/transcriptions/:id/audio",
    { id: integer },
    ["id"],
    "Delete retained audio for a transcription",
  ],
  [
    "transcribe_models",
    "GET",
    "/v1/transcribe/models",
    {},
    [],
    "List installed local speech models",
  ],
  [
    "transcribe_file",
    "POST",
    "/v1/transcribe",
    { path: str, model: str, language: str },
    ["path"],
    "Transcribe a local audio file using a downloaded model",
  ],
];
const operations = definitions.map(([name, method, route, properties, required, description]) => ({
  name,
  method,
  route,
  description,
  inputSchema: { type: "object", properties, required, additionalProperties: false },
  annotations: {
    readOnlyHint: method === "GET",
    destructiveHint: method === "DELETE" || method === "PATCH",
    openWorldHint: false,
    idempotentHint: method === "GET" || method === "DELETE",
  },
}));
function validate(schema, value, label = "arguments") {
  const type = Array.isArray(value) ? "array" : value === null ? "null" : typeof value;
  if (schema.type === "integer" ? !Number.isSafeInteger(value) : type !== schema.type)
    throw new Error(`${label} must be ${schema.type}`);
  if (schema.minimum !== undefined && value < schema.minimum)
    throw new Error(`${label} is out of range`);
  if (schema.type === "object") {
    for (const key of schema.required || [])
      if (!(key in value)) throw new Error(`${label}.${key} is required`);
    for (const [key, item] of Object.entries(value)) {
      if (!Object.hasOwn(schema.properties, key)) throw new Error(`Unknown argument: ${key}`);
      validate(schema.properties[key], item, `${label}.${key}`);
    }
  }
  if (schema.type === "array")
    value.forEach((item, i) => validate(schema.items, item, `${label}[${i}]`));
}
module.exports = { operations, validate };
