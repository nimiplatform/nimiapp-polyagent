import { useEffect, useState, type ReactNode } from 'react';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import { invoke } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Download,
  FlaskConical,
  Layers3,
  Pause,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  Wallet,
  Workflow,
  X,
  AlertCircle,
  Bot,
  Search,
} from 'lucide-react';
import type { EngineSnapshot } from './engine.js';
import { type Policy, type Workspace, type Order } from './model.js';
import { bestAsk, bestBid, entryAssessment } from './strategy.js';
import './styles.css';

type View = 'desk' | 'positions' | 'orders' | 'decisions' | 'settings';
const titles: Record<View, string> = {
  desk: '交易工作台',
  positions: '持仓与资金',
  orders: '订单账本',
  decisions: 'Agent 决策',
  settings: '策略与连接',
};
const statusLabel: Record<string, string> = {
  prepared: '待提交',
  submitting: '正在提交',
  open: '等待成交确认',
  filled: '已成交',
  'partially-filled': '部分成交 · 余量取消',
  canceled: '已取消',
  rejected: '已拒绝',
  unconfirmed: '结果未确认',
};
const usd = (v: number | null | undefined) =>
  v === null || v === undefined
    ? '—'
    : new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(v);
const when = (s: string | null | undefined) =>
  s
    ? new Date(s).toLocaleString('zh-CN', {
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';
function remaining(s: string) {
  const minutes = Math.round((Date.parse(s) - Date.now()) / 60000);
  return minutes < 0
    ? '已到预计结束时间'
    : minutes < 60
      ? `${minutes} 分钟`
      : `${(minutes / 60).toFixed(1)} 小时`;
}
const price = (v: number | null | undefined) =>
  v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}¢`;
async function call<T = unknown>(name: string, payload: Record<string, unknown> = {}): Promise<T> {
  return (await invoke(`polyagent.${name}`, payload)) as T;
}
export function PolyAgentApp() {
  const [snapshot, setSnapshot] = useState<EngineSnapshot | null>(null),
    [view, setView] = useState<View>('desk'),
    [selected, setSelected] = useState<string | null>(null),
    [query, setQuery] = useState(''),
    [error, setError] = useState(''),
    [pending, setPending] = useState(''),
    [detailId, setDetail] = useState<string | null>(null);
  const refresh = async () => {
    const s = await call<EngineSnapshot>('snapshot');
    setSnapshot(s);
  };
  useEffect(() => {
    let alive = true,
      reading = false;
    const tick = async () => {
      if (reading) return;
      reading = true;
      try {
        const s = await call<EngineSnapshot>('snapshot');
        if (alive) setSnapshot(s);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : 'Nimi 连接暂不可用');
      } finally {
        reading = false;
      }
    };
    void tick();
    const timer = setInterval(() => void tick(), 1500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  const run = async (name: string, payload: Record<string, unknown> = {}) => {
    setPending(name);
    setError('');
    try {
      await call(name, payload);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作尚未完成');
    } finally {
      setPending('');
    }
  };
  const exportLedger = async () => {
    try {
      const text = await call<string>('export');
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      const a = document.createElement('a');
      a.href = url;
      a.download = `polyagent-ledger-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(String(e));
    }
  };
  const w = snapshot?.workspace;
  if (!w)
    return (
      <div className="pa-loading">
        <Brand />
        <h1>打开你的交易工作台</h1>
        <p>{error || '正在通过 Nimi 读取本机账本…'}</p>
        {error && (
          <Button
            onClick={() =>
              void refresh()
                .then(() => setError(''))
                .catch((e) => setError(String(e)))
            }
          >
            重新连接
          </Button>
        )}
      </div>
    );
  const s = snapshot!,
    ledger = w[w.mode],
    positions = ledger.positions.filter((p) => !p.settled && p.shares > 0),
    exposure = positions.reduce((sum, p) => sum + p.costUsd, 0);
  const markets = w.markets.filter((m) =>
    `${m.question} ${m.outcome}`.toLowerCase().includes(query.toLowerCase()),
  );
  const detail = ledger.orders.find((o) => o.id === detailId) ?? null;
  const market = markets.find((m) => m.tokenId === selected) ?? markets[0];
  const quote = market ? s.quotes[market.tokenId] : undefined;
  const review = market
    ? w.decisions.find((d) => d.market.tokenId === market.tokenId && d.complete)
    : undefined;
  const busy = Boolean(pending) || s.busy;
  return (
    <div className="pa-app">
      <aside className="pa-sidebar">
        <Brand />
        <div className="pa-nav-caption">个人交易助理</div>
        <nav aria-label="主导航">
          {(
            [
              ['desk', Activity],
              ['positions', Wallet],
              ['orders', Layers3],
              ['decisions', BookOpen],
              ['settings', Settings2],
            ] as const
          ).map(([key, Icon]) => (
            <button key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>
              <Icon size={18} />
              <span>{titles[key]}</span>
              {key === 'positions' && positions.length > 0 && <small>{positions.length}</small>}
            </button>
          ))}
        </nav>
        <div className="pa-sidebar-foot">
          <div className="pa-agent-avatar">
            <Bot size={23} />
          </div>
          <strong>{w.agentName || '尚未任命助理'}</strong>
          <span>{w.agentName ? '由 Nimi 提供 Agent 执行' : '选择一位已有的 Nimi Agent'}</span>
          <button onClick={() => setView('settings')}>
            {w.agentName ? '管理任职' : '任命助理'}
            <ChevronRight size={15} />
          </button>
          <p>POLYAGENT · 实验版</p>
        </div>
      </aside>
      <main className="pa-main">
        <header className="pa-header">
          <div>
            <h1>{titles[view]}</h1>
            <p>
              {view === 'desk'
                ? '把市场变化，变成有边界的行动。'
                : view === 'positions'
                  ? '每笔资金都有去向，每个结果都能核对。'
                  : view === 'orders'
                    ? '提交、成交与结算，分别留下记录。'
                    : view === 'decisions'
                      ? '保留助理当时看到的事实与决定。'
                      : '先确定边界，再让助理开始工作。'}
            </p>
          </div>
          <div className="pa-header-actions">
            <span className={`pa-mode ${w.mode}`}>
              <FlaskConical size={15} />
              {w.mode === 'paper'
                ? '模拟交易'
                : s.executor?.mode === 'observe'
                  ? '真实账户 · 观察模式'
                  : w.signingMethod === 'wallet'
                    ? '钱包确认交易'
                    : '私钥自动交易'}
            </span>
            <button
              className="pa-icon"
              onClick={() => void exportLedger()}
              title="导出账本"
              aria-label="导出账本"
            >
              <Download size={18} />
            </button>
          </div>
        </header>
        <div className={`pa-mode-notice ${w.mode}`}>
          {w.mode === 'paper' ? (
            <>
              <FlaskConical size={16} />
              <span>真实行情 · 虚拟资金。成交按读取到的盘口模拟，不会发送真实订单。</span>
            </>
          ) : (
            <>
              <AlertCircle size={16} />
              <span>
                {s.executor?.mode === 'observe'
                  ? '当前只读取真实账户，不允许买卖。可在策略与连接中由你启用实盘服务。'
                  : '实盘由所选 Nimi Integration 交易连接执行，服务启用、交易权限和策略启动分别生效。'}
              </span>
            </>
          )}
        </div>
        {(error || s.error) && (
          <div className="pa-error" role="alert">
            <AlertCircle size={18} />
            <span>{error || s.error}</span>
            <button
              aria-label="关闭错误提示"
              onClick={() => {
                setError('');
                void call('dismiss-error')
                  .then(refresh)
                  .catch(() => undefined);
              }}
            >
              <X size={15} />
            </button>
          </div>
        )}
        <section className="pa-mandate" aria-label="当前策略">
          <div className={`pa-run-light ${w.running ? 'on' : ''}`} />
          <div className="pa-mandate-name">
            <strong>近到期 · 高价格区间</strong>
            <span>
              {w.running ? '策略运行中' : s.busy ? '本轮处理中' : '策略已停止'} · {s.stage}
            </span>
          </div>
          <dl>
            <div>
              <dt>入场价</dt>
              <dd>
                {price(w.policy.minPrice)}–{price(w.policy.maxPrice)}
              </dd>
            </div>
            <div>
              <dt>单笔上限</dt>
              <dd>{usd(w.policy.orderUsd)}</dd>
            </div>
            <div>
              <dt>已用 / 总敞口</dt>
              <dd>
                {usd(exposure)} / {usd(w.policy.maxExposureUsd)}
              </dd>
            </div>
          </dl>
          <div className="pa-mandate-actions">
            <Button disabled={busy} onClick={() => void run('scan')}>
              <RefreshCw size={15} className={s.busy ? 'pa-spin' : ''} />
              扫描市场
            </Button>
            {w.running || s.busy ? (
              <Button
                className="pa-stop"
                disabled={pending === 'stop'}
                onClick={() => void run('stop')}
              >
                <Pause size={15} />
                停止
              </Button>
            ) : (
              <Button className="pa-primary" disabled={busy} onClick={() => void run('start')}>
                <Play size={15} />
                启动策略
              </Button>
            )}
          </div>
        </section>
        {view === 'desk' && (
          <div className="pa-desk">
            <section className="pa-market-pane">
              <div className="pa-section-head">
                <div>
                  <h2>
                    候选市场 <span>{markets.length}</span>
                  </h2>
                  <p>
                    预计结束时间 {w.policy.minMinutes} 分钟–{w.policy.maxHours} 小时 · 更新{' '}
                    {when(w.lastScanAt)}
                  </p>
                </div>
                <label className="pa-search">
                  <Search size={16} />
                  <input
                    aria-label="搜索候选市场"
                    placeholder="搜索事件"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
              </div>
              {markets.length ? (
                <div className="pa-table-wrap">
                  <table className="pa-market-table">
                    <thead>
                      <tr>
                        <th>事件 / 结果</th>
                        <th>买入报价</th>
                        <th>结束倒计时</th>
                        <th>检查</th>
                      </tr>
                    </thead>
                    <tbody>
                      {markets.map((m) => {
                        const q = s.quotes[m.tokenId];
                        const assessment = q ? entryAssessment(m, q, w.policy, ledger) : null;
                        return (
                          <tr
                            key={m.tokenId}
                            className={market?.tokenId === m.tokenId ? 'selected' : ''}
                          >
                            <td>
                              <button
                                className="pa-market-name"
                                onClick={() => setSelected(m.tokenId)}
                              >
                                <strong>{m.question}</strong>
                                <span>
                                  {m.outcome} · 流动性 {usd(m.liquidity)}
                                </span>
                              </button>
                            </td>
                            <td className="pa-price">
                              {price(q ? bestAsk(q) : m.indicativePrice)}
                              <small>{q ? '卖一价' : '市场参考价'}</small>
                            </td>
                            <td>
                              <Clock3 size={13} /> {remaining(m.endAt)}
                            </td>
                            <td>
                              <span className={`pa-status ${assessment?.eligible ? 'good' : ''}`}>
                                {!q ? '待读盘口' : assessment?.eligible ? '可评估' : '未通过'}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  icon={<Search size={28} />}
                  title={w.lastScanAt ? '当前没有符合区间的市场' : '从一次真实行情扫描开始'}
                  text={
                    w.lastScanAt
                      ? '可以调整价格与到期窗口。系统不会为凑足候选而放宽你的策略。'
                      : '扫描会读取 Polymarket 的市场、结束时间和流动性。先查看候选，再启动自动策略。'
                  }
                  action={
                    <Button disabled={busy} onClick={() => void run('scan')}>
                      扫描市场
                    </Button>
                  }
                />
              )}
            </section>
            <aside className="pa-detail-pane">
              {market ? (
                <>
                  <div className="pa-detail-title">
                    <h2>{market.question}</h2>
                    <span className="pa-outcome">{market.outcome}</span>
                  </div>
                  <dl className="pa-detail-facts">
                    <div>
                      <dt>预计结束</dt>
                      <dd>{when(market.endAt)}</dd>
                    </div>
                    <div>
                      <dt>近 24h 成交</dt>
                      <dd>{usd(market.volume)}</dd>
                    </div>
                    <div>
                      <dt>盘口读取</dt>
                      <dd>{when(quote?.observedAt)}</dd>
                    </div>
                  </dl>
                  {quote && (
                    <>
                      <div className="pa-book">
                        <div>
                          <span>卖盘</span>
                          <b>{price(bestAsk(quote))}</b>
                          {quote.asks.slice(0, 3).map((l, i) => (
                            <p key={i}>
                              <span>{price(l.price)}</span>
                              <span>{l.size.toFixed(1)} 份</span>
                            </p>
                          ))}
                        </div>
                        <div>
                          <span>买盘</span>
                          <b>{price(bestBid(quote))}</b>
                          {quote.bids.slice(0, 3).map((l, i) => (
                            <p key={i}>
                              <span>{price(l.price)}</span>
                              <span>{l.size.toFixed(1)} 份</span>
                            </p>
                          ))}
                        </div>
                      </div>
                      {entryAssessment(market, quote, w.policy, ledger).reasons.length > 0 && (
                        <ul className="pa-reasons">
                          {entryAssessment(market, quote, w.policy, ledger).reasons.map((r) => (
                            <li key={r}>{r}</li>
                          ))}
                        </ul>
                      )}
                    </>
                  )}
                  <div className="pa-review">
                    <Bot size={19} />
                    <strong>{review ? `${review.agentName} 的判断` : '等待助理评估'}</strong>
                    <p>
                      {review?.reason ??
                        '启动策略后，助理会评估通过规则检查的候选。资料不足时会继续观察。'}
                    </p>
                  </div>
                  <details className="pa-rules">
                    <summary>查看结算规则</summary>
                    <p>{market.description || '未提供规则描述'}</p>
                    <p>来源：{market.resolutionSource || '以市场规则指定来源为准'}</p>
                  </details>
                </>
              ) : (
                <Empty
                  icon={<ShieldCheck size={30} />}
                  title={query ? '没有匹配的市场' : '先看清楚，再行动'}
                  text={
                    query
                      ? '调整搜索词或清空搜索后，再选择市场查看详情。'
                      : '选择市场后，这里会并列呈现报价、策略检查和 Agent 判断。'
                  }
                />
              )}
            </aside>
          </div>
        )}
        {view === 'positions' && (
          <>
            <div className="pa-balance-strip">
              <div>
                <span>{w.mode === 'paper' ? '模拟可用资金' : '最近核对的账户资金'}</span>
                <strong>{usd(w.mode === 'live' ? s.account?.cashUsd : ledger.cashUsd)}</strong>
              </div>
              <div>
                <span>持仓成本</span>
                <strong>{usd(exposure)}</strong>
              </div>
              <div>
                <span>{w.mode === 'paper' ? '模拟已实现盈亏' : '已实现盈亏估算'}</span>
                <strong className={ledger.realizedPnlUsd < 0 ? 'negative' : 'positive'}>
                  {usd(ledger.realizedPnlUsd)}
                </strong>
              </div>
            </div>
            <section className="pa-surface">
              <div className="pa-section-head">
                <h2>当前持仓</h2>
                <Button disabled={busy} onClick={() => void run('scan')}>
                  刷新与核对
                </Button>
              </div>
              {positions.length ? (
                <div className="pa-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>市场 / 结果</th>
                        <th>份额</th>
                        <th>成本</th>
                        <th>最新买价</th>
                        <th>操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {positions.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <strong>{p.market.question}</strong>
                            <small>{p.market.outcome}</small>
                          </td>
                          <td>{p.shares.toFixed(4)}</td>
                          <td>{usd(p.costUsd)}</td>
                          <td>{p.payout !== null ? `结算 $${p.payout}` : price(p.lastBid)}</td>
                          <td>
                            {p.payout !== null && w.mode === 'live' ? (
                              <Button
                                disabled={busy}
                                onClick={() => void run('redeem', { id: p.id })}
                              >
                                赎回
                              </Button>
                            ) : (
                              <Button
                                disabled={busy}
                                onClick={() => void run('close', { id: p.id })}
                              >
                                <ArrowUpRight size={15} />
                                平仓
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty
                  icon={<Wallet size={28} />}
                  title="当前没有持仓"
                  text="只有确认的成交才会增加持仓。策略评估和提交成功都不会被当作成交。"
                />
              )}
            </section>
          </>
        )}
        {view === 'orders' && (
          <section className="pa-surface">
            <div className="pa-section-head">
              <div>
                <h2>订单与成交</h2>
                <p>
                  {w.mode === 'paper'
                    ? '模拟订单使用读取到的盘口深度，未成交余量自动取消。'
                    : '只计入交易所已确认成交，结果不明时停止新入场。'}
                </p>
              </div>
              {w.mode === 'live' &&
                (w.connectionRef ? (
                  <Button disabled={busy} onClick={() => void run('reconcile')}>
                    核对实盘订单
                  </Button>
                ) : (
                  <Button onClick={() => setView('settings')}>先选择交易连接</Button>
                ))}
            </div>
            {ledger.orders.length ? (
              <div className="pa-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>时间 / 事件</th>
                      <th>方向</th>
                      <th>成交份额</th>
                      <th>成交额 / 费用估算</th>
                      <th>状态</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.orders.map((o) => (
                      <tr key={o.id}>
                        <td>
                          <button className="pa-market-name" onClick={() => setDetail(o.id)}>
                            <strong>{o.market.question}</strong>
                            <span>
                              {when(o.createdAt)} · {o.market.outcome}
                            </span>
                          </button>
                        </td>
                        <td>
                          <span className={o.side === 'buy' ? 'positive' : 'negative'}>
                            {o.side === 'buy' ? '买入' : '卖出'}
                          </span>
                        </td>
                        <td>{o.filledShares.toFixed(4)}</td>
                        <td>
                          {usd(o.notionalUsd)}
                          <small>{usd(o.feeUsd)}</small>
                        </td>
                        <td>
                          <span
                            className={`pa-status ${o.status === 'unconfirmed' ? 'warning' : ''}`}
                          >
                            {statusLabel[o.status]}
                          </span>
                          {o.mode === 'live' && ['open', 'unconfirmed'].includes(o.status) && (
                            <button
                              className="pa-text-button"
                              disabled={busy}
                              onClick={() => void run('cancel', { id: o.id })}
                            >
                              撤销余量
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty
                icon={<Layers3 size={28} />}
                title="订单账本还是空的"
                text="每笔委托会先保存，再提交。你可以随时导出完整账本。"
              />
            )}
          </section>
        )}
        {view === 'decisions' && (
          <div className="pa-decisions">
            <section className="pa-surface">
              <div className="pa-section-head">
                <h2>研究与决定</h2>
                <span>{w.decisions.length} 条</span>
              </div>
              {w.decisions.length ? (
                w.decisions.map((d) => (
                  <article className="pa-decision" key={d.id}>
                    <div className="pa-decision-top">
                      <span
                        className={`pa-status ${d.action === 'buy' && d.complete ? 'good' : ''}`}
                      >
                        {!d.complete
                          ? '评估未完成'
                          : d.action === 'buy'
                            ? '建议入场'
                            : d.action === 'hold'
                              ? '继续观察'
                              : '跳过'}
                      </span>
                      <span>
                        {d.agentName} · {when(d.at)}
                      </span>
                    </div>
                    <h3>
                      {d.market.question} <small>{d.market.outcome}</small>
                    </h3>
                    <p>{d.reason}</p>
                    <details>
                      <summary>查看当时的策略与盘口</summary>
                      <dl className="pa-detail-facts">
                        <div>
                          <dt>单笔上限</dt>
                          <dd>{usd(d.policy.orderUsd)}</dd>
                        </div>
                        <div>
                          <dt>买入报价</dt>
                          <dd>{price(bestAsk(d.quote))}</dd>
                        </div>
                        <div>
                          <dt>数据读取</dt>
                          <dd>{when(d.quote.observedAt)}</dd>
                        </div>
                      </dl>
                    </details>
                  </article>
                ))
              ) : (
                <Empty
                  icon={<Bot size={28} />}
                  title="让助理留下真实判断"
                  text="先任命 Agent 并启动策略。通过价格、流动性和资金检查的候选会进入 Agent 评估。"
                  action={<Button onClick={() => setView('settings')}>任命助理</Button>}
                />
              )}
            </section>
            <section className="pa-surface pa-events">
              <div className="pa-section-head">
                <h2>运行记录</h2>
              </div>
              {w.events.map((e) => (
                <article key={e.id} className={e.kind === 'error' ? 'error' : ''}>
                  <time>{when(e.at)}</time>
                  <p>{e.text}</p>
                </article>
              ))}
            </section>
          </div>
        )}
        {view === 'settings' && (
          <Settings
            key={`${w.mode}:${w.agentBinding}`}
            workspace={w}
            snapshot={s}
            busy={busy}
            run={run}
          />
        )}
        <footer className="pa-footer">
          <span>
            <ShieldCheck size={13} />
            Nimi 受管会话
          </span>
          <span>高价格不等于确定结果 · 策略以实际报价和资金上限约束执行</span>
        </footer>
      </main>
      {detail && (
        <OverlayShell
          open
          kind="drawer"
          size="md"
          title="订单详情"
          description="核对这笔委托的实际状态与标识。"
          onClose={() => setDetail(null)}
          panelClassName="pa-order-detail"
        >
          <h3>{detail.market.question}</h3>
          <p>{detail.reason}</p>
          <dl className="pa-detail-facts">
            <div>
              <dt>模式</dt>
              <dd>{detail.mode === 'paper' ? '模拟' : '实盘'}</dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>{statusLabel[detail.status]}</dd>
            </div>
            <div>
              <dt>提交标识</dt>
              <dd>{detail.submissionId}</dd>
            </div>
            <div>
              <dt>交易所订单</dt>
              <dd>{detail.exchangeOrderId || '—'}</dd>
            </div>
            <div>
              <dt>成交份额</dt>
              <dd>{detail.filledShares}</dd>
            </div>
            <div>
              <dt>限价</dt>
              <dd>{price(detail.limitPrice)}</dd>
            </div>
            <div>
              <dt>手续费估算</dt>
              <dd>{usd(detail.feeUsd)}</dd>
            </div>
          </dl>
        </OverlayShell>
      )}
    </div>
  );
}
function Brand() {
  return (
    <div className="pa-brand">
      <span className="pa-brand-mark">
        <Workflow size={24} />
      </span>
      <span>
        polyagent<span className="pa-brand-dot">.</span>
      </span>
    </div>
  );
}
function Empty({
  icon,
  title,
  text,
  action,
}: {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="pa-empty">
      <div>{icon}</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {action}
    </div>
  );
}
function Settings({
  workspace: w,
  snapshot: s,
  busy,
  run,
}: {
  workspace: Workspace;
  snapshot: EngineSnapshot;
  busy: boolean;
  run: (name: string, payload?: Record<string, unknown>) => Promise<void>;
}) {
  const [privateKey, setPrivateKey] = useState(''),
    [walletAddress, setWalletAddress] = useState(''),
    [walletNotice, setWalletNotice] = useState(''),
    [walletBusy, setWalletBusy] = useState(false),
    [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const importKey = async () => {
    setWalletBusy(true);
    setWalletNotice('');
    const key = privateKey;
    setPrivateKey('');
    try {
      await call('wallet.import', { privateKey: key, walletAddress });
      setWalletNotice('私钥已存入 macOS Keychain。普通配置仅保存地址和凭据引用。');
    } catch (e) {
      setWalletNotice(e instanceof Error ? e.message : 'Keychain 导入失败');
    } finally {
      setWalletBusy(false);
    }
  };
  const checkKey = async () => {
    setWalletBusy(true);
    try {
      const status = await call<{ available: boolean; reason: string }>('wallet.status');
      setWalletNotice(
        status.available
          ? 'Keychain 凭据当前可访问；签名时仍会重新读取。'
          : `Keychain 凭据不可用：${status.reason}`,
      );
    } catch (e) {
      setWalletNotice(e instanceof Error ? e.message : '无法读取 Keychain 状态');
    } finally {
      setWalletBusy(false);
    }
  };
  const deleteKey = async () => {
    setWalletBusy(true);
    try {
      await call('wallet.delete');
      setWalletNotice('本机签名凭据已删除。已有交易所订单和持仓未被撤销。');
      setDeleteConfirmed(false);
    } catch (e) {
      setWalletNotice(e instanceof Error ? e.message : '删除失败');
    } finally {
      setWalletBusy(false);
    }
  };
  const [policy, setPolicy] = useState({ ...w.policy }),
    [mode, setMode] = useState(w.mode),
    [signingMethod, setSigningMethod] = useState(w.signingMethod ?? 'keychain'),
    [agent, setAgent] = useState(w.agentBinding ?? ''),
    [connection, setConnection] = useState(w.connectionRef ?? ''),
    [confirmed, setConfirmed] = useState(false),
    [notify, setNotify] = useState(w.notifyHome);
  const field = (key: keyof Policy, label: string, unit: string, step: number) => (
    <label className="pa-field" key={key}>
      <span>{label}</span>
      <div>
        <input
          aria-label={label}
          type="number"
          step={step}
          value={policy[key]}
          onChange={(e) => setPolicy({ ...policy, [key]: Number(e.target.value) })}
        />
        <span>{unit}</span>
      </div>
    </label>
  );
  return (
    <form
      className="pa-settings"
      onSubmit={(e) => {
        e.preventDefault();
        void run('configure', {
          input: {
            mode,
            signingMethod,
            agentBinding: agent || null,
            connectionRef: connection || null,
            policy,
            liveLimitsConfirmed: mode === 'live' && confirmed,
            notifyHome: notify,
          },
        });
      }}
    >
      <section className="pa-surface">
        <div className="pa-section-head">
          <div>
            <h2>任命与运行方式</h2>
            <p>Agent 负责评估，策略规则负责资金和交易边界。</p>
          </div>
          <Button type="button" disabled={busy} onClick={() => void run('services')}>
            <RefreshCw size={15} />
            刷新
          </Button>
        </div>
        <div className="pa-form-body">
          <label className="pa-field">
            <span>Nimi Agent</span>
            <select value={agent} onChange={(e) => setAgent(e.target.value)}>
              <option value="">选择一位助理</option>
              {s.agents.map((a) => (
                <option key={a.agentBinding} value={a.agentBinding}>
                  {a.displayName}
                </option>
              ))}
            </select>
          </label>
          {s.agentError && <p className="pa-form-error">{s.agentError}</p>}
          <div className="pa-mode-picker">
            <label>
              <input
                type="radio"
                name="mode"
                checked={mode === 'paper'}
                onChange={() => setMode('paper')}
              />
              <span>
                <b>模拟交易</b>
                <small>真实行情、虚拟资金，无需连接钱包</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                checked={mode === 'live' && signingMethod === 'keychain'}
                onChange={() => {
                  setMode('live');
                  setSigningMethod('keychain');
                  setConfirmed(false);
                }}
              />
              <span>
                <b>导入私钥</b>
                <small>私钥保存在 Keychain，按确认的额度自动交易</small>
              </span>
            </label>
            <label>
              <input
                type="radio"
                name="mode"
                checked={mode === 'live' && signingMethod === 'wallet'}
                onChange={() => {
                  setMode('live');
                  setSigningMethod('wallet');
                  setConfirmed(false);
                }}
              />
              <span>
                <b>连接钱包</b>
                <small>私钥留在钱包中，每次签名由你确认</small>
              </span>
            </label>
          </div>
          <label className="pa-check">
            <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
            将订单变化发送到 Nimi Home
          </label>
        </div>
      </section>
      <section className="pa-surface">
        <div className="pa-section-head">
          <div>
            <h2>策略规则</h2>
            <p>市场价格只用于筛选，不能保证胜率。新设置在下次启动时生效。</p>
          </div>
        </div>
        <div className="pa-field-grid">
          {field('minPrice', '最低入场价', '美元 / 份', 0.005)}
          {field('maxPrice', '最高入场价', '美元 / 份', 0.005)}
          {field('minMinutes', '最短结束间隔', '分钟', 1)}
          {field('maxHours', '最长结束间隔', '小时', 1)}
          {field('minLiquidityUsd', '最低流动性', '美元', 100)}
          {field('maxSpread', '最大买卖价差', '美元', 0.001)}
          {field('minPayoutMarginBps', '扣费后最小兑付价差', '基点', 5)}
          {field('slippageBps', '限价容许偏移', '基点', 5)}
        </div>
      </section>
      <section className="pa-surface">
        <div className="pa-section-head">
          <h2>资金与退出</h2>
        </div>
        <div className="pa-field-grid">
          {field('orderUsd', '单笔资金上限', '美元', 0.01)}
          {field('maxEventExposureUsd', '单事件敞口上限', '美元', 1)}
          {field('maxExposureUsd', '总敞口上限', '美元', 1)}
          {field('maxLossUsd', '最大账面亏损', '美元', 0.01)}
          {field('takeProfitPrice', '止盈价', '美元 / 份', 0.001)}
          {field('stopLossFraction', '相对成本止损比例', '比例', 0.01)}
          {field('scanIntervalSeconds', '扫描间隔', '秒', 10)}
          {field('maxCandidatesPerScan', '每轮最多评估', '个市场', 1)}
        </div>
      </section>
      {mode === 'live' && (
        <section className="pa-surface">
          <div className="pa-section-head">
            <div>
              <h2>{signingMethod === 'keychain' ? '私钥与交易连接' : '钱包与交易连接'}</h2>
              <p>
                选择对应签名方式的 Nimi
                交易连接。先保存连接，再核对账户；确认资金上限后才能启动实盘。
              </p>
            </div>
          </div>
          <div className="pa-form-body">
            {signingMethod === 'keychain' && (
              <div className="pa-wallet-import">
                <h3>macOS Keychain 钱包</h3>
                {w.wallet ? (
                  <>
                    <dl className="pa-detail-facts">
                      <div>
                        <dt>账户钱包</dt>
                        <dd>{w.wallet.walletAddress}</dd>
                      </div>
                      <div>
                        <dt>签名地址</dt>
                        <dd>{w.wallet.signerAddress}</dd>
                      </div>
                      <div>
                        <dt>凭据引用</dt>
                        <dd>
                          <code>{w.wallet.credentialRef}</code>
                        </dd>
                      </div>
                    </dl>
                    <Button type="button" disabled={walletBusy} onClick={() => void checkKey()}>
                      检查 Keychain 状态
                    </Button>
                    <label className="pa-check">
                      <input
                        type="checkbox"
                        checked={deleteConfirmed}
                        onChange={(e) => setDeleteConfirmed(e.target.checked)}
                      />
                      删除凭据后，本机执行器将无法签名；已有订单不会撤销。
                    </label>
                    <Button
                      type="button"
                      tone="danger"
                      disabled={!deleteConfirmed || walletBusy || busy || w.running}
                      onClick={() => void deleteKey()}
                    >
                      删除本机签名凭据
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="pa-muted">
                      一次性导入后清空输入。秘密保存在系统
                      Keychain，不写入普通文件、环境配置、模型上下文或账本。自动交易在钥匙串可访问时按需签名，不要求每笔
                      Touch ID。
                    </p>
                    <label className="pa-field">
                      <span>Polymarket 账户钱包地址</span>
                      <input
                        aria-label="Polymarket 账户钱包地址"
                        autoComplete="off"
                        placeholder="0x…（账户钱包可能与签名地址不同）"
                        value={walletAddress}
                        onChange={(e) => setWalletAddress(e.target.value)}
                      />
                    </label>
                    <label className="pa-field">
                      <span>签名私钥（仅本次导入）</span>
                      <input
                        aria-label="签名私钥（仅本次导入）"
                        type="password"
                        autoComplete="new-password"
                        spellCheck={false}
                        value={privateKey}
                        onChange={(e) => setPrivateKey(e.target.value)}
                        placeholder="0x…"
                      />
                    </label>
                    <Button
                      type="button"
                      disabled={walletBusy || busy || w.running || !privateKey || !walletAddress}
                      onClick={() => void importKey()}
                    >
                      导入到 Keychain
                    </Button>
                  </>
                )}
                {walletNotice && (
                  <p className="pa-wallet-notice" role="status">
                    {walletNotice}
                  </p>
                )}
              </div>
            )}
            {signingMethod === 'wallet' && (
              <WalletConnection
                enabled={Boolean(w.connectionRef && w.signingMethod === 'wallet')}
                busy={busy}
                running={w.running}
              />
            )}
            <ExecutorSetup
              workspace={w}
              busy={busy}
              status={s.executor}
              onLoaded={(info) => {
                setSigningMethod(info.signingMethod);
                setConfirmed(false);
                setPolicy((current) => ({
                  ...current,
                  orderUsd: Math.min(current.orderUsd, info.limits.maxOrderUsd),
                  maxExposureUsd: Math.min(current.maxExposureUsd, info.limits.maxExposureUsd),
                  maxEventExposureUsd: Math.min(
                    current.maxEventExposureUsd,
                    info.limits.maxExposureUsd,
                  ),
                  maxLossUsd: Math.min(current.maxLossUsd, info.limits.maxBuyBudgetUsd),
                }));
              }}
            />
            <label className="pa-field">
              <span>Nimi Integration 连接</span>
              <select
                value={connection}
                onChange={(e) => {
                  setConnection(e.target.value);
                  setConfirmed(false);
                }}
              >
                <option value="">尚未选择</option>
                {s.connections.map((t) => (
                  <option key={t.targetRef} value={t.targetRef}>
                    {t.displayName} · {t.accountLabel || '交易执行器'}
                  </option>
                ))}
              </select>
            </label>
            {s.connectionError && <p className="pa-form-error">{s.connectionError}</p>}
            <p className="pa-muted">
              {s.connections.length
                ? '保存所选连接后，可以读取账户的真实就绪状态。'
                : '尚未发现符合交易协议的已连接执行器。模拟交易可以继续使用。'}
            </p>
            <Button
              type="button"
              disabled={busy || !w.connectionRef}
              onClick={() => void run('account')}
            >
              核对已保存连接的账户
            </Button>
            {s.account && (
              <div className="pa-account-result">
                <strong>
                  {s.account.access === 'observe'
                    ? '真实账户已核对 · 观察模式'
                    : s.account.ready
                      ? '账户已就绪'
                      : '账户尚未就绪'}
                </strong>
                <p>{s.account.message}</p>
                <p>
                  可用 {usd(s.account.cashUsd)} · 执行器单笔上限 {usd(s.account.maxOrderUsd)}
                </p>
                <p>
                  剩余买入次数 {s.account.buyOrdersRemaining} · 累计买入预算剩余{' '}
                  {usd(s.account.remainingBuyBudgetUsd)}
                </p>
                <code>{s.account.wallet || '未配置钱包'}</code>
              </div>
            )}
            {mode === 'live' && (
              <label className="pa-check pa-live-confirm">
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                我确认以上实盘资金上限。保存不会启动交易，仍需明确点击“启动策略”。
              </label>
            )}
          </div>
        </section>
      )}
      <div className="pa-settings-save">
        <span>
          {w.running ? '策略运行中，请先停止再保存' : '设置保存在当前 Nimi 账户的本机 App 空间'}
        </span>
        <Button className="pa-primary" type="submit" disabled={busy || w.running}>
          <Check size={16} />
          保存设置
        </Button>
      </div>
    </form>
  );
}

function WalletConnection({
  enabled,
  busy,
  running,
}: {
  enabled: boolean;
  busy: boolean;
  running: boolean;
}) {
  const [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false);
  const [status, setStatus] = useState<{
    connected: boolean;
    signerAddress: string | null;
    pending: { method: string; expiresAt: string } | null;
  } | null>(null);
  const action = async (operation: 'open' | 'status' | 'disconnect') => {
    setPending(true);
    setNotice('');
    try {
      const result = await call('browser-wallet.' + operation);
      if (operation === 'open') {
        setStatus(null);
        setNotice('已打开本机钱包窗口。连接完成后，点击“检查钱包连接”，再核对账户。');
      } else {
        setStatus(result as typeof status);
        if (operation === 'disconnect') setNotice('钱包已断开，策略已停止。已有订单仍需核对。');
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : '钱包连接未完成');
    } finally {
      setPending(false);
    }
  };
  return (
    <div className="pa-wallet-import">
      <h3>浏览器钱包签名</h3>
      <p className="pa-muted">
        在默认浏览器中连接 MetaMask、Rabby
        等标准钱包。保持签名窗口打开，并逐次确认认证、订单和链上操作。拒签、断开或切换账户后不会改用已导入的私钥。
      </p>
      {!enabled && (
        <p className="pa-muted">请先选择交易连接并保存设置。执行器需选择钱包签名方式。</p>
      )}
      <div className="pa-wallet-actions">
        <Button
          type="button"
          disabled={!enabled || busy || pending || running}
          onClick={() => void action('open')}
        >
          连接浏览器钱包
        </Button>
        <Button type="button" disabled={!enabled || pending} onClick={() => void action('status')}>
          检查钱包连接
        </Button>
        <Button
          type="button"
          disabled={!enabled || pending}
          onClick={() => void action('disconnect')}
        >
          断开并停止策略
        </Button>
      </div>
      {status && (
        <p role="status">
          {status.connected ? '已连接：' + status.signerAddress : '钱包未连接'}
          {status.pending ? ' · 正在等待钱包确认' : ''}
        </p>
      )}
      {notice && (
        <p className="pa-wallet-notice" role="status">
          {notice}
        </p>
      )}
    </div>
  );
}

type ExecutorInfo = {
  url: string;
  mode: string;
  signingMethod: 'keychain' | 'wallet';
  limits: {
    maxOrderUsd: number;
    maxExposureUsd: number;
    maxBuyOrders: number;
    maxBuyBudgetUsd: number;
  };
};
function ExecutorSetup({
  workspace: w,
  busy,
  status,
  onLoaded,
}: {
  workspace: Workspace;
  busy: boolean;
  status: EngineSnapshot['executor'];
  onLoaded: (info: ExecutorInfo) => void;
}) {
  const [file, setFile] = useState(w.executorConfigPath ?? ''),
    [notice, setNotice] = useState(''),
    [pending, setPending] = useState(false);
  const [info, setInfo] = useState<ExecutorInfo | null>(null);
  const [confirmLive, setConfirmLive] = useState(false);
  const serviceBusy = pending || status?.state === 'starting' || status?.state === 'stopping';
  const control = async (mode: 'observe' | 'live' | 'stop') => {
    setPending(true);
    setNotice('');
    try {
      if (mode === 'stop') await call('executor.stop');
      else await call('executor.start', { mode, confirmLive: mode === 'live' });
      setConfirmLive(false);
      setNotice(
        mode === 'stop'
          ? '本机服务已停止。已有交易所订单和持仓未撤销。'
          : mode === 'observe'
            ? '观察服务已启动，可以核对账户。'
            : '实盘服务已启用。核对账户后，由你单独启动策略。',
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '服务操作未完成');
    } finally {
      setPending(false);
    }
  };
  const load = async () => {
    setPending(true);
    try {
      const value = await call<NonNullable<typeof info>>('executor.load', { path: file });
      setInfo(value);
      onLoaded(value);
      setNotice(
        '配置已读取。请在 Nimi 的 Integration 管理中添加下方 MCP 地址，粘贴连接凭据并允许所需操作。',
      );
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '无法读取配置');
    } finally {
      setPending(false);
    }
  };
  const copy = async () => {
    try {
      await call('executor.copy-token');
      setNotice('连接凭据已复制，请粘贴到 Nimi。剪贴板中的该凭据会在一分钟后清除。');
    } catch (e) {
      setNotice(e instanceof Error ? e.message : '复制失败');
    }
  };
  return (
    <div className="pa-wallet-import">
      <h3>本机交易服务</h3>
      <div className="pa-account-result" aria-live="polite">
        <strong>
          {status?.state === 'running'
            ? status.mode === 'live'
              ? '实盘服务运行中'
              : '观察服务运行中'
            : status?.state === 'starting'
              ? '正在启动'
              : status?.state === 'stopping'
                ? '正在停止'
                : status?.state === 'error'
                  ? '服务启动失败'
                  : '服务未启动'}
        </strong>
        <p>{status?.message || '在这里启动观察服务，无需运行终端命令。'}</p>
        <p>
          服务随 App 退出而停止；重新打开后不会自动恢复实盘。停止服务不会撤销交易所的订单或持仓。
        </p>
        {status?.url && <code>{status.url}</code>}
      </div>
      <div className="pa-wallet-actions">
        <Button
          type="button"
          disabled={
            serviceBusy ||
            busy ||
            w.running ||
            !w.executorConfigPath ||
            (status?.state === 'running' && status.mode === 'observe')
          }
          onClick={() => void control('observe')}
        >
          {status?.mode === 'live' ? '退回观察模式' : '启动观察服务'}
        </Button>
        <Button
          type="button"
          disabled={
            serviceBusy || busy || w.running || !w.executorConfigPath || status?.mode === 'live'
          }
          onClick={() => {
            setNotice('');
            setConfirmLive(true);
          }}
        >
          启用实盘服务…
        </Button>
        <Button
          type="button"
          disabled={serviceBusy || status?.state !== 'running'}
          onClick={() => void control('stop')}
        >
          停止本机服务
        </Button>
      </div>
      <p className="pa-muted">
        先保存签名方式和资金上限，再启用实盘服务。Nimi 的交易权限、账户就绪和启动策略仍需分别完成。
      </p>
      {confirmLive && (
        <OverlayShell
          open
          kind="dialog"
          size="md"
          title="启用实盘服务"
          description="这将允许执行器签署并提交真实订单。启动策略是下一项独立操作。"
          onClose={() => {
            if (!pending) setConfirmLive(false);
          }}
        >
          <p>账户：{w.wallet?.walletAddress || '已配置的钱包账户'}</p>
          <p>
            已保存策略上限：单笔 {usd(w.policy.orderUsd)} · 总敞口 {usd(w.policy.maxExposureUsd)}
            。执行器另行约束累计预算和次数。
          </p>
          <p>
            请先保存设置并勾选资金确认。启用前会检查 Nimi
            权限、钱包绑定和执行器额度；未满足时不会启用。
          </p>
          {notice && <p role="alert">{notice}</p>}
          <div className="pa-wallet-actions">
            <Button type="button" disabled={pending} onClick={() => setConfirmLive(false)}>
              取消
            </Button>
            <Button
              type="button"
              disabled={pending || !w.liveLimitsConfirmed || w.mode !== 'live'}
              onClick={() => void control('live')}
            >
              确认启用实盘服务
            </Button>
          </div>
        </OverlayShell>
      )}
      <details>
        <summary>执行器配置与 Nimi 连接</summary>
        <p className="pa-muted">
          使用准备命令生成的 JSON 配置。这里读取地址、额度和凭据引用；交易仍通过 Nimi Integration
          执行。
        </p>
        <label className="pa-field">
          <span>执行器配置文件</span>
          <input
            value={file}
            onChange={(e) => setFile(e.target.value)}
            placeholder="/完整路径/executor.json"
            spellCheck={false}
          />
        </label>
        <div className="pa-wallet-actions">
          <Button
            type="button"
            disabled={busy || serviceBusy || status?.state === 'running' || w.running || !file}
            onClick={() => void load()}
          >
            读取执行器配置
          </Button>
          <Button
            type="button"
            disabled={!w.executorConfigPath || pending}
            onClick={() => void copy()}
          >
            复制连接凭据
          </Button>
        </div>
        {info && (
          <p>
            MCP 地址：<code>{info.url}</code>
            <br />
            运行方式：
            {info.mode === 'observe'
              ? '观察模式 · 禁止资金操作'
              : info.mode === 'live'
                ? '实盘执行'
                : '未启用'}
            <br />
            单笔 {usd(info.limits.maxOrderUsd)} · 总敞口 {usd(info.limits.maxExposureUsd)} ·
            最多买入 {info.limits.maxBuyOrders} 笔 · 累计预算 {usd(info.limits.maxBuyBudgetUsd)}
          </p>
        )}
      </details>
      {notice && (
        <p role="status" className="pa-wallet-notice">
          {notice}
        </p>
      )}
    </div>
  );
}
