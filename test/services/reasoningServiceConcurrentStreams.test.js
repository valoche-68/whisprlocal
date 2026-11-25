const test = require("node:test");
const assert = require("node:assert/strict");
const { createRendererServer, installBrowserGlobals } = require("../lib/rendererTestHarness");
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function setup(t) {
  installBrowserGlobals(t);
  const vite = await createRendererServer(t);
  const service = (await vite.ssrLoadModule("/services/ReasoningService.ts")).default;
  (await vite.ssrLoadModule("/stores/policyStore.ts")).usePolicyStore.setState({
    status: "unmanaged",
    policy: null,
  });
  t.after(() => service.destroy());
  return service;
}

test("an already stopped assistant request never starts the local server", async (t) => {
  const service = await setup(t);
  const startServer = t.mock.fn();
  const fetch = t.mock.method(globalThis, "fetch");
  window.electronAPI.llamaServerStart = startServer;
  const owner = new AbortController();
  const stream = service.processTextStreamingAI(
    [{ role: "user", content: "hi" }],
    "qwen3-4b",
    "local",
    { systemPrompt: "Answer" },
    undefined,
    owner.signal
  );
  owner.abort();
  assert.equal((await stream.next()).done, true);
  assert.equal(startServer.mock.callCount(), 0);
  assert.equal(fetch.mock.callCount(), 0);
});

for (const transport of ["raw", "ai"]) {
  test(`${transport} streaming observes caller abort during local server setup`, async (t) => {
    const service = await setup(t);
    let release;
    globalThis.window.electronAPI.llamaServerStart = () =>
      new Promise((resolve) => {
        release = resolve;
      });
    globalThis.window.electronAPI.llamaServerCancelStart = async () => {};
    let requests = 0;
    t.mock.method(globalThis, "fetch", async () => {
      requests++;
      return new Response("data: [DONE]\n\n");
    });
    const owner = new AbortController();
    const args = [
      [{ role: "user", content: "hi" }],
      "qwen3-4b",
      "local",
      { systemPrompt: "Answer" },
    ];
    const stream =
      transport === "raw"
        ? service.processTextStreaming(...args, owner.signal)
        : service.processTextStreamingAI(...args, undefined, owner.signal);
    const pending = stream.next();
    await flush();
    owner.abort();
    release({ success: true, port: 11434 });
    await pending;
    assert.equal(requests, 0);
  });
}

for (const transport of ["raw", "ai"]) {
  test(`${transport} streams keep independent transports and release a consumer that returns early`, async (t) => {
    const service = await setup(t);
    const requests = [];
    t.mock.method(globalThis, "fetch", async (url, init) => {
      let controller;
      const body = new ReadableStream({
        start(value) {
          controller = value;
        },
      });
      init.signal.addEventListener(
        "abort",
        () => {
          try {
            controller.error(new DOMException("aborted", "AbortError"));
          } catch {}
        },
        { once: true }
      );
      assert.equal(String(url), "http://127.0.0.1:11434/v1/chat/completions");
      assert.equal(new Headers(init.headers).get("authorization"), "Bearer self-hosted-token");
      requests.push({ signal: init.signal, body, controller });
      return new Response(body, { headers: { "content-type": "text/event-stream" } });
    });
    const start = () => {
      const args = [
        [{ role: "user", content: "hello" }],
        "qwen3-4b",
        "lan",
        {
          systemPrompt: "Answer",
          lanUrl: "http://127.0.0.1:11434/v1",
          customApiKey: "self-hosted-token",
        },
      ];
      return transport === "raw"
        ? service.processTextStreaming(...args)
        : service.processTextStreamingAI(...args, {});
    };
    const first = start(),
      second = start();
    const a = first.next(),
      b = second.next();
    for (let count = 0; count < 100 && requests.length < 2; count++) await flush();
    assert.equal(requests.length, 2);
    const send = (request, content) =>
      request.controller.enqueue(
        new TextEncoder().encode(
          `data: ${JSON.stringify({ id: "chat-1", object: "chat.completion.chunk", created: 1, model: "qwen3-4b", choices: [{ index: 0, delta: { content }, finish_reason: null }] })}\n\n`
        )
      );
    send(requests[0], "A");
    send(requests[1], "B");
    assert.equal(transport === "raw" ? (await a).value : (await a).value.text, "A");
    assert.equal(transport === "raw" ? (await b).value : (await b).value.text, "B");
    await first.return();
    if (transport === "ai")
      assert.equal(
        requests[0].signal.aborted,
        true,
        "SDK production must stop when its consumer leaves"
      );
    else assert.equal(requests[0].body.locked, false);
    assert.equal(requests[1].signal.aborted, false);
    service.cancelAllRequests();
    assert.equal(requests[1].signal.aborted, true);
    await second.return();
  });
}
