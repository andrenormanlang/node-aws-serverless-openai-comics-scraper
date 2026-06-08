import handler from "../libs/handler-lib";
import {
  addUserArticleSupport,
  removeUserArticleSupport,
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

  const changed =
    method === "DELETE"
      ? await removeUserArticleSupport({ userId, articleId })
      : await addUserArticleSupport({ userId, articleId });

  const item = changed ? await getUserArticleItem(userId, articleId) : null;

  return buildResponse(200, {
    status: true,
    message: changed ? (method === "DELETE" ? "support removed" : "support added") : "no-op",
    item,
  });
});
