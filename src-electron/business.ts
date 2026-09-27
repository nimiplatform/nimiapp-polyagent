import type {
  NimiElectronAppBusinessServices,
  NimiElectronCommandHandler,
} from '@nimiplatform/kit/shell/electron/main';
import { PolyEngine } from '../src/polyagent/engine.js';
import { importWallet, removeWallet, walletStatus } from '../src-executor/keychain.js';
import { loadExecutorConfig, readExecutorSecrets } from '../src-executor/config.js';
import path from 'node:path';
import { ExecutorManager } from './executor-manager.js';
import { permitted } from '../src/polyagent/integration.js';
export function createPolyAgentHost(
  show: () => void,
  openWallet: (url: string) => Promise<void>,
  copyConnectionToken: (token: string) => void,
) {
  let services: NimiElectronAppBusinessServices | undefined;
  let engine: PolyEngine | undefined;
  let generation = 0;
  const executor = new ExecutorManager();
  let credentialBusy = false;
  let executorControlBusy = false;
  let activity: { stop: () => Promise<void> } | undefined;
  const current = async () => {
    const epoch = generation;
    if (!services) throw new Error('Nimi 连接尚未就绪');
    engine ??= new PolyEngine(services);
    const value = engine;
    await value.initialize();
    if (epoch !== generation) throw new Error('Nimi 会话已变化');
    return value;
  };
  const handlers: Record<string, NimiElectronCommandHandler> = {
    'polyagent.snapshot': async () => ({
      ...(await current()).snapshot(),
      executor: executor.status(),
    }),
    'polyagent.executor.start': async ({ payload }) => {
      if (executorControlBusy) throw new Error('服务操作正在进行');
      executorControlBusy = true;
      try {
        const e = await current();
        const epoch = generation;
        if (payload.mode !== 'observe' && payload.mode !== 'live')
          throw new Error('请选择观察或实盘模式');
        const mode = payload.mode;
        if (e.busy || e.workspace?.running) throw new Error('请先停止策略并等待当前操作结束');
        const w = e.workspace!;
        if (!w.executorConfigPath) throw new Error('请先读取本机执行器配置');
        if (mode === 'live') {
          if (payload.confirmLive !== true || w.mode !== 'live' || !w.liveLimitsConfirmed)
            throw new Error('请先保存签名方式与资金上限，再确认启用实盘');
          await e.refreshServices();
          const target = e.connections.find((t) => t.targetRef === w.connectionRef);
          if (!target || !permitted(target, w.signingMethod))
            throw new Error('请先在 Nimi Desktop 授予完整交易权限，再启用实盘');
        }
        const result = await executor.start(w.executorConfigPath, mode, (c) => {
          if (epoch !== generation || e.workspace?.running || e.busy)
            throw new Error('当前状态已变化，请重试');
          const expected = w.live.walletAddress ?? w.wallet?.walletAddress;
          if (expected && c.wallet.walletAddress.toLowerCase() !== expected.toLowerCase())
            throw new Error('执行器配置与已绑定钱包不一致');
          if (c.signingMethod !== w.signingMethod)
            throw new Error('请先保存与执行器相同的签名方式');
          if (
            mode === 'live' &&
            (w.policy.orderUsd > c.limits.maxOrderUsd ||
              w.policy.maxExposureUsd > c.limits.maxExposureUsd)
          )
            throw new Error('App 额度超过执行器上限');
        });
        e.account = null;
        return result;
      } finally {
        executorControlBusy = false;
      }
    },
    'polyagent.executor.stop': async () => {
      const e = await current();
      try {
        await stopServices(e);
      } finally {
        e.account = null;
      }
      return executor.status();
    },
    'polyagent.services': async () => {
      await (await current()).refreshServices();
      return { ok: true };
    },
    'polyagent.dismiss-error': async () => {
      const e = await current();
      e.error = '';
      return { dismissed: true };
    },
    'polyagent.configure': async ({ payload }) => {
      if (executorControlBusy) throw new Error('请等待服务操作结束');
      const e = await current();
      const input = payload.input as Parameters<PolyEngine['configure']>[0];
      if (
        executor.status().state === 'running' &&
        input?.signingMethod !== e.workspace?.signingMethod
      )
        throw new Error('请先停止本机服务再更换签名方式');
      await e.configure(input);
      if (input.mode === 'paper') await executor.stop();
      return { saved: true };
    },
    'polyagent.scan': async () => {
      const e = await current();
      if (e.busy) throw new Error('上一轮仍在进行');
      void e.scan(e.workspace?.running === true).catch((x) => e.report(x));
      return { requested: true };
    },
    'polyagent.start': async () => {
      if (executorControlBusy) throw new Error('请等待服务操作结束');
      if (['starting', 'stopping'].includes(executor.status().state))
        throw new Error('请等待服务切换完成');
      await (await current()).start();
      return { started: true };
    },
    'polyagent.stop': async () => {
      await (await current()).stop();
      return { stopped: true };
    },
    'polyagent.account': async () => (await current()).refreshAccount(),
    'polyagent.executor.load': async ({ payload }) => {
      if (executorControlBusy) throw new Error('请等待服务操作结束');
      const e = await current();
      const scope = generation;
      if (e.busy || e.workspace?.running) throw new Error('请先停止策略再读取配置');
      if (['running', 'starting', 'stopping'].includes(executor.status().state))
        throw new Error('请先停止本机服务再更换配置');
      if (typeof payload.path !== 'string' || !path.isAbsolute(payload.path))
        throw new Error('请输入本机执行器 JSON 配置的完整路径');
      const file = path.resolve(payload.path);
      const c = await loadExecutorConfig(file);
      if (
        e.workspace?.live.walletAddress &&
        e.workspace.live.walletAddress.toLowerCase() !== c.wallet.walletAddress.toLowerCase()
      )
        throw new Error('该账本已绑定另一钱包');
      // Configuration loading handles public references only. The executor
      // verifies its signer before authentication; this Host never unseals a
      // wallet key just to display configuration metadata.
      if (scope !== generation) throw new Error('Nimi 会话已变化');
      await e.modify((w) => {
        w.executorConfigPath = file;
        w.signingMethod = c.signingMethod;
        w.liveLimitsConfirmed = false;
        if (c.wallet.credentialRef)
          w.wallet = {
            ...c.wallet,
            credentialRef: c.wallet.credentialRef,
            importedAt: new Date().toISOString(),
          };
      });
      return {
        url: `http://127.0.0.1:${c.port}/mcp`,
        mode: c.mode,
        signingMethod: c.signingMethod,
        limits: c.limits,
      };
    },
    'polyagent.executor.copy-token': async () => {
      const e = await current();
      const scope = generation;
      if (!e.workspace?.executorConfigPath) throw new Error('先读取本机执行器配置');
      const c = await loadExecutorConfig(e.workspace.executorConfigPath);
      const expected = e.workspace.live.walletAddress ?? e.workspace.wallet?.walletAddress;
      if (expected && expected.toLowerCase() !== c.wallet.walletAddress.toLowerCase())
        throw new Error('配置钱包已变化');
      const secret = await readExecutorSecrets(c.secretsRef);
      if (scope !== generation) throw new Error('Nimi 会话已变化');
      copyConnectionToken(secret.bearer);
      return { copied: true };
    },
    'polyagent.browser-wallet.open': async () => {
      const result = await (await current()).browserWallet('open');
      if (!('url' in result)) throw new Error('钱包连接地址无效');
      await openWallet(result.url);
      return { opened: true };
    },
    'polyagent.browser-wallet.status': async () => (await current()).browserWallet('status'),
    'polyagent.browser-wallet.disconnect': async () =>
      (await current()).browserWallet('disconnect'),
    'polyagent.reconcile': async () => {
      await (await current()).reconcileAll();
      return { checked: true };
    },
    'polyagent.cancel': async ({ payload }) => {
      await (await current()).cancelOrder(id(payload.id));
      return { checked: true };
    },
    'polyagent.close': async ({ payload }) => {
      const e = await current();
      if (e.busy) throw new Error('请先停止当前扫描');
      await e.closePosition(id(payload.id));
      return { checked: true };
    },
    'polyagent.redeem': async ({ payload }) => {
      await (await current()).redeem(id(payload.id));
      return { checked: true };
    },
    'polyagent.export': async () => JSON.stringify((await current()).snapshot().workspace, null, 2),
    'polyagent.wallet.import': async ({ payload }) => {
      if (credentialBusy || executorControlBusy || executor.status().state === 'running')
        throw new Error('请先停止本机服务并等待凭据操作结束');
      credentialBusy = true;
      try {
        const e = await current();
        if (e.busy || e.workspace?.running) throw new Error('请先停止策略');
        if (e.workspace?.wallet) throw new Error('先删除当前凭据，再导入另一把私钥');
        if (
          e.workspace?.live.walletAddress &&
          (typeof payload.walletAddress !== 'string' ||
            payload.walletAddress.toLowerCase() !== e.workspace.live.walletAddress.toLowerCase())
        )
          throw new Error('该实盘账本已绑定另一钱包，无法替换');
        const epoch = generation;
        let saved = false;
        let value: Awaited<ReturnType<typeof importWallet>> | undefined;
        try {
          value = await importWallet(payload.privateKey, payload.walletAddress);
          if (epoch !== generation) throw new Error('导入期间 Nimi 会话已变更');
          await e.modify((w) => {
            w.wallet = value;
            w.liveLimitsConfirmed = false;
          });
          saved = true;
          return value;
        } finally {
          if (value && !saved) {
            try {
              await removeWallet(value.credentialRef);
            } catch {
              throw new Error(
                `账本未保存且 Keychain 回滚失败，请在钥匙串访问中删除本次凭据：${value.credentialRef}`,
              );
            }
          }
        }
      } finally {
        credentialBusy = false;
      }
    },
    'polyagent.wallet.status': async () => {
      const ref = (await current()).workspace?.wallet?.credentialRef;
      const epoch = generation;
      const status = ref ? await walletStatus(ref) : { available: false, reason: 'not-imported' };
      if (epoch !== generation) throw new Error('Nimi 会话已变化');
      return status;
    },
    'polyagent.wallet.delete': async () => {
      if (credentialBusy || executorControlBusy || executor.status().state === 'running')
        throw new Error('请先停止本机服务并等待凭据操作结束');
      credentialBusy = true;
      try {
        const e = await current();
        if (e.busy || e.workspace?.running) throw new Error('请先停止策略');
        const ref = e.workspace?.wallet?.credentialRef;
        if (!ref) return { removed: false };
        const removed = await removeWallet(ref);
        await e.modify((w) => {
          delete w.wallet;
          w.liveLimitsConfirmed = false;
        });
        return { removed };
      } finally {
        credentialBusy = false;
      }
    },
  };
  async function stopServices(value: PolyEngine | undefined) {
    // A failed ledger write must not prevent the owned executor from stopping.
    const results = await Promise.allSettled([value?.stop(), executor.stop()]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
  return {
    handlers,
    shutdown: () => stopServices(engine),
    stop: async () => {
      if (engine) await engine.stop();
    },
    invalidate: () => {
      generation++;
      void executor.stop().catch(() => undefined);
      engine?.dispose();
      engine = undefined;
      services = undefined;
      void activity?.stop().catch(() => undefined);
      activity = undefined;
    },
    bind: (value: NimiElectronAppBusinessServices) => {
      services = value;
      const epoch = generation;
      activity = value.activity.onOpenRequest(async (request) => {
        if (epoch !== generation || request.objectRef !== 'portfolio') return 'object-unavailable';
        await current();
        show();
        return 'opened';
      });
    },
  };
}
function id(value: unknown): string {
  if (typeof value !== 'string' || value.length > 128 || !value) throw new Error('记录标识无效');
  return value;
}
