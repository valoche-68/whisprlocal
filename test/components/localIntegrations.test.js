const assert = require("node:assert/strict");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const { createRendererServer } = require("../lib/rendererTestHarness");

test("the local Integrations page offers bundled CLI, authenticated API and stdio MCP", async (t) => {
  const vite = await createRendererServer(t, {
    cachePrefix: "whisprlocal-integrations-",
    noExternal: ["react-i18next"],
    mockModules: {
      "react-i18next": `
        const t = (key) => key;
        export const useTranslation = () => ({ t, i18n: { language: "en" } });
      `,
      "/integrations/SkillsPane": `export function SkillsPane() { return null; }`,
    },
  });
  const { default: View } = await vite.ssrLoadModule("/components/IntegrationsView.tsx");
  const { INTEGRATIONS_SECTIONS } = await vite.ssrLoadModule(
    "/components/integrations/integrationsSections.ts"
  );
  const render = (section) =>
    renderToStaticMarkup(React.createElement(View, { section, onSectionChange() {} }));

  assert.deepEqual(INTEGRATIONS_SECTIONS, ["skills", "api", "mcp", "cli"]);
  assert.match(render("cli"), /whisprlocal.*--cli --help/);
  assert.match(render("cli"), /whisprlocal.*--cli notes list/);
  assert.match(render("api"), /whisprlocal.*--cli health/);
  assert.match(render("mcp"), /mcpServers[\s\S]+--mcp/);
  for (const obsoleteSection of ["connectors", "calendars"]) {
    const markup = render(obsoleteSection);
    assert.match(markup, /whisprlocal.*--cli --help/);
    assert.doesNotMatch(markup, /integrations\.nav\.sections\.(connectors|calendars)/);
  }
});
