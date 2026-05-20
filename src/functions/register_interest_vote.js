import handler from "../libs/handler-lib";
import { registerInterestVoteEvent } from "../libs/user_article_interaction_lib";

export const main = handler(async (event) => {
  const data = event.body ? JSON.parse(event.body) : {};
  const userId = event.requestContext?.identity?.cognitoIdentityId;
  const articleId = decodeURIComponent(event.pathParameters?.articleId || "");
  const voteType = data.voteType;

  if (!userId || !articleId || !voteType) {
    return { status: 400, message: "Missing userId, articleId or voteType" };
  }

  const result = await registerInterestVoteEvent({
    userId,
    articleId,
    voteType,
  });
  return { message: result };
});
