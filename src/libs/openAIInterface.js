import { OpenAIApi } from 'openai';

/**
 * Creates an OpenAI instance.
 * @param {object} config - The configuration for OpenAI.
 * @returns {object} openai - The OpenAI instance.
 * */
const createOpenAI = async (config) => {
const openai = new OpenAIApi(config);

return openai;
};

export { createOpenAI };