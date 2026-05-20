import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";

export const main = handler(async (event, context) => {
  const { fieldName } = event.body.fieldParameters;

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    FilterExpression:
      "#field = :value AND NOT (#newfield = :trueval) AND NOT (#newfield = :falseval)",
    ExpressionAttributeNames: {
      "#field": event.body.filter.fieldName,
      "#newfield": fieldName,
    },
    ExpressionAttributeValues: {
      ":value": event.body.filter.fieldValue,
      ":trueval": true,
      ":falseval": false,
    },
  };
  // console.log(event);

  let result = await await dynamoDbLib.call("scan", params);
  printResults(result);

  while (typeof result.LastEvaluatedKey != "undefined") {
    console.log(`SCAN NEXT: ${result.LastEvaluatedKey}`);
    params.ExclusiveStartKey = result.LastEvaluatedKey;
    result = await await dynamoDbLib.call("scan", params);
    printResults(result);
  }
  // Return the matching list of items in response body
  return "Ok";
});

function printResults(result) {
  for (const item of result.Items) {
    console.log("===================================================");
    console.log(item);
  }
}
