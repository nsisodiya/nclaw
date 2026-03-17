/**
 * macOS native notification tool via osascript.
 * Great for long-running tasks: "notify me when done".
 */
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const definition = {
  name: 'send_notification',
  description: 'Send a macOS native desktop notification. Use for long-running tasks to alert the user when done.',
  parameters: {
    type: 'object',
    properties: {
      title: {
        type: 'string',
        description: 'Notification title'
      },
      message: {
        type: 'string',
        description: 'Notification body text'
      },
      subtitle: {
        type: 'string',
        description: 'Optional subtitle (shown below title)'
      }
    },
    required: ['title', 'message']
  }
};

async function handler({ title, message, subtitle }) {
  try {
    const esc = (s) => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    let script = `display notification "${esc(message)}" with title "${esc(title)}"`;
    if (subtitle) script += ` subtitle "${esc(subtitle)}"`;
    await execAsync(`osascript -e '${script}'`);
    return { success: true, data: 'Notification sent.' };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { definition, handler };
