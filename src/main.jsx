import "./local/initialize.js";
import "./models/registryBootstrap.js";

// Preferences and the bundled model registry must be ready before the renderer
// imports settingsStore and i18n, even after the production build splits chunks.
void import("./renderer.jsx");
