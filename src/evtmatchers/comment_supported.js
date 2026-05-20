import jsonDiff from "json-diff";
import { JSONPath } from "jsonpath-plus";
import * as dynamoDbLib from "../libs/dynamodb-lib";

// semantics:
//
// if NewImage.id is "supportComments" and NewImage differs from OldImage by content.sortKey (which is comment sort key) 'comment_supported' event

export const matched = (input) => {
  console.log("got input: ", JSON.stringify(input, null, 2));

  if (!input.NewImage.id.S == "supportComments") {
    return false;
  }
  let parsed = getSupportedCommentInfo(input);

  if (
    !parsed ||
    parsed.commentId === undefined ||
    parsed.sortKey === undefined ||
    parsed.title === undefined ||
    parsed.url === undefined
  ) {
    return false;
  }
  // console.log(JSON.stringify(parsed, null, 2));
  return true;
};

export const getEventData = async (input) => {
  if (!matched(input)) {
    console.log("getEventData NOT MATCHED", JSON.stringify(input, null, 2));
    return {};
  }

  try {
    const commentInfo = getSupportedCommentInfo(input);
    const likerProfile = await dynamoDbLib.getUserProfileData(
      input.NewImage.sortKey.S
    );

    const eventData = {
      commentId: commentInfo.commentId,
      commentSortKey: commentInfo.sortKey, // this and url uniquily identifies comment in database for any event handler to have all information
      timestamp: input.ApproximateCreationDateTime, // event timestamp
      title: commentInfo.title,
      rssUrl: commentInfo.rssUrl,
      url: commentInfo.url,
      username: likerProfile.nickname,
    };
    return eventData;
  } catch (e) {
    console.log(`getEventData error: `, e);
  }

  return {};
};

function getSupportedCommentInfo(input) {
  let diff = jsonDiff.diff(input.OldImage, input.NewImage);

  // console.log(`COMPARED WHILE LOOKING UP SUPPORTED COMMENTID: ${JSON.stringify(diff, null, 2)}`);
  // https://jsonpath.com - use this site to validate path value below against mocked json
  let parsedSortKey = JSONPath({
    path: '$.content.L[?(@[0]=="+")][1].M.sortKey.S',
    json: diff,
    resultType: "value",
  });
  let parsedURL = JSONPath({
    path: '$.content.L[?(@[0]=="+")][1].M.url.S',
    json: diff,
    resultType: "value",
  });
  let parsedTitle = JSONPath({
    path: '$.content.L[?(@[0]=="+")][1].M.title.S',
    json: diff,
    resultType: "value",
  });
  let parsedCommentId = JSONPath({
    path: '$.content.L[?(@[0]=="+")][1].M.commentId.S',
    json: diff,
    resultType: "value",
  });
  // console.log(`PARSED COMMENT ID: ${JSON.stringify(parsed[0], null, 2)}`);
  return {
    url: parsedURL[0],
    sortKey: parsedSortKey[0],
    title: parsedTitle[0],
    commentId: parsedCommentId[0],
  };
}
