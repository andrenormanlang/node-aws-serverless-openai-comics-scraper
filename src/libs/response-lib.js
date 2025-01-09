export function success(body) {
  return buildResponse(200, body);
}

export function failure(body) {
  return buildResponse(500, body);
}

function buildResponse(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Credentials": true,
    },
    body: JSON.stringify(body),
  };
}

export function find_missing_params(dataObj, expParams) {
  let length = expParams.length;
  for (let i = 0; i < length; ++i) {
    let neededParam = expParams[i];
    if (!dataObj.hasOwnProperty(neededParam)) {
      return `Missing param ${neededParam}`;
    }
  }

  return null;
}
