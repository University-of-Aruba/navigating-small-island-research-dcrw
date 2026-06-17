import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(fileURLToPath(new URL("..", import.meta.url)));
const chromePath =
  process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const screenshotDir = process.env.SCREENSHOT_DIR || "/private/tmp";
const desktopScreenshot = join(screenshotDir, "nsirr-desktop.png");
const mobileScreenshot = join(screenshotDir, "nsirr-mobile.png");
const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".dot", "text/plain; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
]);

function assertSmoke(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createStaticServer() {
  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
      const relativePath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
      const safePath = normalize(decodeURIComponent(relativePath)).replace(/^(\.\.[/\\])+/, "");
      const absolutePath = resolve(rootDir, `.${safePath}`);

      if (!absolutePath.startsWith(rootDir)) {
        response.writeHead(403);
        response.end("Forbidden");
        return;
      }

      const body = await readFile(absolutePath);
      response.writeHead(200, {
        "Content-Type": mimeTypes.get(extname(absolutePath)) || "application/octet-stream",
        "Cache-Control": "no-store",
      });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("Not found");
    }
  });
}

function listen(server) {
  return new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", rejectListen);
      resolveListen(server.address());
    });
  });
}

function waitForDevTools(chrome) {
  return new Promise((resolveDevTools, rejectDevTools) => {
    let logs = "";
    const timer = setTimeout(() => {
      rejectDevTools(new Error(`Chrome DevTools endpoint was not reported. Logs: ${logs}`));
    }, 15000);

    chrome.stderr.on("data", (chunk) => {
      logs += chunk.toString();
      const match = logs.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timer);
        resolveDevTools(match[1]);
      }
    });

    chrome.once("exit", (code, signal) => {
      clearTimeout(timer);
      rejectDevTools(new Error(`Chrome exited before DevTools was ready: ${code ?? signal}. ${logs}`));
    });
  });
}

function cdpConnection(webSocketUrl) {
  const socket = new WebSocket(webSocketUrl);
  const pending = new Map();
  const listeners = new Map();
  let nextId = 1;

  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(event.data);
    if (payload.id && pending.has(payload.id)) {
      const { resolveSend, rejectSend } = pending.get(payload.id);
      pending.delete(payload.id);
      if (payload.error) {
        rejectSend(new Error(payload.error.message));
      } else {
        resolveSend(payload.result);
      }
      return;
    }

    if (payload.method && listeners.has(payload.method)) {
      for (const listener of listeners.get(payload.method)) {
        listener(payload.params);
      }
    }
  });

  function send(method, params = {}) {
    return new Promise((resolveSend, rejectSend) => {
      const id = nextId;
      nextId += 1;
      pending.set(id, { resolveSend, rejectSend });
      socket.send(JSON.stringify({ id, method, params }));
    });
  }

  function on(method, listener) {
    const methodListeners = listeners.get(method) ?? [];
    methodListeners.push(listener);
    listeners.set(method, methodListeners);
  }

  return new Promise((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", () => resolveOpen({ send, on, close: () => socket.close() }));
    socket.addEventListener("error", () => rejectOpen(new Error(`CDP socket failed: ${webSocketUrl}`)));
  });
}

async function createPageTarget(port, url) {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  assertSmoke(response.ok, `Target creation failed with status ${response.status}.`);
  return response.json();
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed.");
  }

  return result.result.value;
}

async function waitFor(cdp, expression, timeoutMs = 6000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await evaluate(cdp, expression)) {
      return;
    }
    await new Promise((resolveWait) => {
      setTimeout(resolveWait, 80);
    });
  }
  throw new Error(`Timed out while waiting for: ${expression}`);
}

async function text(cdp, selector) {
  return evaluate(cdp, `document.querySelector(${JSON.stringify(selector)})?.textContent.trim()`);
}

async function clickButton(cdp, label) {
  const expression = `
    (() => {
      const target = [...document.querySelectorAll("button")]
        .find((button) => button.textContent.trim() === ${JSON.stringify(label)});
      if (!target || target.disabled) return false;
      target.click();
      return true;
    })()
  `;
  assertSmoke(await evaluate(cdp, expression), `Button not available: ${label}.`);
  await new Promise((resolveWait) => {
    setTimeout(resolveWait, 60);
  });
}

async function restart(cdp) {
  await clickButton(cdp, "Restart");
}

async function runPath(cdp, labels) {
  for (const label of labels) {
    await clickButton(cdp, label);
  }
}

async function captureScreenshot(cdp, path) {
  const screenshot = await cdp.send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: true,
  });
  await writeFile(path, Buffer.from(screenshot.data, "base64"));
}

