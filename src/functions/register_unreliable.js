import handler from "../libs/handler-lib";
import {
  setUserArticleUnreliable,
  getUserArticleItem,
} from "../libs/user_article_interaction_lib";

function buildResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify(body),
  };
}

export const main = handler(async (event) => {
  const userId = event.requestContext?.identity?.cognitoIdentityId;
  const articleId = decodeURIComponent(event.pathParameters?.articleId || "");
  const method = event.httpMethod;

  if (!userId || !articleId) {
    return buildResponse(400, {
      status: false,
      message: "Missing userId or articleId",
    });
  }

  const changed = await setUserArticleUnreliable({
    userId,
    articleId,
    value: method !== "DELETE",
  });

  const item = changed ? await getUserArticleItem(userId, articleId) : null;

  return buildResponse(200, {
    status: true,
    message: changed
      ? method === "DELETE"
        ? "unreliable removed"
        : "unreliable added"
      : "no-op",
    item,
  });
});
