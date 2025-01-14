import handler from "../libs/handler-lib";

const metascraper = require("metascraper")([
  require("metascraper-title")(),
  require("metascraper-image")(),
]);
const got = require("got");

//conditionally require(for future optimization reasons) - https://stackoverflow.com/questions/36367532/how-can-i-conditionally-import-an-es6-module

export const main = handler(async (event, context) => {
  const before = new Date();
  const params = {
    url: decodeURIComponent(event.pathParameters.url),
  };

  const targetUrl = params.url;
  const { body: html, url } = await got(targetUrl);
  const metadata = await metascraper({ html, url });

  console.log(`Request duration: ${new Date() - before}`);
  return metadata;
});
