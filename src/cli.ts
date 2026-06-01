#!/usr/bin/env node
import { Command } from 'commander';

const program = new Command();
program
  .name('job-scout')
  .description('Find and tailor job applications from your living profile.')
  .version('0.1.0');

// Subcommands are registered in later tasks.

program.parseAsync(process.argv).catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(process.env.JOB_SCOUT_DEBUG === '1' ? err : `Error: ${message}`);
  process.exit(1);
});
