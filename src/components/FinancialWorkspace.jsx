const financialTabs = [
  { id: 'markets', label: '行情研究' },
  { id: 'events', label: '事件投研' },
  { id: 'trader', label: '交易员 Copilot' },
  { id: 'watchlist', label: '自选' },
  { id: 'alerts', label: '预警' }
];

const assets = ['AAPL', '0700.HK', '600519.SH', 'BTC/USDT'];

export function FinancialWorkspace({ activeTab, onTabChange, symbol, onSymbolChange, onOpenChat, researchContextRef }) {
  const activeLabel = financialTabs.find((tab) => tab.id === activeTab)?.label;

  return (
    <section className="financial-research-workbench" aria-label="金融工作台" ref={researchContextRef} tabIndex="-1">
      <nav className="financial-workbench-nav" role="tablist" aria-label="金融工作台导航">
        <p className="eyebrow">研究导航</p>
        {financialTabs.map((tab) => (
          <button
            aria-controls={`${tab.id}-panel`}
            aria-selected={activeTab === tab.id}
            className={activeTab === tab.id ? 'active' : ''}
            id={`${tab.id}-tab`}
            key={tab.id}
            onClick={() => onTabChange(tab.id)}
            role="tab"
            tabIndex={activeTab === tab.id ? 0 : -1}
            type="button"
          >
            {tab.label}
          </button>
        ))}
        <p className="financial-nav-note">所有市场信息仅在工具查询后写入对话和研究结果。</p>
      </nav>

      <section className="financial-research-canvas" aria-labelledby={`${activeTab}-tab`} id={`${activeTab}-panel`} role="tabpanel">
        <header className="financial-canvas-header">
          <div>
            <p className="eyebrow">Research canvas</p>
            <h1>{activeLabel}</h1>
          </div>
          <button className="financial-chat-entry" type="button" onClick={onOpenChat}>询问 Copilot</button>
        </header>
        {activeTab === 'markets' && (
          <div className="financial-canvas-content">
            <section className="research-asset-selector" aria-labelledby="asset-selector-title">
              <div>
                <p className="eyebrow">当前研究范围</p>
                <h2 id="asset-selector-title">已选资产</h2>
              </div>
              <p className="research-note">选择资产后，会同步到金融对话的当前上下文。</p>
              <div className="asset-picker" aria-label="选择研究资产">
                {assets.map((asset) => (
                  <button
                    aria-pressed={symbol === asset}
                    className={symbol === asset ? 'active' : ''}
                    key={asset}
                    onClick={() => onSymbolChange(asset)}
                    type="button"
                  >
                  {asset}
                </button>
              ))}
              </div>
            </section>
            <section className="research-query-state" aria-labelledby="market-query-title">
              <p className="eyebrow">市场数据</p>
              <h2 id="market-query-title">等待查询</h2>
              <p>报价、数据来源和更新时间将在查询后展示。</p>
              <p className="financial-state">尚未发起数据查询；请通过金融对话说明需要的行情或比较范围。</p>
            </section>
          </div>
        )}

        {activeTab === 'events' && (
          <div className="financial-canvas-content">
            <section className="research-query-brief">
              <p className="eyebrow">查询范围</p>
              <h2>事件查询</h2>
              <p>使用当前资产 <strong>{symbol}</strong> 查询新闻、公告或指定时间范围。</p>
              <button type="button" onClick={onOpenChat}>在金融对话中查询事件</button>
            </section>
            <section className="research-query-state">
              <p className="eyebrow">查询结果</p>
              <h2>新闻与公告状态</h2>
              <p>需通过工具获取新闻/公告，结果会附带来源与发布时间。</p>
              <p className="financial-state">未配置新闻或公告工具，暂不展示未经查询的事件内容。</p>
            </section>
          </div>
        )}

        {activeTab === 'trader' && (
          <div className="financial-canvas-content">
            <section className="research-query-state">
              <p className="eyebrow">衍生品研究</p>
              <h2>加密衍生品</h2>
              <p>为 <strong>{symbol}</strong> 准备资金费率、未平仓量和流动性研究入口。</p>
              <p className="financial-state">未配置衍生品数据工具，暂无衍生品数据。</p>
            </section>
            <section className="research-query-brief">
              <p className="eyebrow">研究规则</p>
              <h2>预警和风险条件</h2>
              <p>设置研究触发条件、观察周期和失效条件后，再通过工具验证。</p>
              <p className="financial-safety">仅研究，不执行下单。</p>
            </section>
          </div>
        )}

        {activeTab === 'watchlist' && (
          <div className="financial-canvas-content">
            <section className="research-query-state">
              <p className="eyebrow">自选资产</p>
              <h2>待建立观察清单</h2>
              <p>先选择资产或在对话中说明筛选规则；不会展示未经查询的市场结论。</p>
            </section>
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="financial-canvas-content">
            <section className="research-query-state">
              <p className="eyebrow">预警条件</p>
              <h2>待配置研究预警</h2>
              <p>输入价格、事件或风险条件后，再通过已配置工具进行验证。</p>
            </section>
          </div>
        )}
      </section>
    </section>
  );
}
