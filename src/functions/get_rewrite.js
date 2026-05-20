import {
  initConfiguration,
  promptConfiguration,
  prime,
} from '../libs/config.js';
import { createOpenAI } from '../libs/openAIInterface';
import { createPrompt } from '../libs/createPrompt.js';

export async function main(event, context) {
  const body = JSON.parse(event.body);
  const title = body.title;
  const description = body.description;
  const articlebody = body.articlebody;
  const tiltePrompt = createPrompt(title, prime);
  const descriptionPrompt = createPrompt(description, prime);
  const articlebodyPrompt = createPrompt(articlebody, prime);
  const phrasedTitle = await getPhrasedDataFromAi(tiltePrompt);
  console.log("pharsedTitle   " + phrasedTitle);
  if (!descriptionPrompt) {
    const phrasedDescriptionPrompt = await getPhrasedDataFromAi(descriptionPrompt);
    console.log("pharseddescr  " + phrasedDescriptionPrompt);
  }
  else {
    const phrasedDescriptionPrompt = "";
    console.log("pharseddescr  " + phrasedDescriptionPrompt);
  }
  const phrasedarticlebodyPrompt = await getPhrasedDataFromAi(articlebodyPrompt);
  console.log("pharsbody  " + phrasedarticlebodyPrompt);
};
async function getPhrasedDataFromAi(openAiRequestData) {
  const openAI = await createOpenAI(initConfiguration);
  const response = await openAI.createChatCompletion({
    ...promptConfiguration,
    messages: openAiRequestData,
  });
  // destructuring the response
  const paraphrazedNews = response.data.choices[0].message.content;
  return paraphrazedNews;
}