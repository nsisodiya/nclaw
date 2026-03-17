const { spawn } = require('child_process');

const activeProcesses = new Set();

// Ensure all child processes are killed when the main process exits
function cleanupProcesses() {
  for (const child of activeProcesses) {
    if (!child.killed) {
      try {
        // Kill the entire process group
        process.kill(-child.pid, 'SIGKILL');
      } catch (e) {
        // Ignore if process already exited
      }
    }
  }
}

process.on('exit', cleanupProcesses);
process.on('SIGINT', () => { cleanupProcesses(); process.exit(); });
process.on('SIGTERM', () => { cleanupProcesses(); process.exit(); });

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
      // Use spawn with shell and detached to form a process group
      const child = spawn(command, { 
        shell: true, 
        cwd: cwd || process.cwd(),
        detached: true 
      });

      activeProcesses.add(child);

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (code) => {
        activeProcesses.delete(child);
        resolve({
          success: code === 0,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: code !== 0 ? `Command failed with exit code ${code}` : null
        });
      });
      
      child.on('error', (err) => {
        activeProcesses.delete(child);
         resolve({
          success: false,
          stdout: stdout.trim(),
          stderr: stderr.trim(),
          error: err.message
        });
      });
    });
  }
};
