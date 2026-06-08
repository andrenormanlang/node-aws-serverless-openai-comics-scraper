import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import handler from "../libs/handler-lib";

const s3 = new S3Client({ region: process.env.AWS_REGION });
const CONFIG_BUCKET = process.env.appConfigBucketName;
const CONFIG_KEY = "app-config.json";

const fetchConfigFromS3 = async () => {
  const command = new GetObjectCommand({
    Bucket: CONFIG_BUCKET,
    Key: CONFIG_KEY,
  });
  const response = await s3.send(command);
  const bodyString = await response.Body.transformToString();
  return JSON.parse(bodyString);
};

export const main = handler(async () => {
  try {
    const config = await fetchConfigFromS3();
    return { response: "success", config };
  } catch (error) {
    console.error("Error reading app config from S3:", error);
    return { response: "success", config: null, error: error.message };
  }
});
