/**
 * Creates a prompt from the news and prime.
 * @param {string} news - The news to be paraphrased.
 * @param {array} prime - The prime to be appended to the news.
 * @returns {array} prompt - The prime and prompt to be sent to OpenAI.
 * */
const apiKey = "943546f1-e738-4862-abb0-2ecb4bf1e675";

const createPrompt = (news, prime) => {
  return [...prime, { role: 'user', content: news }];
};

const createOneAiPrompt = (url) => {
  return {
    method: "POST",
    url: "https://api.oneai.com/api/v0/pipeline",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    data: {
      input: url,
      input_type: "article",
      output_type: "json",
      multilingual: {
        enabled: true
      },
      steps: [
        {
          skill: "html-extract-article"
        }
      ],
    },
  };
};

export { createPrompt, createOneAiPrompt };
