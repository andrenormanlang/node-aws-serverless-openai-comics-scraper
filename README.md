# API

## Info

API was built following the [serverless-stack guide](https://serverless-stack.com/#table-of-contents). Follow this guide to get a better understanding on how it's built and how to make changes.

A list containing all endpoints can be found at [serverless.yml](./serverless.yml)
Perform a global search of the `path` in the project to see where and how endpoints are used.

## Endpoints

### GET /newsplitter/{url}

Looks at given rss feed and adds articles to database and returns the last 100 articles to the user.

**URL Params**

|  Name | Required |  Type  | Description                                                                                                   |
| ----: | :------: | :----: | ------------------------------------------------------------------------------------------------------------- |
| `url` | required | string | url to RSS feed from where to fetch news. Currently limited to [SVT RSS](https://www.svt.se/nyheter/rss.xml). |

**Response**

To be added.

---

### GET /profile/{body}

Returns profile information.

**URL Params**

|   Name | Required |  Type  | Description                                                                                                                                                       |
| -----: | :------: | :----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `body` |   true   | string | **NOTE: This should be removed, is not used and is not implemented properly anyway** Refer to [api-functions.js:185](../wn-native/src/ext_utils/api-functions.js) |

**Response**

To be added.

---

### PUT /smart/profile

Updates profile information.

**URL Params**

None

**Data Params**

|         Name | Required |  Type  | Description                                                                                                                                                                         |
| -----------: | :------: | :----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|   `nickname` |   true   | string | Username, firstname(stored as given_name in AWS) and lastname(stored as family_name in AWS)                                                                                         |
| `profilePic` |   true   | string | Outdated, but still required. Use https://ra.ac.ae/wp-content/uploads/2017/02/user-icon-placeholder.png or simply remove the field.                                                 |
|   `imageKey` |   true   | string | Key to fetch user profile from AWS S3. Refer to [SettingsScreenLoggedIn.js:37](../wn-native/src/screens/SettingsScreenLoggedIn.js) for working example on how the imageKey is used. |
|      `subId` |   true   | string | Link between user in DynamoDB and Cognito. Access via Amplify `Auth.currentUserInfo()`.                                                                                             |
|      `email` |   true   | string | Also accessed via `Auth.currentUserInfo()`. Used to query email adresses in DynamoDB, currently has no other uses.                                                                  |

**Response**

To be added.

---

### GET /comments/{body}

Returns profile information.

**NOTE:** This needs revisiting. Refer to [CommentUtils.js:9](../wn-native/src/ext_utils/CommentUtils.js) to get a better understanding of how this works.

**URL Params**

|   Name | Required |  Type  | Description                                                                    |
| -----: | :------: | :----: | ------------------------------------------------------------------------------ |
| `body` |   true   | string | **Not implemented properly!** Currently expects article URL to fetch comments. |

**Data Params**

None

**Response**

To be added.

---

### POST /comments

Adds a comment & adds a notification to the user who recieved the reply(if it was a reply).

Refer to [CommentUtils.js:4](../wn-native/src/ext_utils/CommentUtils.js) to get a better understanding of how this works.

**URL Params**

None

**Data Params**

|          Name | Required |  Type  | Description                                                                                                                                                       |
| ------------: | :------: | :----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
|         `msg` |   true   | string | The actual comment message.                                                                                                                                       |
| `parentMsgId` |   true   | string | Comment ID of the comment which got replied to. If it is not a reply to a comment, `0` must be specified to indicate it's a root comment(in relation to article). |
|         `url` |   true   | string | Article URL.                                                                                                                                                      |
|      `rssUrl` |   true   | string | RSS URL. Currently limited to [SVT RSS](https://www.svt.se/nyheter/rss.xml).                                                                                      |

**Response**

To be added.

---

### PUT /comments

Deletes a single comment.
**NOTE:** Does not actually delete the row in the database. Instead replaces the fields that contain information to be deleted with `null` values. This is to not break the tree structure in the application.

See [api-functions.js:216](../wn-native/src/ext_utils/api-functions.js) for usage.

**URL Params**

None

**Data Params**

|      Name | Required |  Type  |
| --------: | :------: | :----: |
|      `id` |   true   | string |
| `sortKey` |   true   | string |

**Response**

To be added.

---

### PUT /smart/article/{url}

Updates article feedback.

**URL Params**

|  Name | Required |  Type  | Description  |
| ----: | :------: | :----: | ------------ |
| `url` |   true   | string | Article URL. |

**Data Params**

|     Name | Required |  Type  | Description                                                           |
| -------: | :------: | :----: | --------------------------------------------------------------------- |
| `action` |   true   | string | Can be one of the following: `likes`, `dislikes`, `trust`, `distrust` |

**Response**

To be added.

---

### GET /smart/article/{url}

Get article information. Used in combination with notifications & other functionality where user should be redirected to a specific article.

**URL Params**

|  Name | Required |  Type  | Description  |
| ----: | :------: | :----: | ------------ |
| `url` |   true   | string | Article URL. |

**Data Params**

None

**Response**

To be added.

---

### GET smart/feedback/{url}

**NOTE: Outdated, should be removed!** Gets article feedback.

**URL Params**

|  Name | Required |  Type  | Description  |
| ----: | :------: | :----: | ------------ |
| `url` |   true   | string | Article URL. |

**Data Params**

None

**Response**

To be added.

---

### GET smart/trending/comments

Gets articles with activity(based on comments).
See [get_trending_comments](./src/functions/get_trending_comments.js) for more info.

**URL Params**

None

**Data Params**

None

**Response**

To be added.

---

### GET smart/trending/interest

Gets articles with a specific like portion in relation to dislike(interest).
See [get_trending_interesting](./src/functions/get_trending_interest.js) for more info on how the algorithm that filters/sorts interesting articles work.

**URL Params**

None

**Data Params**

None

**Response**

To be added.

---

### GET smart/metadata/{url}

Returns article metadata(mainly used for article image).

**URL Params**

|  Name | Required |  Type  | Description  |
| ----: | :------: | :----: | ------------ |
| `url` |   true   | string | Article URL. |

**Data Params**

None

**Response**

To be added.

---
