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

  const status = res.result || [];
  const pick = (code) => status.find((x) => x.code === code);

  console.log("work_mode:", pick("work_mode"));
  console.log("colour_data_v2:", pick("colour_data_v2"));
  console.log("bright_value_v2:", pick("bright_value_v2"));
})();
