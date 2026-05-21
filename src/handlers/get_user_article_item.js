import { getUserArticleItem } from "../libs/user_article_interaction_lib";

function parsePathParam(value) {
  if (typeof value !== "string" || value.length === 0) {
    return { value: null, invalid: false };
  }

  try {
    const decoded = decodeURIComponent(value).trim();
    return { value: decoded || null, invalid: !decoded };
  } catch (error) {
    return { value: null, invalid: true };
  }
}

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

export async function main(event) {
  const userIdParam = parsePathParam(event.pathParameters?.userId);
  const articleIdParam = parsePathParam(event.pathParameters?.articleId);

  if (!userIdParam.value || !articleIdParam.value) {
    const invalid = userIdParam.invalid || articleIdParam.invalid;
    return buildResponse(invalid ? 400 : 400, {
      status: false,
      error: invalid
        ? "Invalid userId or articleId"
        : "Missing userId or articleId",
    });
  }

  const userArticleItem = await getUserArticleItem(
    userIdParam.value,
    articleIdParam.value
  );

  if (!userArticleItem) {
    return buildResponse(404, {
      status: false,
      error: "User-article item not found",
    });
  }

  return buildResponse(200, {
    status: true,
    item: userArticleItem,
  });
}
