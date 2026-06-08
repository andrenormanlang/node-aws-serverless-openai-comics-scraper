import * as defs from "../libs/defs";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import handler from "../libs/handler-lib";
// Import the AWS SDK library
// const AWS = require("aws-sdk");

// Configure AWS SDK to use the specified region
// AWS.config.update({ region: "eu-north-1" });

// Function to fetch data from a DynamoDB table using a provided id
const fetchDataFromDynamoDb = async function (slug) {
  // Create a DynamoDB DocumentClient instance for interacting with DynamoDB
  // const dynamodb = new AWS.DynamoDB.DocumentClient();

  // Specify the table name and the key for the item to fetch
  // configure it in your environment file
  const tableName = defs.WN_STR_KEY_TABLE;

  console.log("SLUG", slug);

  const params = {
    TableName: tableName, // The DynamoDB table name
    IndexName: "slug-index",
    KeyConditionExpression: "slug = :slug",
    ExpressionAttributeValues: {
      ":slug": String(slug), // Replace with the actual id you're querying for
    },
  };

  try {
    // Fetch the item from DynamoDB using the provided parameters
    // const response = await dynamodb.get(params).promise();
    const response = await dynamoDbLib.call("query", params);
    return response.Items[0]; // Return the fetched item
  } catch (error) {
    // Log the error and rethrow it if the fetch operation fails
    console.error(
      "Unable to fetch item from DynamoDB. Error JSON:",
      JSON.stringify(error, null, 2),
    );
    throw error;
  }
};

// Main handler function for an AWS Lambda function
export const main = handler(async (event) => {
  // Parse the 'id' from the incoming HTTP request body
  const data = event.pathParameters;

  if (!data.slug) return;

  try {
    // Fetch the item from DynamoDB using the provided id
    const item = await fetchDataFromDynamoDb(decodeURIComponent(data.slug));

    if (item) {
      // Resolve vote counts (prefer counters, fallback to arrays)
      const likesAmount =
        typeof item.interestCount === "number"
          ? item.interestCount
          : item.likes && item.likes.users
            ? item.likes.users.length
            : 0;
      const dislikesAmount =
        typeof item.uninterestCount === "number"
          ? item.uninterestCount
          : item.dislikes && item.dislikes.users
            ? item.dislikes.users.length
            : 0;

      // Return a success response with the fetched item
      return {
        response: "success",
        item: {
          ...item,
          likes: {
            amount: likesAmount,
            status:
              item.likes && item.likes.users
                ? item.likes.users.length > 0
                : false,
          },
          dislikes: {
            amount: dislikesAmount,
            status:
              item.dislikes && item.dislikes.users
                ? item.dislikes.users.length > 0
                : false,
          },
        },
      };
    } else {
      // Return a 404 response if the item is not found
      return {
        response: "error",
        errorMessage: "Item not found",
      };
    }
  } catch (error) {
    // Log the error and return a 500 response if an exception occurs
    console.error("Error processing request:", error);
    return {
      response: "error",
      errorMessage: error.message, // Provide the error message in the response body
    };
  }
});
