const { TuyaContext } = require("@tuya/tuya-connector-nodejs");

const tuya = new TuyaContext({
  baseUrl: process.env.TUYA_BASE_URL,
  accessKey: process.env.TUYA_ACCESS_KEY,
  secretKey: process.env.TUYA_SECRET_KEY,
});

const deviceId = process.env.TUYA_DEVICE_ID;

(async () => {
  const res = await tuya.request({
    method: "GET",
    path: `/v1.0/iot-03/devices/${deviceId}/status`,
    body: {},
  });

  console.log(JSON.stringify(res, null, 2));
})();
