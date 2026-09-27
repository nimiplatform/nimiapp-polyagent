import { loadExecutorConfig, type ExecutorConfig } from '../src-executor/config.js';
import { startExecutor } from '../src-executor/main.js';
export type ExecutorStatus = {
  state: 'stopped' | 'starting' | 'running' | 'stopping' | 'error';
  mode: 'observe' | 'live' | null;
  url: string | null;
  message: string;
};
type Service = { stop(): Promise<void> };
/** Host-owned service. Nimi still owns every integration invocation and permission. */
export class ExecutorManager {
  private service?: Service;
  private epoch = 0;
  private tail: Promise<unknown> = Promise.resolve();
  private value: ExecutorStatus = {
    state: 'stopped',
    mode: null,
    url: null,
    message: '本机服务未启动',
  };
  constructor(
    private load = loadExecutorConfig,
    private launch: (config: ExecutorConfig) => Promise<Service> = startExecutor,
  ) {}
  status(): ExecutorStatus {
    return { ...this.value };
  }
  private enqueue<T>(fn: () => Promise<T>) {
    const task = this.tail.then(fn);
    this.tail = task.catch(() => undefined);
    return task;
  }
  start(file: string, mode: 'observe' | 'live', validate: (config: ExecutorConfig) => void) {
    const epoch = this.epoch;
    return this.enqueue(async () => {
      if (epoch !== this.epoch) throw new Error('会话已变化，请重新操作');
      const config = await this.load(file);
      validate(config);
      if (epoch !== this.epoch) throw new Error('会话已变化，请重新操作');
      await this.close();
      if (epoch !== this.epoch) throw new Error('会话已变化，请重新操作');
      validate(config);
      this.value = { state: 'starting', mode: null, url: null, message: '正在启动本机服务' };
      try {
        const service = await this.launch({ ...config, mode });
        if (epoch !== this.epoch) {
          await service.stop();
          throw new Error('SESSION_CHANGED');
        }
        this.service = service;
        this.value = {
          state: 'running',
          mode,
          url: `http://127.0.0.1:${config.port}/mcp`,
          message:
            mode === 'live'
              ? '实盘服务已启用，策略仍需单独启动'
              : '观察服务运行中，只允许认证和读取账户',
        };
        return this.status();
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        this.value = {
          state: 'error',
          mode: null,
          url: null,
          message:
            code === 'EADDRINUSE' || code === 'EEXIST'
              ? '端口或账户目录正被另一执行器占用。请先停止原终端中的执行器，再重试；不要删除交易账本。'
              : '本机服务未能启动。请检查配置和系统钥匙串访问权限，再重试。',
        };
        throw new Error(this.value.message);
      }
    });
  }
  private async close() {
    if (this.service) {
      this.value = {
        ...this.value,
        state: 'stopping',
        message: '停止接收新请求，等待已受理操作结束',
      };
      await this.service.stop();
      this.service = undefined;
    }
    this.value = {
      state: 'stopped',
      mode: null,
      url: null,
      message: '本机服务已停止；交易所已有订单与持仓仍保留',
    };
  }
  stop() {
    this.epoch++;
    return this.enqueue(() => this.close());
  }
}
