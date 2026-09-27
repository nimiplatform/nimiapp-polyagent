import path from 'node:path';
import { parseArgs } from 'node:util';
import { prepareExecutor } from './config.js';
async function main() {
  const { values } = parseArgs({
    options: {
      'source-env': { type: 'string' },
      config: { type: 'string' },
      'signing-method': { type: 'string', default: 'keychain' },
      'max-order': { type: 'string' },
      'max-exposure': { type: 'string' },
      'max-buy-orders': { type: 'string' },
      'max-buy-budget': { type: 'string' },
    },
  });
  if (
    !values['source-env'] ||
    !values['max-order'] ||
    !values['max-exposure'] ||
    !values['max-buy-orders'] ||
    !values['max-buy-budget']
  )
    throw new Error('请明确指定源配置和四项测试上限');
  if (!['keychain', 'wallet'].includes(values['signing-method'])) throw new Error('签名方式无效');
  const file = path.resolve(values.config ?? '.nimi/local/executor.json');
  const config = await prepareExecutor(
    path.resolve(values['source-env']),
    file,
    {
      maxOrderUsd: Number(values['max-order']),
      maxExposureUsd: Number(values['max-exposure']),
      maxBuyOrders: Number(values['max-buy-orders']),
      maxBuyBudgetUsd: Number(values['max-buy-budget']),
    },
    values['signing-method'] as 'keychain' | 'wallet',
  );
  console.log(
    JSON.stringify(
      {
        configFile: file,
        mode: config.mode,
        wallet: config.wallet.walletAddress,
        signer: config.wallet.signerAddress,
        limits: config.limits,
        secretStorage: 'macOS Keychain',
      },
      null,
      2,
    ),
  );
}
void main().catch(() => {
  process.stderr.write(
    '配置准备失败。请检查指定文件、地址匹配、资金上限和 Keychain 访问；现有配置不会覆盖。未输出密钥。\n',
  );
  process.exitCode = 1;
});
