import handler from "../libs/handler-lib";
import * as dynamoDbLib from "../libs/dynamodb-lib";
import * as defs from "../libs/defs";

export const main = handler(async (event, context) => {
  const data = JSON.parse(event.body);

  const params = {
    userId: event.requestContext.identity.cognitoIdentityId,
    type: event.pathParameters.type,
  };

  console.log(data.content);
  console.log(params);

  if (params.type === "comments") {
    const commentQuery = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: data.content.id,
        sortKey: data.content.sortKey,
      },
    };

    const comment = await dynamoDbLib.call("get", commentQuery);
    const userIndex = comment.Item.support.indexOf(params.userId);

    console.log("index: ", userIndex);

    const deleteQuery = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: data.content.id,
        sortKey: data.content.sortKey,
      },
      ExpressionAttributeNames: {
        "#support": "support",
      },
      UpdateExpression: `REMOVE #support[${userIndex}]`,
      ReturnValues: "ALL_NEW",
    };

    await dynamoDbLib.call("update", deleteQuery);
  } else if (params.type === "articles") {
    const articleQuery = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: data.content.url,
        sortKey: data.content.source,
      },
    };

    const article = await dynamoDbLib.call("get", articleQuery);
    const userIndex = article.Item.support.indexOf(params.userId);

    const deleteQuery = {
      TableName: defs.WN_STR_KEY_TABLE,
      Key: {
        id: data.content.url,
        sortKey: data.content.source,
      },
      ExpressionAttributeNames: {
        "#support": "support",
      },
      UpdateExpression: `REMOVE #support[${userIndex}]`,
      ReturnValues: "ALL_NEW",
    };

    await dynamoDbLib.call("update", deleteQuery);
  }

  ////////////////

  const typeCapitalized =
    params.type.charAt(0).toUpperCase() + params.type.slice(1);

  const supportQuery = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: `support${typeCapitalized}`,
      sortKey: params.userId,
    },
  };

  const support = await dynamoDbLib.call("get", supportQuery);
  console.log("support", support.Item.content);
  console.log("body baby", data);

  let supportIndex;
  if (typeCapitalized === "Comments") {
    supportIndex = support.Item.content.findIndex(
      (x) => x.sortKey === data.content.sortKey
    );
  } else if (typeCapitalized === "Articles") {
    supportIndex = support.Item.content.findIndex(
      (x) => x.url === data.content.url
    );
  }

  const query = {
    TableName: defs.WN_STR_KEY_TABLE,
    Key: {
      id: `support${typeCapitalized}`,
      sortKey: params.userId,
    },
    ExpressionAttributeNames: {
      "#content": "content",
    },
    UpdateExpression: `REMOVE #content[${supportIndex}]`,
    ReturnValues: "ALL_NEW",
  };

  const result = await dynamoDbLib.call("update", query);
  return result;
});
