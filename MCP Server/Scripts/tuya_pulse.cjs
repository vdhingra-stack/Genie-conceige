const { TuyaContext } = require("@tuya/tuya-connector-nodejs");

const tuya = new TuyaContext({
  baseUrl: process.env.TUYA_BASE_URL,
  accessKey: process.env.TUYA_ACCESS_KEY,
  secretKey: process.env.TUYA_SECRET_KEY,
});

const deviceId = process.env.TUYA_DEVICE_ID;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function send(commands) {
  return tuya.request({
    method: "POST",
    path: `/v1.0/iot-03/devices/${deviceId}/commands`,
    body: { commands },
  });
}

const THEMES = {
  battery: { h: 180, s: 1000 }, // cyan
  success: { h: 120, s: 1000 }, // green
  default: { h: 210, s: 900 },  // blue-ish
  gaming:  { h: 300, s: 1000 }, // magenta (baseline)
};

async function main() {
  const theme = process.env.TUYA_THEME || "success";
  const durationMs = Number(process.env.TUYA_DURATION_MS || "8000");
  const periodMs = Number(process.env.TUYA_PERIOD_MS || "300");

  const base = THEMES[theme] || THEMES.battery;

  // Important: do these in separate calls with a small delay.
  await send([{ code: "switch_led", value: true }]);
  await send([{ code: "work_mode", value: "colour" }]);
  await sleep(200);

  const end = Date.now() + durationMs;

  // Pulse by changing v in colour_data_v2 (not bright_value_v2).
  const lowV = 150;
  const highV = 1000;

  while (Date.now() < end) {
    await send([{ code: "colour_data_v2", value: { h: base.h, s: base.s, v: lowV } }]);
    await sleep(periodMs);
    await send([{ code: "colour_data_v2", value: { h: base.h, s: base.s, v: highV } }]);
    await sleep(periodMs);
  }

  // Leave it at a steady colour/brightness.
  await send([{ code: "colour_data_v2", value: { h: base.h, s: base.s, v: 650 } }]);

  console.log("OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
