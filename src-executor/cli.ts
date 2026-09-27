import { parseArgs } from 'node:util';
import path from 'node:path';
import { loadExecutorConfig } from './config.js';
import { startExecutor } from './main.js';
async function main() {
  if (process.argv.includes('--help')) {
    console.log(
      'PolyAgent executor development CLI: --config <file> --mode observe|live|disabled. Normal users manage the executor in the App.',
    );
    return;
  }
  const { values } = parseArgs({
    options: { config: { type: 'string' }, mode: { type: 'string' } },
  });
  const config = await loadExecutorConfig(
    path.resolve(values.config ?? '.nimi/local/executor.json'),
  );
  if (values.mode) {
    if (!['disabled', 'observe', 'live'].includes(values.mode)) throw new Error('Invalid mode');
    config.mode = values.mode as typeof config.mode;
  }
  const service = await startExecutor(config);
  console.log(`PolyAgent executor: ${service.url} · ${service.mode}`);
  const stop = () => {
    void service.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}
void main().catch(() => {
  console.error(
    'Executor startup failed. Check configuration, port and state-directory lock. No credentials are logged.',
  );
  process.exitCode = 1;
});
