const express = require("express");
const { randomUUID } = require("crypto");

const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const { StreamableHTTPServerTransport } = require("@modelcontextprotocol/sdk/server/streamableHttp.js");
const { isInitializeRequest } = require("@modelcontextprotocol/sdk/types.js");
const { z } = require("zod");

const { TuyaContext } = require("@tuya/tuya-connector-nodejs");

const crypto = require("crypto");

const MCP_BEARER_TOKEN = process.env.MCP_BEARER_TOKEN || ""; // if empty, auth is disabled (local dev)

const LIGHT_PROVIDER = process.env.LIGHT_PROVIDER || "tuya";

const PORT = process.env.PORT || 8000;

function timingSafeEq(a, b) {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

// -------------------------
// Tuya setup
// -------------------------
const tuya = new TuyaContext({
  baseUrl: process.env.TUYA_BASE_URL,
  accessKey: process.env.TUYA_ACCESS_KEY,
  secretKey: process.env.TUYA_SECRET_KEY,
});

async function tuyaSend(deviceId, commands) {
  const res = await tuya.request({
    method: "POST",
    path: `/v1.0/iot-03/devices/${deviceId}/commands`,
    body: { commands },
  });

  if (!res || res.success !== true) {
    throw new Error(`Tuya command failed: ${JSON.stringify(res)}`);
  }
  return res;
}

const THEMES = {
  battery: { h: 180, s: 1000 }, // cyan
  success: { h: 120, s: 1000 }, // green
  default: { h: 210, s: 900 },  // blue-ish
  gaming:  { h: 300, s: 1000 }, // magenta
};

// --- Add near the top (after THEMES) ---
const activePulses = new Map(); // deviceId -> { timer }

// Start pulsing without awaiting the full duration
function startTuyaPulse({ deviceId, theme, durationMs, periodMs = 450 }) {
  // Stop any existing animation for that device first
  stopTuyaPulse(deviceId);

  const base = THEMES[theme] || THEMES.default;

  const lowV = 150;
  const highV = 1000;
  const stopAt = Date.now() + durationMs;
  let toggle = false;

  // Kick the device into colour mode (fire-and-forget)
  (async () => {
    await tuyaSend(deviceId, [{ code: "switch_led", value: true }]);
    await tuyaSend(deviceId, [{ code: "work_mode", value: "colour" }]);
  })().catch(() => { /* optional logging */ });

  const timer = setInterval(() => {
    if (Date.now() >= stopAt) {
      stopTuyaPulse(deviceId);
      // leave it steady
      tuyaSend(deviceId, [{ code: "colour_data_v2", value: { ...base, v: 650 } }]).catch(() => {});
      return;
    }
    toggle = !toggle;
    const v = toggle ? lowV : highV;
    tuyaSend(deviceId, [{ code: "colour_data_v2", value: { ...base, v } }]).catch(() => {});
  }, periodMs);

  activePulses.set(deviceId, { timer });
}

function stopTuyaPulse(deviceId) {
  const job = activePulses.get(deviceId);
  if (job?.timer) clearInterval(job.timer);
  activePulses.delete(deviceId);
}


async function tuyaOff(deviceId) {
  await tuyaSend(deviceId, [{ code: "switch_led", value: false }]);
}

const fs = require("fs");
const path = require("path");

const STORE_CONFIG_DIR = path.resolve(
  process.env.STORE_CONFIG_DIR || path.join(process.cwd(), "MCP Server", "config", "stores")
);

const storeCache = new Map();

function loadStoreConfig(storeId) {
  // Cache by storeId; you can remove caching later if you want hot reload
  if (storeCache.has(storeId)) return storeCache.get(storeId);

  const filePath = path.join(STORE_CONFIG_DIR, `${storeId}.json`);
  const raw = fs.readFileSync(filePath, "utf8");
  const cfg = JSON.parse(raw);

  storeCache.set(storeId, cfg);
  return cfg;
}

function resolveLightProviderCfg(targetEntry) {
  const cfg = targetEntry?.providers?.[LIGHT_PROVIDER];
  return cfg || null;
}

// -------------------------
// MCP server factory (PER SESSION)
// -------------------------
function createMcpServerForSession() {
  const mcp = new McpServer({
    name: "genny-actuation",
    version: "0.1.0",
    capabilities: { tools: {}, resources: {} },
  });

  mcp.registerTool(
    "highlight_targets",
    {
      title: "Highlight targets",
      description: "Highlight one or more SKUs (lights only in this PoC).",
      inputSchema: {
        store_id: z.string(),
        targets: z.array(z.object({
          sku: z.string(),
          mode: z.enum(["light", "screen", "both"]).default("light"),
        })),
        effect: z.enum(["pulse", "off"]).default("pulse"),
        theme: z.enum(["battery", "success", "default", "gaming"]).default("battery"),
        duration_ms: z.number().int().min(1000).max(60000).default(15000),
      },
    },
    async (args) => {
      console.log("=== HIGHLIGHT_TARGETS START ===");
      console.log("Args:", JSON.stringify(args));

      let cfg;
      try {
        console.log("Loading store config for:", args.store_id);
        cfg = loadStoreConfig(args.store_id);
        console.log("Config loaded successfully");
        console.log("Config targets:", Object.keys(cfg.targets || {}));
      } catch (e) {
        console.error("ERROR loading config:", e.message);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: "unknown_store",
              detail: String(e.message || e)
            })
          }]
        };
      }

      const targets = cfg.targets || {};
      console.log("Available targets in config:", Object.keys(targets));

      const selected = args.targets
        .map((t) => {
          console.log(`Processing target SKU: ${t.sku}`);
          const entry = targets[t.sku];
          console.log(`Entry found:`, entry ? "YES" : "NO");

          const providerCfg = resolveLightProviderCfg(entry);
          console.log(`Provider config:`, providerCfg);

          return { sku: t.sku, providerCfg };
        })
        .filter((x) => !!x.providerCfg);

      console.log("Selected after filtering:", JSON.stringify(selected));

      const tuyaSelected = selected
        .filter(x => LIGHT_PROVIDER === "tuya" && x.providerCfg?.device_id);

      console.log("Tuya selected:", JSON.stringify(tuyaSelected));
      console.log("LIGHT_PROVIDER:", LIGHT_PROVIDER);

      if (!tuyaSelected.length) {
        console.error("ERROR: No targets mapped for provider");
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: false,
              error: "no_targets_mapped_for_provider",
              provider: LIGHT_PROVIDER,
              debug: {
                requested_skus: args.targets.map(t => t.sku),
                available_skus: Object.keys(targets),
                selected_count: selected.length
              }
            })
          }]
        };
      }

      if (args.effect === "off") {
        console.log("Turning off lights");
        tuyaSelected.forEach(x => stopTuyaPulse(x.providerCfg.device_id));
        await Promise.all(tuyaSelected.map(x => tuyaOff(x.providerCfg.device_id)));
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              ok: true,
              action: "off",
              provider: LIGHT_PROVIDER,
              targets: tuyaSelected.map(x => x.sku)
            })
          }]
        };
      }

      console.log("Starting pulse for devices:", tuyaSelected.map(x => x.providerCfg.device_id));

      tuyaSelected.forEach(x => {
        console.log(`Starting pulse for device ${x.providerCfg.device_id}`);
        startTuyaPulse({
          deviceId: x.providerCfg.device_id,
          theme: args.theme,
          durationMs: args.duration_ms,
          periodMs: 450,
        });
      });

      console.log("=== HIGHLIGHT_TARGETS END ===");

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            ok: true,
            action: "pulse_started",
            theme: args.theme,
            targets: tuyaSelected.map(x => x.sku),
          })
        }]
      };
    }
  );

  mcp.registerTool(
    "stop_highlights",
    {
      title: "Stop highlights",
      description: "Turn off mapped lights for this store.",
      inputSchema: { store_id: z.string() },
    },
    async (args) => {
      console.log("Stop Highlights args:", JSON.stringify(args));
      
      let cfg;
      try {
        cfg = loadStoreConfig(args.store_id); // loads <STORE_CONFIG_DIR>/<store_id>.json
      } catch (e) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                ok: false,
                error: "unknown_store",
                detail: String(e.message || e),
              }),
            },
          ],
        };
      }

      const targets = cfg.targets || {};

      // Collect all Tuya device IDs in this store config
      const deviceIds = Object.values(targets)
        .map((entry) => resolveLightProviderCfg(entry))
        .filter(Boolean)
        .map((cfg) => (LIGHT_PROVIDER === "tuya" ? cfg.device_id : null))
        .filter(Boolean);

      if (!deviceIds.length) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ ok: false, error: "no_devices_mapped" }),
            },
          ],
        };
      }

      deviceIds.forEach(stopTuyaPulse);
      await Promise.all(deviceIds.map(id => tuyaOff(id)));

      return {
        content: [{ type: "text", text: JSON.stringify({ ok: true, action: "stop" }) }],
      };
    }
  );


  return mcp;
}



