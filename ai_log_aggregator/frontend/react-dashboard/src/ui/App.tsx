import React, { useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, BarChart, Bar, Legend
} from 'recharts';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';
type Incoming = { topic: string; payload: { source: string; level: LogLevel; message: string; timestamp?: string; insight?: any } };

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: '#64748b',
  info: '#3b82f6',
  warn: '#eab308',
  error: '#ef4444',
};

function useDarkMode() {
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  useEffect(() => {
    const root = document.documentElement;
    if (dark) { root.classList.add('dark'); localStorage.setItem('theme', 'dark'); }
    else { root.classList.remove('dark'); localStorage.setItem('theme', 'light'); }
  }, [dark]);
  return { dark, toggle: () => setDark((d) => !d) };
}

export default function App() {
  const [messages, setMessages] = useState<Incoming[]>([]);
  const [connected, setConnected] = useState(false);
  const bucketRef = useRef<Record<string, { total: number; error: number }>>({});
  const { dark, toggle } = useDarkMode();
  const [selected, setSelected] = useState<Record<LogLevel, boolean>>({ debug: true, info: true, warn: true, error: true });
  const [source, setSource] = useState<string>('all');
  const [windowSel, setWindowSel] = useState<'all'|'5m'|'15m'|'60m'>('all');
  const [pageSize, setPageSize] = useState(100);
  const [pageOffset, setPageOffset] = useState(0);
  const [totalCount, setTotalCount] = useState<number | null>(null);
  const pageCacheRef = useRef<Record<string, Record<number, Incoming[]>>>({}); // cache per filterKey and offset
  const filterKey = JSON.stringify({ selected, source, windowSel, pageSize });
  const pendingQueueRef = useRef<Incoming[]>([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [pageInput, setPageInput] = useState(1);
  const totalPages = useMemo(() => (totalCount ? Math.max(1, Math.ceil(totalCount / pageSize)) : 1), [totalCount, pageSize]);
  const currentPage = useMemo(() => Math.floor(pageOffset / pageSize) + 1, [pageOffset, pageSize]);

  const appendMessage = (msg: Incoming) => {
    const ts = msg.payload.timestamp ? new Date(msg.payload.timestamp) : new Date();
    const key = format(ts, 'HH:mm');
    const buckets = bucketRef.current;
    buckets[key] = buckets[key] || { total: 0, error: 0 };
    buckets[key].total += 1;
    if (msg.payload.level === 'error') buckets[key].error += 1;
    setMessages((m) => [msg, ...m].slice(0, 500));
  };

  useEffect(() => {
    const ws = new WebSocket(`ws://${location.hostname}:8080`);
    ws.onopen = () => setConnected(true);
    ws.onclose = () => setConnected(false);
    ws.onmessage = (ev) => {
      const msg: Incoming = JSON.parse(ev.data);
      if (pageOffset === 0) appendMessage(msg);
      else {
        pendingQueueRef.current.push(msg);
        setPendingCount(pendingQueueRef.current.length);
      }
    };
    return () => ws.close();
  }, [pageOffset]);

  // parse filters from URL on first mount
  useEffect(() => {
    const sp = new URLSearchParams(location.search);
    const levelsStr = sp.get('levels') || '';
    if (levelsStr) {
      const lvls = levelsStr.split(',') as LogLevel[];
      setSelected({ debug: lvls.includes('debug'), info: lvls.includes('info'), warn: lvls.includes('warn'), error: lvls.includes('error') });
    }
    const src = sp.get('source');
    if (src) setSource(src);
    const win = sp.get('window') as any;
    if (win && ['all','5m','15m','60m'].includes(win)) setWindowSel(win);
    const ps = parseInt(sp.get('pageSize') || '0', 10);
    if (ps && ps > 0 && ps <= 1000) setPageSize(ps);
    const off = parseInt(sp.get('offset') || '0', 10);
    if (!Number.isNaN(off) && off >= 0) setPageOffset(off);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // update URL when filters or paging change
  useEffect(() => {
    const params = new URLSearchParams();
    const levels = (['debug','info','warn','error'] as LogLevel[]).filter(l => selected[l]).join(',');
    if (levels && levels.length < 20) params.set('levels', levels);
    if (source !== 'all') params.set('source', source);
    params.set('window', windowSel);
    params.set('pageSize', String(pageSize));
    if (pageOffset) params.set('offset', String(pageOffset));
    const url = `${location.pathname}?${params.toString()}`;
    history.replaceState(null, '', url);
  }, [selected, source, windowSel, pageSize, pageOffset]);

  useEffect(() => {
    setPageInput(currentPage);
  }, [currentPage]);

  // fetch a page according to filters and offset, with cache
  useEffect(() => {
    // reset cache if filterKey changes
    if (!pageCacheRef.current[filterKey]) {
      pageCacheRef.current = { [filterKey]: {} };
    }
    // check cache
    const cached = pageCacheRef.current[filterKey][pageOffset];
    const levels = (['debug','info','warn','error'] as LogLevel[]).filter(l => selected[l]).join(',');
    const sinceMinutes = windowSel === 'all' ? undefined : (windowSel === '5m' ? 5 : windowSel === '15m' ? 15 : 60);
    if (cached) {
      setMessages(cached);
      return;
    }
    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set('limit', String(pageSize));
    params.set('offset', String(pageOffset));
    if (levels && levels.length < 20) params.set('levels', levels);
    if (source !== 'all') params.set('source', source);
    if (sinceMinutes) params.set('sinceMinutes', String(sinceMinutes));
    fetch(`http://${location.hostname}:4000/recent?${params.toString()}`, { signal: controller.signal })
      .then(async r => {
        const totalHeader = r.headers.get('x-total-count');
        if (totalHeader) setTotalCount(parseInt(totalHeader, 10));
        return r.json();
      })
      .then((rows: any[]) => {
        const mapped: Incoming[] = rows.map(r => ({
          topic: 'logs.insights',
          payload: {
            source: r.source,
            level: r.level as LogLevel,
            message: r.message,
            timestamp: r.timestamp,
            insight: r.insight,
          }
        }));
        // set page and cache
        setMessages(mapped);
        pageCacheRef.current[filterKey][pageOffset] = mapped;
        // rebuild buckets for charts
        bucketRef.current = {};
        for (const m of mapped) appendMessage(m);
      })
      .catch(() => {})
    return () => controller.abort();
  }, [filterKey, pageOffset]);

  const stats = useMemo(() => {
    const now = new Date();
    const windowMs = windowSel === 'all' ? Infinity : (windowSel === '5m' ? 5 : windowSel === '15m' ? 15 : 60) * 60 * 1000;
    const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    let total = 0;
    for (const m of messages) {
      if (!selected[m.payload.level]) continue;
      if (source !== 'all' && m.payload.source !== source) continue;
      const t = m.payload.timestamp ? new Date(m.payload.timestamp) : now;
      if (now.getTime() - t.getTime() > windowMs) continue;
      counts[m.payload.level] += 1;
      total += 1;
    }
    return { total, counts };
  }, [messages, selected, source, windowSel]);

  const series = useMemo(() => {
    const now = new Date();
    const windowMs = windowSel === 'all' ? Infinity : (windowSel === '5m' ? 5 : windowSel === '15m' ? 15 : 60) * 60 * 1000;
    const buckets: Record<string, { total: number; error: number }> = {};
    for (const m of messages) {
      if (!selected[m.payload.level]) continue;
      if (source !== 'all' && m.payload.source !== source) continue;
      const t = m.payload.timestamp ? new Date(m.payload.timestamp) : now;
      if (now.getTime() - t.getTime() > windowMs) continue;
      const key = format(t, 'HH:mm');
      buckets[key] = buckets[key] || { total: 0, error: 0 };
      buckets[key].total += 1;
      if (m.payload.level === 'error') buckets[key].error += 1;
    }
    return Object.entries(buckets)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-20)
      .map(([k, v]) => ({ time: k, total: v.total, error: v.error }));
  }, [messages, selected, source, windowSel]);

  const distribution = useMemo(() => (
    (['debug','info','warn','error'] as LogLevel[]).map(l => ({ name: l, value: stats.counts[l], fill: LEVEL_COLORS[l] }))
  ), [stats]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) set.add(m.payload.source);
    return Array.from(set).sort();
  }, [messages]);

  const toggleLevel = (lvl: LogLevel) => setSelected(s => ({ ...s, [lvl]: !s[lvl] }));
  const nextPage = () => {
    if (totalCount != null && pageOffset + pageSize >= totalCount) return;
    setPageOffset(o => o + pageSize);
  };
  const prevPage = () => {
    setPageOffset(o => Math.max(0, o - pageSize));
  };
  const goLatest = () => {
    setPageOffset(0);
    pendingQueueRef.current = [];
    setPendingCount(0);
  };
  const changePageSize = (val: number) => {
    const v = Math.min(1000, Math.max(10, val));
    // reset cache and go to first page
    setPageSize(v);
    setPageOffset(0);
    pageCacheRef.current = {};
  };
  const gotoPage = () => {
    const p = Math.min(totalPages, Math.max(1, Number(pageInput) || 1));
    setPageOffset((p - 1) * pageSize);
  };

  return (
    <div className="min-h-full">
      {/* Top Nav */}
      <header className="sticky top-0 z-10 border-b border-gray-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/60 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded bg-brand-600" />
            <h1 className="text-lg font-semibold">AI Log Aggregator</h1>
            <span className={`ml-3 badge ${connected ? 'badge-green' : 'badge-red'}`}>{connected ? 'Live' : 'Disconnected'}</span>
            {pendingCount > 0 && (
              <button onClick={goLatest} className="ml-3 badge badge-blue">{`New events: ${pendingCount} — Go to latest`}</button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggle} className="px-3 py-1.5 rounded-md text-sm bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600">
              {dark ? 'Light Mode' : 'Dark Mode'}
            </button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="mx-auto max-w-7xl p-4 md:p-6 space-y-6">
        {/* Filters */}
        <section className="card">
          <div className="card-header">Filters</div>
          <div className="card-body flex flex-col md:flex-row md:items-center gap-3">
            <div className="flex flex-wrap gap-2">
              {(['debug','info','warn','error'] as LogLevel[]).map(l => (
                <button key={l} onClick={() => toggleLevel(l)} className={`badge capitalize ${selected[l] ? 'badge-blue' : 'badge-gray'}`}>{l}</button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">Source</label>
              <select value={source} onChange={e => setSource(e.target.value)} className="px-2 py-1 rounded border dark:bg-slate-800">
                <option value="all">All Sources</option>
                {sources.map(s => (<option key={s} value={s}>{s}</option>))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">Window</label>
              <select value={windowSel} onChange={e => setWindowSel(e.target.value as any)} className="px-2 py-1 rounded border dark:bg-slate-800">
                <option value="all">All</option>
                <option value="5m">Last 5m</option>
                <option value="15m">Last 15m</option>
                <option value="60m">Last 60m</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">Page size</label>
              <select value={pageSize} onChange={e => changePageSize(parseInt(e.target.value, 10))} className="px-2 py-1 rounded border dark:bg-slate-800">
                {[50, 100, 200, 500].map(ps => (<option key={ps} value={ps}>{ps}</option>))}
              </select>
            </div>
            <div className="ml-auto">
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">{`Showing ${messages.length}${totalCount != null ? ` of ${totalCount}` : ''}`}</span>
                <span className="text-xs text-gray-500">{`Page ${currentPage} of ${totalPages}`}</span>
                <input type="number" min={1} max={totalPages} value={pageInput} onChange={e => setPageInput(parseInt(e.target.value, 10))} className="w-16 px-2 py-1 rounded border dark:bg-slate-800" />
                <button onClick={gotoPage} className="px-2 py-1 rounded-md text-sm bg-gray-100 hover:bg-gray-200 dark:bg-slate-700 dark:hover:bg-slate-600">Go</button>
                <button onClick={prevPage} disabled={pageOffset === 0} className="px-3 py-1.5 rounded-md text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600">Prev</button>
                <button onClick={nextPage} disabled={totalCount != null && (pageOffset + pageSize >= totalCount)} className="px-3 py-1.5 rounded-md text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-50 dark:bg-slate-700 dark:hover:bg-slate-600">Next</button>
              </div>
            </div>
          </div>
        </section>

        {/* Summary Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="card">
            <div className="card-header">Total Events</div>
            <div className="card-body text-3xl font-bold">{stats.total}</div>
          </div>
          <div className="card">
            <div className="card-header">Errors</div>
            <div className="card-body flex items-baseline gap-2">
              <div className="text-3xl font-bold text-rose-500">{stats.counts.error}</div>
              <span className="text-xs text-gray-500">last 500 msgs</span>
            </div>
          </div>
          <div className="card">
            <div className="card-header">Warnings</div>
            <div className="card-body text-3xl font-bold text-yellow-500">{stats.counts.warn}</div>
          </div>
          <div className="card">
            <div className="card-header">Info</div>
            <div className="card-body text-3xl font-bold text-blue-500">{stats.counts.info}</div>
          </div>
        </section>

        {/* Charts Row 1 */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="card lg:col-span-2">
            <div className="card-header">Events over time</div>
            <div className="card-body h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series} margin={{ left: 8, right: 8, top: 8, bottom: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-slate-700" />
                  <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip cursor={false} wrapperStyle={{ outline: 'none' }} contentStyle={{ backgroundColor: 'transparent', border: 'none', boxShadow: 'none' }} labelStyle={{ color: 'currentColor' }} itemStyle={{ color: 'currentColor' }} />
                  <Line type="monotone" dataKey="total" stroke="#3b82f6" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="error" stroke="#ef4444" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card">
            <div className="card-header">Error rate</div>
            <div className="card-body h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={series.map(p => ({ time: p.time, rate: p.total ? Math.round((p.error / p.total) * 100) : 0 }))}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-slate-700" />
                  <XAxis dataKey="time" tick={{ fontSize: 12 }} />
                  <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12 }} />
                  <Tooltip cursor={false} formatter={(v) => `${v}%`} wrapperStyle={{ outline: 'none' }} contentStyle={{ backgroundColor: 'transparent', border: 'none', boxShadow: 'none' }} labelStyle={{ color: 'currentColor' }} itemStyle={{ color: 'currentColor' }} />
                  <Line type="monotone" dataKey="rate" stroke="#ef4444" strokeWidth={2} dot={false} />
                  <Legend />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Charts Row 2 */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="card">
            <div className="card-header">By level</div>
            <div className="card-body space-y-3">
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={distribution} dataKey="value" nameKey="name" outerRadius={90} innerRadius={40}>
                      {distribution.map((entry, index) => (<Cell key={`c-${index}`} fill={entry.fill} />))}
                    </Pie>
                    <Tooltip cursor={false} wrapperStyle={{ outline: 'none' }} contentStyle={{ backgroundColor: 'transparent', border: 'none', boxShadow: 'none' }} labelStyle={{ color: 'currentColor' }} itemStyle={{ color: 'currentColor' }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 text-sm">
                {distribution.map(d => (
                  <div key={d.name} className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded" style={{ background: d.fill }} />
                    <span className="capitalize">{d.name}</span>
                    <span className="ml-auto font-semibold">{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="card">
            <div className="card-header">Per-source throughput</div>
            <div className="card-body h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={(() => {
                  const map: Record<string, number> = {};
                  for (const m of messages) {
                    if (!selected[m.payload.level]) continue;
                    if (source !== 'all' && m.payload.source !== source) continue;
                    const s = m.payload.source || 'unknown';
                    map[s] = (map[s] || 0) + 1;
                  }
                  return Object.entries(map).map(([name, value]) => ({ name, value }));
                })()}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" className="dark:stroke-slate-700" />
                  <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip cursor={false} wrapperStyle={{ outline: 'none' }} contentStyle={{ backgroundColor: 'transparent', border: 'none', boxShadow: 'none' }} labelStyle={{ color: 'currentColor' }} itemStyle={{ color: 'currentColor' }} />
                  <Bar dataKey="value" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        </section>

        {/* Live Feed */}
        <section className="card">
          <div className="card-header">Live Insights</div>
          <div className="card-body overflow-auto max-h-[40vh]">
            <ul className="divide-y divide-gray-200 dark:divide-slate-700">
              {messages.filter(m => selected[m.payload.level] && (source==='all' || m.payload.source===source)).map((m, i) => (
                <li key={i} className="py-3 flex items-start gap-3">
                  <span className="mt-1 h-2.5 w-2.5 rounded-full" style={{ background: LEVEL_COLORS[m.payload.level] }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-semibold">{m.payload.source}</span>
                      <span className="text-gray-500">{m.topic}</span>
                      <span className="badge-blue capitalize">{m.payload.level}</span>
                      <span className="ml-auto text-xs text-gray-500">
                        {m.payload.timestamp ? format(new Date(m.payload.timestamp), 'HH:mm:ss') : format(new Date(), 'HH:mm:ss')}
                      </span>
                    </div>
                    <div className="text-sm mt-1 break-words">{m.payload.message}</div>
                    {m.payload.insight && (
                      <pre className="mt-2 text-xs bg-gray-50 dark:bg-slate-900/60 p-2 rounded overflow-auto max-h-28">{JSON.stringify(m.payload.insight, null, 2)}</pre>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}
