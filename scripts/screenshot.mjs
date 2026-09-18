#!/usr/bin/env node
/**
 * pnpm shots — render the real client in a headless browser and save pictures.
 *
 *   pnpm shots                      hot-seat game + lobby, three viewport sizes
 *   pnpm shots --players 6          a different seat count
 *   pnpm shots --url http://...     use an already running client
 *   pnpm shots --scenario new-shores-4   a Seafarers board
 *   pnpm shots --turns 400          keep playing past setup, so ships appear
 *
 * Why this exists: the client once shipped with every number token and road
 * buried inside the tiles and every heading drawn black-on-black, while 383
 * tests passed. Tests check behaviour; nothing checked the picture. This does.
 * It is a dev tool, not part of `pnpm verify` — a human (or Claude) looks at the
 * output in .shots/ before calling visual work done.
 *
 * It starts Vite itself unless --url is given, drives any Chromium-family
 * browser over the DevTools protocol (set HEXPORT_BROWSER to pick one), plays
 * through setup via the accessible `[data-placement]` buttons — and on past it
 * when --turns is given — then prints any console errors the page raised.
 *
 * That last part matters on a Seafarers board. A ship costs lumber and wool and
 * cannot be built before the main phase, so a picture taken at the end of setup
 * can never contain one, and a hull could be shipped sunk inside the sea tiles
 * with every test still green.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, ".shots");

const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const PLAYERS = Number(args.get("players") ?? 4);
const SEED = args.get("seed") ?? "shots";
const SCENARIO = args.get("scenario");
/**
 * How many interface actions to take past setup before the last picture.
 *
 * Zero keeps the old behaviour. A few hundred is enough for ships to appear on
 * a Seafarers board: in self-play the first one lands around action twenty.
 */
const TURNS = Number(args.get("turns") ?? 0);
const PORT = Number(args.get("port") ?? 5199);
const CDP_PORT = PORT + 4000;
const BASE = args.get("url") ?? `http://localhost:${String(PORT)}/`;

const VIEWPORTS = [
  { name: "desktop", width: 1600, height: 1000, scale: 1, mobile: false },
  { name: "laptop", width: 1280, height: 800, scale: 1, mobile: false },
  { name: "phone", width: 390, height: 844, scale: 2, mobile: true },
];

const BROWSERS = [
  process.env.HEXPORT_BROWSER,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((path) => path !== undefined && existsSync(path));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(url, attempts = 80) {
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {
      // Not up yet.
    }
    await sleep(250);
  }
  throw new Error(`Nothing answered at ${url}`);
}

/** A minimal DevTools protocol client over Node's built-in WebSocket. */
async function connect(wsUrl, onEvent) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve);
    socket.addEventListener("error", reject);
  });
  let id = 0;
  const pending = new Map();
  socket.addEventListener("message", (message) => {
    const data = JSON.parse(String(message.data));
    if (data.id !== undefined && pending.has(data.id)) {
      pending.get(data.id)(data);
      pending.delete(data.id);
    } else if (data.method !== undefined) {
      onEvent(data);
    }
  });
  return {
    send(method, params = {}) {
      return new Promise((resolve) => {
        id += 1;
        pending.set(id, resolve);
        socket.send(JSON.stringify({ id, method, params }));
      });
    },
    close() {
      socket.close();
    },
  };
}

