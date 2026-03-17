require('dotenv').config();

module.exports = {
  lmStudio: {
    baseURL: process.env.LM_STUDIO_URL || "http://localhost:1234/v1",
    apiKey: "not-needed",
    model: "qwen/qwen3.5-9b", // Adjust if needed
  }
};
