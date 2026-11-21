const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");

const load = () => import("../../src/components/onboarding/flow.ts");

const LOCAL_START = [
  "permissions",
  "languages",
  "use-cases",
  "dictation-hotkey",
  "assistant-hotkey",
  "setup-choice",
];

test("the guided setup starts with device permissions for every saved auth state", async () => {
  const { getOnboardingRoute } = await load();
  for (const authPath of [null, "guest", "account"]) {
    assert.deepEqual(
      getOnboardingRoute({ authPath, setupMode: null, agentAllowed: true }),
      LOCAL_START
    );
  }
});

test("macOS accessibility features stay deferred until the permissions screen", async () => {
  const { shouldInitializeMacAccessibilityFeatures } = await load();

  assert.equal(shouldInitializeMacAccessibilityFeatures("auth"), false);
  assert.equal(shouldInitializeMacAccessibilityFeatures("required-models"), false);
  assert.equal(shouldInitializeMacAccessibilityFeatures("permissions"), true);
  assert.equal(shouldInitializeMacAccessibilityFeatures("dictation-hotkey"), true);
  assert.equal(shouldInitializeMacAccessibilityFeatures("notes"), true);
});

test("onboarding permission checks use the resolved macOS feature gate", () => {
  const source = readFileSync("src/components/OnboardingFlow.tsx", "utf8");

  assert.ok(
    source.indexOf("const currentStepId = reconcileStepWithRoute") <
      source.indexOf("const permissions = usePermissions")
  );
  assert.ok(
    source.includes(
      "macAccessibilityChecksEnabled: shouldInitializeMacAccessibilityFeatures(currentStepId)"
    )
  );
});

