const { bundledHelp } = require("./productHelpFallback");
const topics = require("../config/productHelpTopics.json");

function createProductHelp() {
  return {
    async lookup({ topic } = {}) {
      if (!Object.hasOwn(topics, topic)) throw new Error("Unknown help topic");
      return bundledHelp(topic, "privacy");
    },
  };
}

function registerProductHelpIpc({ ipcMain, getBasics }) {
  const help = createProductHelp();
  ipcMain.handle("product-help-basics", () => getBasics());
  ipcMain.handle("product-help", (_event, _id, input) => help.lookup(input));
}

module.exports = { createProductHelp, registerProductHelpIpc };