// -------------------------
// Streamable HTTP host with per-session server/transport
// -------------------------
const app = express();
app.use(express.json());

// Health check endpoint for Render
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// sessionId -> { server, transport }
const sessions = new Map();

function cleanupSession(sessionId) {
  const entry = sessions.get(sessionId);
  if (!entry) return;

  try { entry.transport?.close?.(); } catch {}
  try { entry.server?.close?.(); } catch {}
  sessions.delete(sessionId);
}

app.use((req, res, next) => {
  if (!MCP_BEARER_TOKEN) return next(); // local dev: no auth

  const auth = req.headers["authorization"] || "";
  const expected = `Bearer ${MCP_BEARER_TOKEN}`;

  if (!timingSafeEq(String(auth), expected)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
});

app.post("/mcp", async (req, res) => {
  try {
    const sessionId = req.header("mcp-session-id") || undefined;

    // Existing session
    if (sessionId) {
      const entry = sessions.get(sessionId);
      if (!entry) return res.status(400).json({ error: "Invalid mcp-session-id" });
      return await entry.transport.handleRequest(req, res, req.body);
    }

    // New session must start with initialize
    if (!isInitializeRequest(req.body)) {
      return res.status(400).json({ error: "Missing mcp-session-id or non-initialize request." });
    }

    const server = createMcpServerForSession();

    // Create transport; store mapping after session is created
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        sessions.set(sid, { server, transport });
      },
    });

    req.on("close", () => {
      if (transport.sessionId) cleanupSession(transport.sessionId);
    });

    await server.connect(transport);
    return await transport.handleRequest(req, res, req.body);
  } catch (e) {
    // Return JSON, not HTML
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.get("/mcp", async (req, res) => {
  try {
    const sessionId = req.header("mcp-session-id");
    if (!sessionId) return res.status(400).json({ error: "Missing mcp-session-id" });

    const entry = sessions.get(sessionId);
    if (!entry) return res.status(400).json({ error: "Invalid mcp-session-id" });

    return await entry.transport.handleRequest(req, res);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

app.delete("/mcp", async (req, res) => {
  try {
    const sessionId = req.header("mcp-session-id");
    if (!sessionId) return res.status(400).json({ error: "Missing mcp-session-id" });

    const entry = sessions.get(sessionId);
    if (!entry) return res.status(400).json({ error: "Invalid mcp-session-id" });

    // Let transport handle protocol-level shutdown, then clean up
    await entry.transport.handleRequest(req, res);
    cleanupSession(sessionId);
  } catch (e) {
    return res.status(500).json({ error: String(e && e.message ? e.message : e) });
  }
});

// Listen on 0.0.0.0 instead of 127.0.0.1 (required for Render)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MCP server listening on port ${PORT}`);
});
