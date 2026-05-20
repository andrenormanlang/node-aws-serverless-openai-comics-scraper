import handler from "../libs/handler-lib";
import { registerOpenedEvent } from "../libs/user_article_interaction_lib";

export const main = handler(async (event) => {
  const userId = event.requestContext?.identity?.cognitoIdentityId;
  const articleId = decodeURIComponent(event.pathParameters?.articleId || "");

  if (!userId || !articleId) {
    return { status: 400, message: "Missing userId or articleId" };
  }

  const result = await registerOpenedEvent({ userId, articleId });
  return { message: result };
});
