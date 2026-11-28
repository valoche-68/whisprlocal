// WhisprLocal has no third-party connector factories.
const CONNECTOR_FACTORIES = [];

// Two connectors with one id would share login slots and receipts: a build
// fault, thrown at startup like the manager's editable-type check.
function assertUniqueIds(connectors) {
  const seen = new Set();
  for (const connector of connectors) {
    if (seen.has(connector.id)) throw new Error(`connector id "${connector.id}" is used twice`);
    seen.add(connector.id);
  }
}

/**
 * deps: { fetch, i18n, runOAuthLoopbackFlow, OAuthFlowError, credentials,
 * logger, env, openExternal, writeClipboard, getGoogleCalendarAccounts,
 * broadcast, notifyStatusChanged } (spec §9.3).
 */
function createConnectors(deps, factories = CONNECTOR_FACTORIES) {
  const connectors = factories.map((build) => build(deps));
  assertUniqueIds(connectors);
  return connectors;
}

module.exports = { createConnectors };
