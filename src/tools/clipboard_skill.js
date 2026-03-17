/**
 * macOS clipboard tool — reads/writes using pbpaste/pbcopy.
 */
const { exec } = require('child_process');

const definition = {
  name: 'manage_clipboard',
  description: 'Read from or write to the macOS clipboard.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['read', 'write'],
        description: 'read: get clipboard contents | write: set clipboard contents'
      },
      content: {
        type: 'string',
        description: 'For write: content to copy to clipboard'
      }
    },
    required: ['action']
  }
};

async function handler({ action, content }) {
  if (action === 'read') {
    return new Promise((resolve) => {
      exec('pbpaste', (err, stdout) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true, data: stdout });
      });
    });
  }

  if (action === 'write') {
    if (!content) return { success: false, error: 'content is required' };
    return new Promise((resolve) => {
      const proc = exec('pbcopy', (err) => {
        if (err) return resolve({ success: false, error: err.message });
        resolve({ success: true, data: 'Copied to clipboard.' });
      });
      proc.stdin.write(content);
      proc.stdin.end();
    });
  }

  return { success: false, error: `Unknown action: ${action}` };
}

module.exports = { definition, handler };
