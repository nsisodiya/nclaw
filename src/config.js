require('dotenv').config();

module.exports = {
  lmStudio: {
    baseURL: process.env.LM_STUDIO_BASE_URL || process.env.LM_STUDIO_URL || 'http://localhost:1234/v1',
    apiKey:  process.env.LM_STUDIO_API_KEY  || 'lm-studio',
    model:   process.env.LM_STUDIO_MODEL    || 'qwen/qwen3.5-9b',
  },
};
