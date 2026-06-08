import ogs from "open-graph-scraper";
import handler from "../libs/handler-lib";

export const main = handler(async (event, context) => {
  const before = new Date();
  const targetUrl = decodeURIComponent(event.pathParameters.url);

  const { result, error } = await ogs({ url: targetUrl });
  if (error) throw new Error(`open-graph-scraper failed for ${targetUrl}`);

  console.log(`Request duration: ${new Date() - before}`);
  return {
    title: result.ogTitle,
    image: result.ogImage?.[0]?.url,
  };
});
