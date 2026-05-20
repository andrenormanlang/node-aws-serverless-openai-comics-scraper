import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import handler from "../libs/handler-lib";
// Import the AWS SDK module
// const AWS = require("aws-sdk");

// Configure the AWS SDK to use a specific region (eu-central-1)
// AWS.config.update({ region: "eu-central-1" });

function formatPubDate(dateString) {
  try {
    const date = new Date(dateString);

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0"); // Months are 0-based
    const day = String(date.getDate()).padStart(2, "0");
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const seconds = String(date.getSeconds()).padStart(2, "0");

    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  } catch (err) {
    return "";
  }
}

function buildArticleSlug(title, url) {
  const randomSuffix = Math.random().toString(36).slice(2, 5);
  const sourceText = title || url || "article";
  let slug = sourceText
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (!slug) {
    slug = "article";
  }

  slug = slug.slice(0, 96).replace(/-+$/g, "");

  return `${slug || "article"}-${randomSuffix}`;
}

// Function to save data in DynamoDB
const saveDataInDynamoDb = async function (
  url,
  rwUserName,
  rwUserId,
  rephrasedTitle,
  rephrasedDescription,
  rwBody,
  addedTS,
  pubDate,
  pubTS,
  slug,
  subjects
) {
  // Create an instance of the DynamoDB DocumentClient
  // const dynamodb = new AWS.DynamoDB.DocumentClient();

  // Specify the DynamoDB table name
  const tableName = defs.WN_STR_KEY_TABLE;

  // Define the parameters for the DynamoDB put operation
  const params = {
    TableName: tableName,
    Item: {
      id: url, // Primary key for the item
      sortKey: "articles", // Sort key for the item
      rwUserName: rwUserName, // User's name
      rwUserId: rwUserId, // User's ID
      link: url, // Link to the resource
      title: rephrasedTitle, // Title of the article
      description: rephrasedDescription, // Description of the article
      rwBody: rwBody, // Article body
      addedTS: addedTS, // Timestamp when the item was added
      pubDate: pubDate ? formatPubDate(pubDate) : "", // Published date of the article
      pubTS: pubTS, // Published timestamp
      trust: { users: [] }, // Trust metadata (initially empty)
      distrust: { users: [] }, // Distrust metadata (initially empty)
      dislikes: { users: [] }, // Dislike metadata (initially empty)
      likes: { users: [] }, // Like metadata (initially empty)
      scrollByCount: 0,
      openedCount: 0,
      interestCount: 0,
      uninterestCount: 0,
      subjects: subjects || [], // Subjects/categories related to the article
      support: [], // Support-related metadata
      rwAvailability: null, // Availability status (default null)
      rwError: null, // Error status (default null)
      displayPermission: true, // Whether the item has display permissions
      rwDescription: null, // Rewritten description (default null)
      isRwDescription: null, // Indicates if the description is rewritten
      isRwBody: null, // Indicates if the body is rewritten
      isRwTitle: null, // Indicates if the title is rewritten
      bodyUserId: null, // User ID for the body (default null)
      descriptionUserId: null, // User ID for the description (default null)
      titleUserId: null, // User ID for the title (default null)
      nsURL: null, // Namespace URL (default null)
      rwTitle: null, // Rewritten title (default null)
      addedTSDbg: getCurrentDate(), // Debug timestamp when added
      amount: pubTS, // Amount field (same as pubTS)
      msgCount: 0, // Message count (default 0)
      rssUrl: null, // RSS URL (default null)
      ttlDbg: getCurrentDate(4), // Debug TTL timestamp with 4 days added
      ttlTS: pubTS, // TTL timestamp (same as pubTS)
      slug: slug, // Public share slug for /articles/:slug
    },
  };

  // Try to save the item in DynamoDB
  try {
    // const response = await dynamodb.put(params).promise(); // Perform the put operation
    const response = await dynamoDbLib.call("put", params); // Perform the put operation
    console.log("RESPONSE", response);
    return response; // Return the DynamoDB response
  } catch (error) {
    console.error(
      "Unable to save item to DynamoDB. Error JSON:",
      JSON.stringify(error, null, 2)
    ); // Log any errors
    throw error; // Rethrow the error to handle it outside
  }
};

// Main handler function for the Lambda
export const main = handler(async (event) => {
  // Parse the request body to get input data
  const data = JSON.parse(event.body);
  const {
    rwUserName,
    rwUserId,
    url,
    rephrasedTitle,
    rephrasedDescription,
    rwBody,
    addedTS,
    pubDate,
    pubTS,
  } = data;

  const normalizedAutoSubjectId = Number(data.autoSubjectId);
  const hasExplicitSubjects =
    Array.isArray(data.subjects) && data.subjects.length > 0;
  const subjectsFromAuto =
    Number.isFinite(normalizedAutoSubjectId) && normalizedAutoSubjectId > 0
      ? [{ id: normalizedAutoSubjectId, users: ["AI"] }]
      : [];
  const subjectsToStore = hasExplicitSubjects
    ? data.subjects
    : subjectsFromAuto;

  try {
    const slug = buildArticleSlug(rephrasedTitle, url);

    // Call the saveDataInDynamoDb function to save the data (pass optional subjects)
    await saveDataInDynamoDb(
      url,
      rwUserName,
      rwUserId,
      rephrasedTitle,
      rephrasedDescription,
      rwBody,
      addedTS,
      pubDate,
      pubTS,
      slug,
      subjectsToStore
    );

    // Return a successful response
    return {
      response: "success",
      slug,
    };
  } catch (error) {
    console.error("Error processing request:", error); // Log the error

    // Return an error response
    return {
      response: "error",
    };
  }
});

// Utility function to get the current date in a specific format
function getCurrentDate(daysToAdd = 0) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Get the current date
  let currentDate = new Date();

  // Add the specified number of days, if any
  if (daysToAdd !== 0) {
    currentDate.setDate(currentDate.getDate() + daysToAdd);
  }

  // Format the date as a readable string
  const dayOfWeek = days[currentDate.getUTCDay()];
  const month = months[currentDate.getUTCMonth()];
  const day = currentDate.getUTCDate();
  const year = currentDate.getUTCFullYear();
  const hours = currentDate.getUTCHours();
  const minutes = currentDate.getUTCMinutes();
  const seconds = currentDate.getUTCSeconds();

  return `${dayOfWeek} ${month} ${day} ${year}, ${hours}:${minutes}:${seconds} GMT+0000 (Coordinated Universal Time)`;
}
