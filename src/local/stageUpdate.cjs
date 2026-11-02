// Load our code and tar dependencies before disabling Electron's ASAR handling.
const { stageArchive } = require("./archiveUpdates.cjs");
process.noAsar = true;
stageArchive(...process.argv.slice(2)).then(
  (target) => process.stdout.write(JSON.stringify({ target })),
  (error) => {
    console.error(error.message);
    process.exitCode = 1;
  }
);
