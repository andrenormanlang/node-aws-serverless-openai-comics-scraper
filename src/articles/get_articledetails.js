import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const q = {
    url: decodeURIComponent(event.pathParameters.url),
  };
  console.log(event);
  const data = event.queryStringParameters;
  console.log("koko: ", data);
  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: q.url,
      sortKey: "articles",
    },
  };
  const result = await dynamoDbLib.call("get", params);
  if (!Object.keys(result).length)
    return {
      errorMsg: "Url doesn't exist in dynamo db",
    };

  //pretty sure i have to reset db

  return {
    title: result.Item.title,
    description: result.Item.description,
    articlebody: result.Item.rwBody,
  };
});
