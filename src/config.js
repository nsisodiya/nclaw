const path = require('path');
const os = require('os');
const fs = require('fs');

const CONFIG_PATH = path.join(os.homedir(), '.nclaw', 'config.json');

const DEFAULTS = {
  lmStudioBaseURL: 'http://localhost:1234/v1',
  lmStudioApiKey: 'lm-studio',
  lmStudioModel: 'qwen/qwen3.5-9b',
  telegramBotToken: '',
  telegramAllowedUsers: []
};

function load() {
  try {
    const d = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      lmStudio: {
        baseURL: d.lmStudioBaseURL || DEFAULTS.lmStudioBaseURL,
        apiKey: d.lmStudioApiKey || DEFAULTS.lmStudioApiKey,
        model: d.lmStudioModel || DEFAULTS.lmStudioModel
      },
      telegramBotToken: d.telegramBotToken || '',
      telegramAllowedUsers: d.telegramAllowedUsers || []
    };
  } catch {
    return {
      lmStudio: {
        baseURL: DEFAULTS.lmStudioBaseURL,
        apiKey: DEFAULTS.lmStudioApiKey,
        model: DEFAULTS.lmStudioModel
      },
      telegramBotToken: '',
      telegramAllowedUsers: []
    };
  }
}

const cfg = load();
cfg._path = CONFIG_PATH;
cfg._reload = function () {
  const f = load();
  cfg.lmStudio = f.lmStudio;
  cfg.telegramBotToken = f.telegramBotToken;
  cfg.telegramAllowedUsers = f.telegramAllowedUsers;
};
cfg._defaults = DEFAULTS;

module.exports = cfg;