async function main() {
  if (BROWSERS.length === 0) {
    console.error("No Chromium-family browser found. Set HEXPORT_BROWSER to one.");
    process.exit(1);
  }
  mkdirSync(OUT, { recursive: true });

  const children = [];
  const profile = mkdtempSync(join(tmpdir(), "hexport-shots-"));

  try {
    if (!args.has("url")) {
      const vite = join(ROOT, "apps/web/node_modules/vite/bin/vite.js");
      children.push(
        spawn(process.execPath, [vite, "--port", String(PORT), "--strictPort"], {
          cwd: join(ROOT, "apps/web"),
          stdio: "ignore",
        }),
      );
    }
    await waitFor(BASE);

    children.push(
      spawn(
        BROWSERS[0],
        [
          "--headless=new",
          `--remote-debugging-port=${String(CDP_PORT)}`,
          `--user-data-dir=${profile}`,
          "--enable-unsafe-swiftshader",
          "--use-angle=swiftshader",
          "--hide-scrollbars",
          "--no-first-run",
          "about:blank",
        ],
        { stdio: "ignore" },
      ),
    );

    const list = await (
      await waitFor(`http://127.0.0.1:${String(CDP_PORT)}/json/list`)
    ).json();
    const page = list.find((target) => target.type === "page");
    const problems = [];
    const cdp = await connect(page.webSocketDebuggerUrl, (event) => {
      if (event.method === "Runtime.exceptionThrown") {
        problems.push(
          event.params.exceptionDetails.exception?.description ?? "exception",
        );
      }
      if (
        event.method === "Runtime.consoleAPICalled" &&
        event.params.type === "error"
      ) {
        problems.push(event.params.args.map((a) => a.value ?? a.description).join(" "));
      }
    });
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");

    const evaluate = async (expression) =>
      (await cdp.send("Runtime.evaluate", { expression, returnByValue: true })).result
        ?.result?.value;

    const shot = async (name, clip) => {
      const response = await cdp.send("Page.captureScreenshot", {
        format: "png",
        ...(clip === undefined ? {} : { clip }),
      });
      const file = join(OUT, `${name}.png`);
      writeFileSync(file, Buffer.from(response.result.data, "base64"));
      console.log(`  ${file}`);
    };

    for (const viewport of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.scale,
        mobile: viewport.mobile,
      });

      const game = new URL(BASE);
      game.searchParams.set("hotseat", "1");
      game.searchParams.set("seed", SEED);
      game.searchParams.set("players", String(PLAYERS));
      // `pnpm shots --scenario new-shores-4` photographs a Seafarers board.
      // Without it there is no way to look at one, and looking is the whole
      // point of this script.
      if (SCENARIO !== undefined) game.searchParams.set("scenario", SCENARIO);
      // A software renderer trips the low-power fallback; show the real look.
      game.searchParams.set("fx", "1");
      await cdp.send("Page.navigate", { url: game.href });
      await sleep(6000);
      await shot(`${viewport.name}-setup`);

      // Two rounds of settlement + road for every seat, through the DOM route.
      for (let i = 0; i < PLAYERS * 4; i++) {
        await evaluate(`document.querySelector('button[data-placement]')?.click()`);
        await sleep(450);
      }
      await sleep(2500);
      await shot(`${viewport.name}-game`);

      /**
       * Play on for a while, so the board has something on it.
       *
       * Setup alone shows settlements and roads and nothing else. A Seafarers
       * board needs more than that to be worth looking at: ships cost lumber
       * and wool and cannot be built until the main phase, so a picture taken
       * at the end of setup can never show one — which is how a hull could have
       * been shipped sunk inside the sea tiles with every test passing.
       *
       * The moves are taken the way the UI tests take them, by clicking
       * whatever the screen offers, so this drives the real interface rather
       * than reaching into the engine.
       */
      if (TURNS > 0) {
        const tally = {};
        let idle = 0;

        for (let i = 0; i < TURNS; i++) {
          const acted = await evaluate(`(() => {
            const panel = document.querySelector('[data-panel="actions"]') ?? document;
            const pick = (sel) => {
              const el = panel.querySelector(sel);
              if (el && !el.disabled) { el.click(); return true; }
              return false;
            };

            if (pick('button[data-action="roll"]')) return "roll";
            if (pick('button[data-action^="take-gold-"]')) return "gold";

            // Discarding needs cards chosen first: the Discard button stays
            // disabled at 0/N. Tap a "+" stepper instead and come back next
            // pass. Without this the whole loop wedges on the first seven
            // rolled with a full hand, which is exactly what it did.
            const plus = [...document.querySelectorAll('button')].find(
              (b) => (b.getAttribute('aria-label') ?? '').startsWith('one more') && !b.disabled,
            );
            if (pick('button[data-action="discard"]')) return "discard";
            if (plus) { plus.click(); return "discard-pick"; }

            const spot = document.querySelector('button[data-placement]');
            if (spot) { spot.click(); return "place"; }
            // Ships before roads: a Seafarers picture with no ship in it says
            // nothing about whether ships draw, and the loop will happily build
            // roads all game otherwise.
            if (pick('button[data-action="build-ship"]')) return "arm-ship";
            if (pick('button[data-action="build-road"]')) return "arm-road";
            if (pick('button[data-action="steal"]')) return "steal";
            if (pick('button[data-action="decline"]')) return "decline";
            if (pick('button[data-action="bank-trade"]')) return "trade";
            if (pick('button[data-action="end-turn"]')) return "end";
            if (pick('button[data-action="continue"]')) return "continue";
            return "";
          })()`);

          tally[acted || "(nothing)"] = (tally[acted || "(nothing)"] ?? 0) + 1;

          // One dead pass is not necessarily the end — a re-render can land
          // between the click and the next look. Several in a row is.
          if (acted === "") {
            idle++;
            if (idle > 8) break;
          } else {
            idle = 0;
          }
          await sleep(120);
        }

        console.log(`  actions taken: ${JSON.stringify(tally)}`);
        const board = await evaluate(
          `(() => { const l = document.querySelectorAll('[data-panel="log"] li, li').length; return String(l); })()`,
        );
        void board;

        await sleep(2200);
        await shot(`${viewport.name}-played`);
      }

      if (viewport.name === "desktop") {
        const rect = await evaluate(`(() => {
          const r = document.querySelector('main')?.getBoundingClientRect();
          return r && { x: r.x, y: r.y, width: r.width, height: r.height };
        })()`);
        if (rect) {
          await shot("desktop-board-zoom", {
            x: rect.x + rect.width * 0.2,
            y: rect.y + rect.height * 0.15,
            width: rect.width * 0.6,
            height: rect.height * 0.7,
            scale: 2,
          });
        }
      }

      await cdp.send("Page.navigate", { url: BASE });
      await sleep(3000);
      await shot(`${viewport.name}-lobby`);
    }

    cdp.close();
    if (problems.length > 0) {
      console.log(`\nThe page reported ${String(problems.length)} error(s):`);
      for (const problem of [...new Set(problems)].slice(0, 20)) {
        console.log(`  - ${problem}`);
      }
    } else {
      console.log("\nNo console errors.");
    }
  } finally {
    for (const child of children) child.kill();
    await sleep(300);
    rmSync(profile, { recursive: true, force: true });
  }
}

await main();
