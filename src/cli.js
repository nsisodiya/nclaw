const readline = require('readline');
const { runAgent } = require('./agent');
const chalk = require('chalk');
const { Command } = require('commander');

const program = new Command();

program
  .name('nclaw')
  .description('A local AI agent inspired by OpenClaw')
  .version('1.0.0');

program.action(async () => {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: chalk.magenta('nclaw> ')
  });

  console.log(chalk.bold.cyan("\n--- nclaw: Local agent starting ---"));
  console.log(chalk.dim("Type 'exit' or 'quit' to stop.\n"));

  let history = [];

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();
    if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
      rl.close();
      return;
    }

    if (input) {
      try {
        const result = await runAgent(input, history);
        history = result.history;
        console.log(chalk.white(`\n${result.response}\n`));
      } catch (error) {
        console.error(chalk.red(`\nError: ${error.message}\n`));
      }
    }
    rl.prompt();
  }).on('close', () => {
    console.log(chalk.bold.cyan('\nGoodbye!'));
    process.exit(0);
  });
});

program.parse();
