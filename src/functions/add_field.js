import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";

export const main = handler(async (event, context) => {
  const { fieldName, fieldValue } = event.fieldParameters;

  const params = {
    TableName: defs.WN_STR_KEY_TABLE,
    FilterExpression:
      "#field = :value AND NOT (#newfield = :trueval) AND NOT (#newfield = :falseval)",
    ExpressionAttributeNames: {
      "#field": event.filter.fieldName,
      "#newfield": fieldName,
    },
    ExpressionAttributeValues: {
      ":value": event.filter.fieldValue,
      ":trueval": true,
      ":falseval": false,
    },
  };

  let result = await dynamoDbLib.call("scan", params);
  addField(result);

  while (typeof result.LastEvaluatedKey != "undefined") {
    console.log(`SCAN NEXT: ${result.LastEvaluatedKey}`);
    params.ExclusiveStartKey = result.LastEvaluatedKey;
    result = await await dynamoDbLib.call("scan", params);
    addField(result);
  }

  async function addField(result) {
    let updated = 0;
    for (const item of result.Items) {
      console.log("===================================================");
      console.log(item);
      if (item[fieldName] === undefined) {
        const updateParams = {
          TableName: defs.WN_STR_KEY_TABLE,
          // 'Key' defines the partition key and sort key of the item to be updated
          Key: {
            id: item.id,
            sortKey: defs.DB_PROFILE_SORT_KEY,
          },
          // 'UpdateExpression' defines the attributes to be updated
          // 'ExpressionAttributeValues' defines the value in the update expression
          UpdateExpression: `SET ${fieldName} = :newfieldvalue`,
          ExpressionAttributeValues: {
            ":newfieldvalue": fieldValue,
          },
          // 'ReturnValues' specifies if and how to return the item's attributes,
          // where ALL_NEW returns all attributes of the item after the update; you
          // can inspect 'result' below to see how it works with different settings
          ReturnValues: "ALL_NEW",
        };

        await dynamoDbLib.call("update", updateParams);
        updated++;
      }
      item[fieldName] = fieldValue;
      console.log(fieldValue);
    }
    return { updated: updated };
  }
});
