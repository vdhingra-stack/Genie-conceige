import { TuyaContext } from "@tuya/tuya-connector-nodejs";

const tuya = new TuyaContext({
  baseUrl: process.env.TUYA_BASE_URL!,
  accessKey: process.env.TUYA_ACCESS_KEY!,
  secretKey: process.env.TUYA_SECRET_KEY!,
});

const deviceId = process.env.TUYA_DEVICE_ID!;

async function main() {
  const functions: any = await tuya.request({
    method: "GET",
    path: `/v1.0/iot-03/devices/${deviceId}/functions`,
    body: {},
  });

  const spec: any = await tuya.request({
    method: "GET",
    path: `/v1.0/iot-03/devices/${deviceId}/specification`,
    body: {},
  });

  console.log("FUNCTIONS:", JSON.stringify(functions, null, 2));
  console.log("SPEC:", JSON.stringify(spec, null, 2));
  console.log("FUNCTIONS.result:", JSON.stringify(functions.result, null, 2));
  console.log("SPEC.result:", JSON.stringify(spec.result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