test("no onboarding route hands an older build's pending pick to the tray", () => {
  // The tray applies a pending pick, switching cleanup and the assistant on, only
  // while this flag is set. The local route has already written the user's own
  // switches by then, so no finish may set it.
  const source = readFileSync("src/components/OnboardingFlow.tsx", "utf8");
  assert.doesNotMatch(source, /setItem\(\s*"localSetupPending"/);
  assert.doesNotMatch(source, /hasPendingLocalModels/);
});

test("the local setup step is wired through its helpers", () => {
  const source = readFileSync("src/components/OnboardingFlow.tsx", "utf8");
  // Plan inputs and Proceed live in localSetupFlow.ts, where they are tested.
  assert.match(source, /planLocalSetup\(\{/);
  assert.match(
    source,
    /proceedWithLocalSetup\(localSetupPlan, handOff, async \(beforeContinue\) =>/
  );
  assert.match(
    source,
    /discardPendingLocalSetup\(\);\s*beforeContinue\(\);\s*goTo\("dictation-demo"\);/
  );
  // A policy refresh that is loading or failed keeps the plan the step is using.
  assert.match(source, /const localSetupPlan = computedLocalSetupPlan \?\? latchedLocalSetupPlan;/);
  assert.doesNotMatch(source, /buildLocalSetupPlan|applyLocalSetupSettings/);
  // The space read runs only around the choice.
  const steps = String.raw`currentStepId === "setup-choice" \|\| currentStepId === "local-setup"`;
  assert.match(source, new RegExp(String.raw`useLocalSetupSpace\(\s*${steps}\s*\)`));
  // A policy that couldn't be read gets a line instead of a blank card.
  const placeholder = String.raw`<LocalSetupStepPlaceholder\s+message=\{policy\.status === "error"`;
  assert.match(source, new RegExp(String.raw`${placeholder} \? t\("common\.policyUnresolved"\)`));
  // Back during the finish would unmount the step and cancel what Proceed handed on.
  assert.match(source, /backDisabled=\{isFinishing\}/);
});

test("each step asks for its window size, local setup a taller one", async () => {
  const { getOnboardingWindowMode } = await load();
  assert.equal(getOnboardingWindowMode("auth"), "compact");
  assert.equal(getOnboardingWindowMode("permissions"), "compact");
  assert.equal(getOnboardingWindowMode("local-setup"), "local-setup");
  for (const id of [
    "required-models",
    "languages",
    "use-cases",
    "dictation-hotkey",
    "dictation-demo",
    "notes",
    "assistant-hotkey",
    "assistant-demo",
    "setup-choice",
    "byok-dictation",
    "byok-assistant",
  ]) {
    assert.equal(getOnboardingWindowMode(id), "expanded", id);
  }
});

test("onboarding sizes the window from the current step", () => {
  const source = readFileSync("src/components/OnboardingFlow.tsx", "utf8");
  // The plan placeholder renders on local-setup too, so it gets the same size.
  assert.match(source, /const windowMode = getOnboardingWindowMode\(currentStepId\);/);
  assert.match(source, /setOnboardingWindowMode\?\.\(windowMode\);\s*\}, \[windowMode\]\);/);
});

test("policy removes assistant states", async () => {
  const { getOnboardingRoute } = await load();
  const route = getOnboardingRoute({ authPath: "account", setupMode: null, agentAllowed: false });
  assert.equal(route.includes("assistant-hotkey"), false);
  assert.equal(route.includes("assistant-demo"), false);
  assert.equal(route.at(-1), "setup-choice");
});

test("the self-hosted route configures dictation and the assistant before practice", async () => {
  const { getOnboardingRoute } = await load();
  assert.deepEqual(
    getOnboardingRoute({ authPath: "guest", setupMode: "byok", agentAllowed: true }),
    [...LOCAL_START, "byok-dictation", "byok-assistant", "dictation-demo", "assistant-demo"]
  );
});

test("local setup uses one model-selection screen before optional practice", async () => {
  const { getOnboardingRoute } = await load();
  assert.deepEqual(
    getOnboardingRoute({ authPath: "guest", setupMode: "local", agentAllowed: true }),
    [...LOCAL_START, "local-setup", "dictation-demo", "assistant-demo"]
  );
  assert.deepEqual(
    getOnboardingRoute({ authPath: "account", setupMode: "local", agentAllowed: false }).slice(-3),
    ["setup-choice", "local-setup", "dictation-demo"]
  );
});

// Builds before this one saved sessions on the two-stage local picker, with the
// picker's model draft in resume.localModels.
test("a session saved on an old local stage resumes on local-setup", async () => {
  const flow = await load();
  const { createOnboardingSession, parseOnboardingSession, prepareLocalOnboardingSession } = flow;
  for (const stepId of ["local-dictation", "local-assistant"]) {
    const saved = {
      ...createOnboardingSession(),
      currentStepId: stepId,
      authPath: "account",
      setupMode: "local",
      history: ["auth", "setup-choice"],
    };
    saved.resume = {
      ...saved.resume,
      localModels: { [stepId]: { provider: "qwen", modelId: "qwen3.5-4b-q4_k_m" } },
    };
    const parsed = parseOnboardingSession(JSON.stringify(saved));
    assert.ok(parsed, `${stepId} still parses`);
    assert.equal(parsed.currentStepId, stepId);
    const migrated = prepareLocalOnboardingSession(parsed);
    assert.equal(migrated.currentStepId, "local-setup");
    assert.equal(migrated.authPath, "guest");
    assert.deepEqual(migrated.history, ["setup-choice"]);
  }
});

test("resuming a legacy hosted-provider session opens the local choice and clears obsolete drafts", async () => {
  const { createOnboardingSession, prepareLocalOnboardingSession } = await load();
  const session = {
    ...createOnboardingSession(),
    authPath: "account",
    setupMode: "byok",
    currentStepId: "byok-dictation",
    history: ["auth", "permissions", "dictation-hotkey", "setup-choice"],
    screenContextRequested: true,
    permissionGuide: "screen-context",
  };
  session.resume.auth.email = "old@example.invalid";
  session.resume.byok["byok-dictation"] = {
    selectedProvider: "groq",
    selectedModel: "whisper-large-v3",
  };
  session.resume.dictationHotkeyConfirmed = true;

  const migrated = prepareLocalOnboardingSession(session);
  assert.equal(migrated.currentStepId, "setup-choice");
  assert.equal(migrated.setupMode, null);
  assert.equal(migrated.permissionGuide, null);
  assert.equal(migrated.screenContextRequested, false);
  assert.equal(migrated.resume.auth.email, "");
  assert.equal(migrated.resume.dictationHotkeyConfirmed, true);
  assert.deepEqual(migrated.resume.byok, {});
  assert.deepEqual(migrated.history, ["permissions", "dictation-hotkey", "setup-choice"]);
});

test("a resumed self-hosted draft stays on its own step", async () => {
  const { createOnboardingSession, prepareLocalOnboardingSession } = await load();
  const session = {
    ...createOnboardingSession(),
    setupMode: "byok",
    selfHostedRequested: true,
    currentStepId: "byok-assistant",
  };
  const draft = { baseUrl: "http://127.0.0.1:8080", customModel: "local" };
  session.resume.byok["byok-assistant"] = draft;
  const resumed = prepareLocalOnboardingSession(session);
  assert.equal(resumed.currentStepId, "byok-assistant");
  assert.deepEqual(resumed.resume.byok["byok-assistant"], draft);
});

test("legacy account and required-model options never bypass the local setup choice", async () => {
  const { getOnboardingRoute, isSetupDecisionStep } = await load();
  const route = getOnboardingRoute({
    authPath: "account",
    setupMode: "cloud",
    agentAllowed: true,
    skipSetupChoice: true,
    requiredModelsPending: true,
  });
  assert.deepEqual(route, LOCAL_START);
  assert.equal(isSetupDecisionStep("assistant-hotkey", route), true);
});

test("notes starts with Skip and switches to Continue after a calendar connects", async () => {
  const { getNotesFooterAction } = await load();

  assert.equal(
    getNotesFooterAction({ setupDecisionPending: false, hasConnectedCalendar: false }),
    "skip"
  );
  assert.equal(
    getNotesFooterAction({ setupDecisionPending: false, hasConnectedCalendar: true }),
    "continue"
  );
  // Naming this state rather than returning null: the footer has to keep showing a
  // Continue while workspaces resolve, disabled and loading. Reading it as "no
  // action" left the step with nothing but Back and no explanation.
  assert.equal(
    getNotesFooterAction({ setupDecisionPending: true, hasConnectedCalendar: true }),
    "loading"
  );
  assert.equal(
    getNotesFooterAction({ setupDecisionPending: true, hasConnectedCalendar: false }),
    "loading"
  );
});

test("enterprise workspace entitlement requires a current paid entitlement", async () => {
  const { isEnterpriseWorkspaceEntitled } = await load();
  assert.equal(isEnterpriseWorkspaceEntitled({ plan: "enterprise", status: "active" }), true);
  assert.equal(isEnterpriseWorkspaceEntitled({ plan: "enterprise", status: "trialing" }), true);
  assert.equal(isEnterpriseWorkspaceEntitled({ plan: "enterprise", status: "past_due" }), false);
  assert.equal(isEnterpriseWorkspaceEntitled({ plan: "pro", status: "active" }), false);
  assert.equal(isEnterpriseWorkspaceEntitled(null), false);
});

test("only a signed-in account with an uncommitted choice skips enterprise setup", async () => {
  const { shouldSkipOnboardingSetupChoice } = await load();
  const base = {
    isSignedIn: true,
    authPath: "account",
    setupMode: null,
    activeWorkspace: { plan: "enterprise", status: "active" },
  };

  assert.equal(shouldSkipOnboardingSetupChoice(base), true);
  assert.equal(shouldSkipOnboardingSetupChoice({ ...base, setupMode: "cloud" }), true);
  assert.equal(shouldSkipOnboardingSetupChoice({ ...base, setupMode: "local" }), false);
  assert.equal(shouldSkipOnboardingSetupChoice({ ...base, authPath: "guest" }), false);
  assert.equal(shouldSkipOnboardingSetupChoice({ ...base, isSignedIn: false }), false);
  assert.equal(shouldSkipOnboardingSetupChoice({ ...base, activeWorkspace: null }), false);
});

test("a fresh multi-workspace account resolves its enterprise workspace", async () => {
  const { resolveEnterpriseWorkspaceForOnboarding } = await load();
  const personal = { id: "personal", plan: "pro", status: "active" };
  const enterprise = { id: "enterprise", plan: "enterprise", status: "trialing" };

  assert.equal(resolveEnterpriseWorkspaceForOnboarding(null, [personal, enterprise]), enterprise);
  assert.equal(resolveEnterpriseWorkspaceForOnboarding(personal, [personal, enterprise]), null);
  assert.equal(
    resolveEnterpriseWorkspaceForOnboarding(enterprise, [personal, enterprise]),
    enterprise
  );
});

test("versioned sessions reject malformed or old data", async () => {
  const { createOnboardingSession, parseOnboardingSession } = await load();
  assert.equal(parseOnboardingSession(null), null);
  assert.equal(parseOnboardingSession("not json"), null);
  assert.equal(parseOnboardingSession('{"version":1,"currentStepId":"auth"}'), null);

  const session = createOnboardingSession();
  assert.deepEqual(parseOnboardingSession(JSON.stringify(session)), session);

  const legacyV2 = { ...session };
  delete legacyV2.selfHostedRequested;
  delete legacyV2.screenContextRequested;
  delete legacyV2.resume;
  assert.equal(parseOnboardingSession(JSON.stringify(legacyV2)).selfHostedRequested, false);
  assert.equal(parseOnboardingSession(JSON.stringify(legacyV2)).screenContextRequested, false);
  assert.deepEqual(
    parseOnboardingSession(JSON.stringify(legacyV2)).resume,
    createOnboardingSession().resume
  );
  assert.equal(
    parseOnboardingSession(JSON.stringify({ ...session, selfHostedRequested: "yes" })),
    null
  );
  assert.equal(
    parseOnboardingSession(JSON.stringify({ ...session, screenContextRequested: "yes" })),
    null
  );
});

// The permissions step's Enable click must survive the quit-and-reopen macOS
// asks for after granting Screen Recording, or the OS permission lands with
// the Voice Assistant setting still off.
test("a session keeps the screen-context request latch across a relaunch", async () => {
  const { createOnboardingSession, parseOnboardingSession } = await load();
  const session = { ...createOnboardingSession(), screenContextRequested: true };
  assert.equal(parseOnboardingSession(JSON.stringify(session)).screenContextRequested, true);
});

test("v2 sessions retain safe within-step state without accepting secrets", async () => {
  const { createOnboardingSession, parseOnboardingSession } = await load();
  const session = createOnboardingSession();
  session.currentStepId = "byok-dictation";
  session.resume.dictationHotkeyConfirmed = true;
  session.resume.dictationDemoCompleted = true;
  session.resume.auth = {
    ...session.resume.auth,
    authMode: "sign-up",
    email: "person@example.com",
    fullName: "Person Example",
  };
  session.resume.byok["byok-dictation"] = {
    selectedProvider: "openai",
    selectedModel: "gpt-4o-mini-transcribe",
    baseUrl: "https://self-hosted.example.com",
    customModel: "whisper-local",
  };

  const serialized = JSON.stringify(session);
  assert.doesNotMatch(serialized, /password|apiKey|cortiClientId|clientSecret/);
  assert.deepEqual(parseOnboardingSession(serialized), session);

  // Corti's client id is one of the safeStorage-encrypted secrets, so a draft
  // written by an older build has to be dropped rather than read back.
  const legacyDraft = JSON.parse(serialized);
  legacyDraft.resume.byok["byok-dictation"].cortiClientId = "client-id";
  assert.deepEqual(parseOnboardingSession(JSON.stringify(legacyDraft)), session);

  const malformedDraft = JSON.parse(serialized);
  malformedDraft.resume.auth.authMode = "unknown";
  malformedDraft.resume.byok["byok-dictation"].selectedProvider = 42;
  const parsed = parseOnboardingSession(JSON.stringify(malformedDraft));
  assert.equal(parsed.resume.auth.authMode, null);
  assert.equal(parsed.resume.byok["byok-dictation"].selectedProvider, "");
});

test("an old build's local model drafts are parsed past and dropped", async () => {
  const { createOnboardingSession, parseOnboardingSession } = await load();
  const session = createOnboardingSession();
  const old = JSON.parse(JSON.stringify(session));
  old.resume.localModels = {
    "local-dictation": { provider: "oruk", modelId: "orukeet-v0.1.0" },
    "local-assistant": { provider: "qwen", modelId: false },
  };
  const parsed = parseOnboardingSession(JSON.stringify(old));
  assert.deepEqual(parsed, session);
  assert.equal("localModels" in parsed.resume, false);
});

test("an explicit restart clears every persisted route choice and returns to auth", async () => {
  const { resetOnboardingProgress } = await load();
  const values = new Map([
    ["onboardingSessionV2", '{"currentStepId":"permissions"}'],
    ["onboardingCompleted", "true"],
    ["authenticationSkipped", "true"],
    ["skipAuth", "true"],
    ["localSetupPending", "true"],
    ["pendingLocalModelSelectionsV1", '{"assistant":{"provider":"qwen","modelId":"qwen-9b"}}'],
    ["signInPromptedAt", "1700000000000"],
  ]);
  const storage = {
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };

  resetOnboardingProgress(storage);

  assert.equal(values.get("onboardingCurrentStep"), "0");
  assert.equal(values.has("onboardingSessionV2"), false);
  assert.equal(values.has("onboardingCompleted"), false);
  assert.equal(values.has("authenticationSkipped"), false);
  assert.equal(values.has("skipAuth"), false);
  assert.equal(values.has("localSetupPending"), false);
  assert.equal(values.has("pendingLocalModelSelectionsV1"), false);
  assert.equal(values.has("signInPromptedAt"), false, "a restart is not a sign-in");
});

test("legacy numeric steps migrate conservatively", async () => {
  const { migrateLegacyOnboardingStep } = await load();
  assert.equal(migrateLegacyOnboardingStep(null), "auth");
  assert.equal(migrateLegacyOnboardingStep("0"), "auth");
  // Old steps 1-2 predate the old permissions step, so they must resume at
  // the new flow's permissions step rather than past it.
  assert.equal(migrateLegacyOnboardingStep("1"), "permissions");
  assert.equal(migrateLegacyOnboardingStep("2"), "permissions");
  assert.equal(migrateLegacyOnboardingStep("4"), "dictation-hotkey");
  assert.equal(migrateLegacyOnboardingStep("999"), "setup-choice");
});

test("a removed assistant step returns to its dictation counterpart", async () => {
  const { getOnboardingRoute, reconcileStepWithRoute } = await load();
  const route = getOnboardingRoute({ authPath: "guest", setupMode: "local", agentAllowed: false });
  assert.equal(reconcileStepWithRoute("assistant-hotkey", route), "dictation-hotkey");
  assert.equal(reconcileStepWithRoute("assistant-demo", route), "dictation-demo");
});

test("route helpers recover from obsolete auth and required-model steps", async () => {
  const { getNextOnboardingStep, getOnboardingRoute, reconcileStepWithRoute } = await load();
  const route = getOnboardingRoute({ authPath: "guest", setupMode: null, agentAllowed: true });
  assert.equal(reconcileStepWithRoute("required-models", route), "permissions");
  assert.equal(getNextOnboardingStep("auth", route), "permissions");
  assert.equal(getNextOnboardingStep("setup-choice", route), null);
});

test("progress covers only expanded local setup steps", async () => {
  const { getOnboardingProgress, getOnboardingRoute } = await load();
  const context = { authPath: "guest", setupMode: null, agentAllowed: true };
  const base = getOnboardingRoute(context);
  assert.equal(getOnboardingProgress("permissions", base), null);
  assert.equal(getOnboardingProgress("auth", base), null);
  assert.deepEqual(getOnboardingProgress("languages", base), { index: 0, total: 5 });
  assert.deepEqual(getOnboardingProgress("setup-choice", base), { index: 4, total: 5 });

  const local = getOnboardingRoute({ ...context, setupMode: "local" });
  assert.deepEqual(getOnboardingProgress("local-setup", local), { index: 5, total: 8 });
  assert.deepEqual(getOnboardingProgress("assistant-demo", local), { index: 7, total: 8 });

  const selfHosted = getOnboardingRoute({ ...context, setupMode: "byok" });
  assert.deepEqual(getOnboardingProgress("byok-assistant", selfHosted), { index: 6, total: 9 });
  assert.equal(getOnboardingProgress("notes", selfHosted), null);
});

test("the tray suppression predicate matches only a step that owns its downloads", async () => {
  const { createOnboardingSession, isDownloadOwningOnboardingStepActive } = await load();
  const on = (currentStepId) =>
    isDownloadOwningOnboardingStepActive(
      JSON.stringify({ ...createOnboardingSession(), currentStepId })
    );

  assert.equal(isDownloadOwningOnboardingStepActive(null), false);
  assert.equal(isDownloadOwningOnboardingStepActive("not json"), false);
  assert.equal(on("auth"), false);
  assert.equal(on("required-models"), true);
  // A completed/cleared session (the post-onboarding state) never suppresses.
  assert.equal(on("permissions"), false);
});

test("tray ignores local-setup downloads", async () => {
  const { createOnboardingSession, isDownloadOwningOnboardingStepActive } = await load();
  const session = { ...createOnboardingSession(), authPath: "account", setupMode: "local" };
  const on = (currentStepId) =>
    isDownloadOwningOnboardingStepActive(JSON.stringify({ ...session, currentStepId }));
  assert.equal(on("local-setup"), true);
  assert.equal(on("notes"), false);
  assert.equal(on("setup-choice"), false);
});

test("SetupChoiceStep sends Local straight to its step, with no warning dialog", () => {
  const source = readFileSync("src/components/onboarding/SetupChoiceStep.tsx", "utf8");
  assert.doesNotMatch(source, /warnings\.local|warnings\.\$\{/);
  assert.doesNotMatch(source, /onboarding-setup-warning-hero/);
  assert.match(source, /onClick=\{\(\) => onSelect\("local"\)\}/);
  assert.match(source, /setupChoice\.local\.features\.setup/);
  assert.doesNotMatch(source, /setupChoice\.local\.features\.models/);
});

test("a session written before the resume flags infers its hotkey confirmations", async () => {
  const { createOnboardingSession, parseOnboardingSession } = await load();
  const preResumeSession = (currentStepId) => {
    const { resume, ...session } = { ...createOnboardingSession(), currentStepId };
    void resume;
    return JSON.stringify({ ...session, authPath: "account" });
  };

  // The shipped build persists this shape. Read back as "never confirmed", a
  // macOS session resuming past the hotkey step lets finalizeOnboarding replace
  // the chord the user confirmed on that build, with no screen ever showing it.
  const past = parseOnboardingSession(preResumeSession("setup-choice"));
  assert.equal(past.resume.dictationHotkeyConfirmed, true);
  assert.equal(past.resume.assistantHotkeyConfirmed, true);

  // Notes now precedes the assistant steps, so a session standing there is
  // still ahead of the assistant hotkey and gets shown that step.
  const onNotes = parseOnboardingSession(preResumeSession("notes"));
  assert.equal(onNotes.resume.dictationHotkeyConfirmed, true);
  assert.equal(onNotes.resume.assistantHotkeyConfirmed, false);

  // Not yet reached is genuinely unconfirmed: the step still has to be shown, and
  // onboarding stays free to open it on the platform's onboarding chord.
  const before = parseOnboardingSession(preResumeSession("permissions"));
  assert.equal(before.resume.dictationHotkeyConfirmed, false);
  assert.equal(before.resume.assistantHotkeyConfirmed, false);

  // Standing on the step is not having finished it.
  const on = parseOnboardingSession(preResumeSession("dictation-hotkey"));
  assert.equal(on.resume.dictationHotkeyConfirmed, false);
  assert.equal(on.resume.assistantHotkeyConfirmed, false);

  // Nothing else is inferred — a demo the user never ran must still gate Continue.
  assert.equal(past.resume.dictationDemoCompleted, false);
  assert.equal(past.resume.assistantDemoCompleted, false);
});

test("the required-models step opens once nothing is left to wait for", async () => {
  const { canLeaveRequiredModels } = await load();
  const check = (loading, missing, refused) =>
    canLeaveRequiredModels({ loading, missing, refused });
  assert.equal(check(true, [], []), false);
  assert.equal(check(false, ["base"], []), false);
  assert.equal(check(false, [], []), true);
  // The organization refused this model, so waiting for it would never end.
  assert.equal(check(false, ["base"], ["base"]), true);
  assert.equal(check(false, ["base", "small"], ["base"]), false);
});

test("a rotated token keeps a step that owns downloads up through the policy refetch", async () => {
  const { createOnboardingSession, keepsOnboardingStepThroughPolicyRefetch } = await load();
  const session = (currentStepId) =>
    JSON.stringify({ ...createOnboardingSession(), currentStepId });
  const keeps = (overrides) =>
    keepsOnboardingStepThroughPolicyRefetch({
      showOnboarding: true,
      sessionValue: session("local-setup"),
      policyAccountId: "account",
      lastResolvedAccountId: "account",
      ...overrides,
    });

  assert.equal(keeps({}), true);
  assert.equal(keeps({ sessionValue: session("required-models") }), true);
  assert.equal(keeps({ sessionValue: session("notes") }), false, "nothing to lose elsewhere");
  assert.equal(keeps({ showOnboarding: false }), false);
  assert.equal(keeps({ lastResolvedAccountId: "someone-else" }), false, "another account reloads");
  assert.equal(keeps({ policyAccountId: null, lastResolvedAccountId: null }), false, "suspended");
});
