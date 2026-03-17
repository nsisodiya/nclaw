const { exec } = require('child_process');

module.exports = {
  definition: {
    name: "execute_command",
    description: "Execute a shell command on the local system.",
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "The shell command to execute."
        },
        cwd: {
          type: "string",
          description: "The directory to run the command in."
        }
      },
      required: ["command"]
    }
  },
  handler: async ({ command, cwd }) => {
    return new Promise((resolve) => {
      exec(command, { cwd: cwd || process.cwd() }, (error, stdout, stderr) => {
        resolve({
          success: !error,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: error ? error.message : null
        });
      });
    });
  }
};
