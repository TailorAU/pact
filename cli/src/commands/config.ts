import { Command } from 'commander';
import { setConfig, getConfigValues, clearConfig } from '../config.js';

export function registerConfigCommand(program: Command): void {
  program
    .command('config')
    .description('Configure PACT server connection')
    .option('--server <url>', 'PACT server URL (e.g. https://api.example.com)')
    .option('--key <apiKey>', 'API key for authentication')
    .option('--token <bearer>', 'Bearer token for authentication')
    .option('--show', 'Show current configuration')
    .option('--clear', 'Clear all stored configuration')
    .action(async (opts: { server?: string; key?: string; token?: string; show?: boolean; clear?: boolean }) => {
      if (opts.clear) {
        clearConfig();
        console.log('Configuration cleared.');
        return;
      }

      if (opts.server || opts.key || opts.token) {
        setConfig(opts);
        console.log('Configuration updated.');
      }

      if (opts.show || (!opts.server && !opts.key && !opts.token && !opts.clear)) {
        const values = getConfigValues();
        console.log('PACT CLI Configuration:');
        console.log(`  Server:  ${values.baseUrl ?? '(not set)'}`);
        console.log(`  API Key: ${values.apiKey ?? '(not set)'}`);
        console.log(`  Token:   ${values.hasToken ? '(set)' : '(not set)'}`);
      }
    });
}
