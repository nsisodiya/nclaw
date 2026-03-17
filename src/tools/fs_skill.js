const fs = require('fs').promises;
const path = require('path');

module.exports = {
  definition: {
    name: "manage_file",
    description: "Read, write, or list files in the local filesystem.",
    parameters: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["read", "write", "list", "delete"],
          description: "The action to perform."
        },
        filePath: {
          type: "string",
          description: "The sequence path to the file or directory."
        },
        content: {
          type: "string",
          description: "Content to write (only for 'write' action)."
        }
      },
      required: ["action", "filePath"]
    }
  },
  handler: async ({ action, filePath, content }) => {
    const absPath = path.isAbsolute(filePath) ? filePath : path.join(process.cwd(), filePath);
    
    try {
      switch (action) {
        case "read":
          const data = await fs.readFile(absPath, 'utf8');
          return { success: true, content: data };
        case "write":
          await fs.mkdir(path.dirname(absPath), { recursive: true });
          await fs.writeFile(absPath, content, 'utf8');
          return { success: true, message: `File written to ${absPath}` };
        case "list":
          const files = await fs.readdir(absPath);
          return { success: true, files };
        case "delete":
          await fs.unlink(absPath);
          return { success: true, message: `File deleted: ${absPath}` };
        default:
          return { success: false, error: "Invalid action" };
      }
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
};
