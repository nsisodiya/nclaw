/**
 * Web interaction tool.
 * Opens URLs in the browser or fetches page content (HTML stripped).
 */
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

const definition = {
  name: 'web_action',
  description: 'Open a URL in the browser, or fetch and read webpage content as plain text.',
  parameters: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['open_url', 'fetch_url'],
        description: 'open_url: open in default browser | fetch_url: download and return page text'
      },
      url: {
        type: 'string',
        description: 'The URL to open or fetch'
      }
    },
    required: ['action', 'url']
  }
};

function stripHtml(html) {
  return String(html)
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function handler({ action, url }) {
  try {
    if (action === 'open_url') {
      await execAsync(`open "${url.replace(/"/g, '\\"')}"`);
      return { success: true, data: `Opened in browser: ${url}` };
    }

    if (action === 'fetch_url') {
      const axios = require('axios');
      const response = await axios.get(url, {
        timeout: 15000,
        headers: { 'User-Agent': 'nclaw/2.0 (local AI agent)' },
        maxContentLength: 500000,
      });
      const text = stripHtml(response.data).slice(0, 4000);
      return {
        success: true,
        data: text,
        url,
        status: response.status,
        contentType: response.headers['content-type'],
      };
    }

    return { success: false, error: `Unknown action: ${action}` };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

module.exports = { definition, handler };
