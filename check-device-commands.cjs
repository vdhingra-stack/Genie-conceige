/**
 * check-device-commands.cjs
 *
 * Queries the Tuya API to list all commands (functions) supported by a device.
 *
 * Usage:
 *   node check-device-commands.cjs
 *
 * Requires the same env vars as mcp-server.cjs:
 *   TUYA_BASE_URL, TUYA_ACCESS_KEY, TUYA_SECRET_KEY
 *
 * Optionally override the device ID:
 *   TUYA_DEVICE_ID=<your_device_id> node check-device-commands.cjs
 */

require("dotenv").config({ path: ".env" }); // load credentials from .env

// Allow self-signed certs in the corporate network (diagnostic script only)
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

const { TuyaContext } = require("@tuya/tuya-connector-nodejs");

// ── Config ────────────────────────────────────────────────────────────────────
const DEVICE_ID =
  process.env.TUYA_DEVICE_ID || "bf1330c0766c71610c155x"; // default from config/stores/Default.json

const tuya = new TuyaContext({
  baseUrl: process.env.TUYA_BASE_URL,
  accessKey: process.env.TUYA_ACCESS_KEY,
  secretKey: process.env.TUYA_SECRET_KEY,
});

// ── Helpers ───────────────────────────────────────────────────────────────────
async function getDeviceFunctions(deviceId) {
  console.log(`\n📡  Fetching supported functions for device: ${deviceId}\n`);

  const res = await tuya.request({
    method: "GET",
    path: `/v1.0/iot-03/devices/${deviceId}/functions`,
  });

  if (!res || res.success !== true) {
    throw new Error(`API error: ${JSON.stringify(res)}`);
  }

  return res.result?.functions ?? [];
}

async function getDeviceStatus(deviceId) {
  console.log(`📊  Fetching current status for device: ${deviceId}\n`);

  const res = await tuya.request({
    method: "GET",
    path: `/v1.0/iot-03/devices/${deviceId}/status`,
  });

  if (!res || res.success !== true) {
    throw new Error(`API error: ${JSON.stringify(res)}`);
  }

  return res.result ?? [];
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {
  try {
    // 1. Supported commands / functions
    const functions = await getDeviceFunctions(DEVICE_ID);

    if (!functions.length) {
      console.log("⚠️  No functions returned for this device.");
    } else {
      console.log(`✅  ${functions.length} supported function(s):\n`);
      functions.forEach((fn, i) => {
        console.log(`  [${i + 1}] code      : ${fn.code}`);
        console.log(`       name      : ${fn.name ?? "(no name)"}`);
        console.log(`       type      : ${fn.type}`);
        if (fn.values) {
          try {
            const vals =
              typeof fn.values === "string" ? JSON.parse(fn.values) : fn.values;
            console.log(`       values    : ${JSON.stringify(vals)}`);
          } catch {
            console.log(`       values    : ${fn.values}`);
          }
        }
        console.log();
      });
    }

    // 2. Current status (bonus – shows live values for each data point)
    const status = await getDeviceStatus(DEVICE_ID);

    if (!status.length) {
      console.log("⚠️  No status data returned.");
    } else {
      console.log(`📋  Current status (${status.length} data point(s)):\n`);
      status.forEach((s) => {
        console.log(`  code: ${s.code}  →  value: ${JSON.stringify(s.value)}`);
      });
    }
  } catch (err) {
    console.error("\n❌  Error:", err.message || err);
    process.exit(1);
  }
})();
