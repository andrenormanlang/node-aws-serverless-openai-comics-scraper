const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");
const https = require("https");

const s3 = new S3Client({ region: process.env.AWS_REGION });
const CONFIG_BUCKET = process.env.appConfigBucketName;
const CONFIG_KEY = "app-config.json";

const DEFAULT_CONFIG = {
  latestVersion: process.env.INITIAL_LATEST_VERSION || "3.2.0",
  minimumSupportedVersion: process.env.INITIAL_MINIMUM_VERSION || "3.1.9",
  message: {
    enabled: false,
    titleEn: "Service Message",
    titleSv: "Driftinformation",
    bodyEn: "",
    bodySv: "",
    startTimestamp: null,
    expectedEndTimestamp: null,
  },
};

const sendResponse = async (event, context, status, data = {}) => {
  const physicalResourceId =
    event.PhysicalResourceId || `${event.LogicalResourceId}-${event.ResourceProperties?.Stage || "default"}`;
  const responseBody = JSON.stringify({
    Status: status,
    Reason: `Custom resource ${status}: ${context.logStreamName}`,
    PhysicalResourceId: physicalResourceId,
    StackId: event.StackId,
    RequestId: event.RequestId,
    LogicalResourceId: event.LogicalResourceId,
    Data: data,
  });

  const url = event.ResponseURL;

  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options = {
      hostname: parsed.hostname,
      port: 443,
      path: parsed.pathname + parsed.search,
      method: "PUT",
      headers: {
        "content-type": "",
        "content-length": Buffer.byteLength(responseBody),
      },
    };

    const req = https.request(options, (res) => {
      console.log(`Response sent: ${status} (${res.statusCode})`);
      resolve();
    });

    req.on("error", (err) => {
      console.error("Failed to send response:", err);
      reject(err);
    });

    req.write(responseBody);
    req.end();
  });
};

const uploadConfig = async (config) => {
  const command = new PutObjectCommand({
    Bucket: CONFIG_BUCKET,
    Key: CONFIG_KEY,
    Body: JSON.stringify(config, null, 2),
    ContentType: "application/json",
  });
  await s3.send(command);
  console.log(`Uploaded ${CONFIG_KEY} to ${CONFIG_BUCKET}`);
};

const handleCreateOrUpdate = async (event) => {
  const customConfig = event.ResourceProperties?.Config;
  const config = customConfig || DEFAULT_CONFIG;
  await uploadConfig(config);
  return { ConfigVersion: CONFIG_KEY };
};

const handleDelete = async () => {
  console.log("Delete event — app-config.json kept in S3");
  return {};
};

const main = async (event, context) => {
  console.log("Event:", JSON.stringify(event));

  try {
    let data = {};
    switch (event.RequestType) {
      case "Create":
      case "Update":
        data = await handleCreateOrUpdate(event);
        break;
      case "Delete":
        data = await handleDelete();
        break;
    }
    await sendResponse(event, context, "SUCCESS", data);
  } catch (error) {
    console.error("Error:", error);
    await sendResponse(event, context, "FAILED", { Error: error.message });
    throw error;
  }
};

module.exports = { main };