async function runSmoke() {
  const server = createStaticServer();
  const address = await listen(server);
  const url = `http://127.0.0.1:${address.port}/`;
  const profileDir = join("/private/tmp", `nsirr-chrome-profile-${Date.now()}`);
  await mkdir(profileDir, { recursive: true });

  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--disable-extensions",
    "--disable-background-networking",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--remote-debugging-port=0",
    `--user-data-dir=${profileDir}`,
    "--window-size=1440,1000",
    "about:blank",
  ]);

  try {
    const browserWebSocketUrl = await waitForDevTools(chrome);
    const devToolsPort = new URL(browserWebSocketUrl).port;
    const target = await createPageTarget(devToolsPort, url);
    const cdp = await cdpConnection(target.webSocketDebuggerUrl);
    const consoleMessages = [];
    const pageErrors = [];

    cdp.on("Runtime.exceptionThrown", (params) => {
      pageErrors.push(params.exceptionDetails?.text ?? "Runtime exception");
    });
    cdp.on("Log.entryAdded", (params) => {
      consoleMessages.push(`${params.entry.level}: ${params.entry.text}`);
    });

    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1440,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cdp.send("Page.navigate", { url });
    await waitFor(cdp, `document.querySelector("#step-title")?.textContent.trim() === "start"`);

    assertSmoke((await text(cdp, "#history-list")) === "No selections recorded.", "Initial history mismatch.");

    await runPath(cdp, ["Begin", "Continue", "NO", "Continue", "Continue"]);
    assertSmoke(
      (await text(cdp, "#step-title")) === "expected sample quality low?",
      "General hypothesis branch did not skip repeated-session decision.",
    );
    assertSmoke(
      !(await text(cdp, "#history-list")).includes("repeated session or longitudinal study?"),
      "General hypothesis branch unexpectedly included repeated-session decision.",
    );

    await runPath(cdp, ["NO", "NO", "NO", "NO", "NO", "Finish"]);
    assertSmoke((await text(cdp, "#step-title")) === "end", "Primary completion path did not reach end.");
    assertSmoke((await text(cdp, ".summary-list")).includes("expected sample availability low?"), "Summary missing decision path.");

    await clickButton(cdp, "Back");
    assertSmoke((await text(cdp, "#step-title")) === "finalize plan/protocol", "Back did not return to final action.");

    await restart(cdp);
    await runPath(cdp, ["Begin", "Continue", "YES", "Continue", "Continue"]);
    assertSmoke(
      (await text(cdp, "#step-title")) === "repeated session or longitudinal study?",
      "Personal/contextual branch did not include repeated-session decision.",
    );
    await clickButton(cdp, "YES");
    assertSmoke((await text(cdp, "#step-title")) === "(re)define constraints", "Longitudinal loop-back failed.");

    await restart(cdp);
    await runPath(cdp, ["Begin", "Continue", "NO", "Continue", "Continue", "YES"]);
    assertSmoke((await text(cdp, "#step-title")) === "(re)define constraints", "Sample-quality loop-back failed.");

    await restart(cdp);
    await runPath(cdp, ["Begin", "Continue", "YES", "Continue", "Continue", "NO", "NO", "YES", "Continue", "YES", "YES"]);
    assertSmoke((await text(cdp, "#step-title")) === "ensure compliance", "Compliance follow-up loop failed.");

    await runPath(cdp, ["Continue", "YES", "NO", "Continue"]);
    assertSmoke((await text(cdp, "#step-title")) === "equipment and material inadequate?", "Anonymization branch failed.");

    await restart(cdp);
    await runPath(cdp, [
      "Begin",
      "Continue",
      "NO",
      "Continue",
      "Continue",
      "NO",
      "NO",
      "NO",
      "NO",
      "YES",
      "Continue",
      "Finish",
    ]);
    assertSmoke((await text(cdp, "#step-title")) === "end", "Redundancy branch completion failed.");

    await captureScreenshot(cdp, desktopScreenshot);

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    await cdp.send("Page.navigate", { url });
    await waitFor(cdp, `document.querySelector("#step-title")?.textContent.trim() === "start"`);
    await captureScreenshot(cdp, mobileScreenshot);

    assertSmoke(pageErrors.length === 0, `Page errors reported: ${pageErrors.join("; ")}`);
    assertSmoke(consoleMessages.length === 0, `Console messages reported: ${consoleMessages.join("; ")}`);

    cdp.close();
    return {
      url,
      desktopScreenshot,
      mobileScreenshot,
      checkedPaths: [
        "general hypothesis primary completion",
        "repeated or longitudinal loop-back",
        "low sample quality loop-back",
        "ethics compliance follow-up loop",
        "anonymization branch",
        "redundancy branch completion",
        "Back",
        "Restart",
      ],
    };
  } finally {
    chrome.kill("SIGTERM");
    server.close();
    await rm(profileDir, { recursive: true, force: true });
  }
}

const result = await runSmoke();
console.log(JSON.stringify(result, null, 2));
