import { useEffect, useMemo, useState } from 'react';
import { useAtlas, useMoney } from '../store/useAtlas';
import { PROVIDERS, HOURS_MONTH, HOURS_YEAR, PRICING_MODELS, type PricingModel, type Region } from '../domain/types';
import { COMPUTE_CONFIGS, indexKeyFor, pctDiff, pickOffering, DEFAULT_WORKLOAD, type Workload } from '../engine/compare';
import { TEMPLATES, billFor, neededIndexes, templateById, type Template } from '../engine/templates';
import { estRttMs } from '../engine/latency';
import { downloadCsv } from './share';
import { Term } from './Glossary';

const DEFAULT = ['aws:ap-south-1', 'azure:centralindia', 'gcp:asia-south1'];

function RegionSelect({ value, onChange, regions }: { value: string; onChange: (v: string) => void; regions: Region[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="field w-full">
      <option value="">— none —</option>
      {(['aws', 'azure', 'gcp'] as const).map((p) => (
        <optgroup key={p} label={PROVIDERS[p].label}>
          {regions.filter((r) => r.provider === p).map((r) => <option key={r.key} value={r.key}>{r.id} — {r.name}</option>)}
        </optgroup>
      ))}
    </select>
  );
}
const Seg = <T extends string>({ value, options, onChange, fmt }: { value: T; options: T[]; onChange: (v: T) => void; fmt?: (v: T) => string }) =>
  <div className="seg">{options.map((o) => <button key={o} className={o === value ? 'on' : ''} onClick={() => onChange(o)}>{fmt ? fmt(o) : o}</button>)}</div>;

export function ComparePanel() {
  const regions = useAtlas((s) => s.regions), indexes = useAtlas((s) => s.indexes), selected = useAtlas((s) => s.selected), origin = useAtlas((s) => s.origin);
  const model = useAtlas((s) => s.workload.pricingModel);
  const { set, ensure, setWorkload } = useAtlas.getState();
  const money = useMoney();
  const [picks, setPicks] = useState<string[]>(() => selected ? [selected, ...DEFAULT.filter((d) => !d.startsWith(selected.split(':')[0]))].slice(0, 3) : DEFAULT);
  const [cfg, setCfg] = useState('4x16'), [arch, setArch] = useState<Workload['arch']>('x86_64');
  const [tplId, setTplId] = useState('web');
  const [custom, setCustom] = useState<Template>(templateById('web'));
  useEffect(() => { setCustom(templateById(tplId)); }, [tplId]);
  useEffect(() => { ['compute', 'storage', 'network', 'database', 'gpu', ...neededIndexes(custom, model), indexKeyFor('compute', model)].forEach((k) => ensure(k as never)); }, [custom, model, ensure]);

  const sel = picks.map((k) => regions.find((x) => x.key === k)).filter(Boolean) as Region[];
  const vmRows = sel.map((r) => ({ r, vm: pickOffering(indexes[indexKeyFor('compute', model)]?.byRegion.get(r.key), { ...DEFAULT_WORKLOAD, kind: 'compute', computeConfig: cfg, arch, pricingModel: model }) }));
  const have = vmRows.filter((x) => x.vm); const cheapVm = Math.min(...have.map((x) => x.vm!.unitPrice));
  const bills = useMemo(() => sel.map((r) => ({ r, bill: billFor(r, custom, indexes, model) })), [sel.map((r) => r.key).join(), custom, indexes, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = bills.filter((b) => b.bill.total != null); const cheapTotal = Math.min(...totals.map((b) => b.bill.total!));
  const num = (v: number, s: (n: number) => void, w = 'w-20') => <input type="number" min={0} value={v} onChange={(e) => s(Math.max(0, +e.target.value))} className={`field !h-6 ${w} tabular-nums`} />;

  const exportCsv = () => {
    const rows: (string | number | null)[][] = [['section', 'provider', 'region', 'item', 'qty', 'unit_price_usd', 'monthly_usd', 'annual_usd', 'pricing_model', 'source_url']];
    vmRows.forEach(({ r, vm }) => rows.push(['compute-only', r.provider, r.id, vm?.label ?? 'no verified data', `${cfg} ${arch}`, vm?.unitPrice ?? null, vm ? vm.unitPrice * HOURS_MONTH : null, vm ? vm.unitPrice * HOURS_YEAR : null, model, vm?.record.sourceUrl ?? '']));
    bills.forEach(({ r, bill }) => { bill.lines.forEach((l) => rows.push(['workload', r.provider, r.id, l.item, l.qty, l.unit, l.monthly, l.monthly != null ? l.monthly * 12 : null, /VM|GPU/.test(l.item) ? model : 'on-demand', l.record?.sourceUrl ?? ''])); rows.push(['workload', r.provider, r.id, 'TOTAL', '', null, bill.total, bill.total != null ? bill.total * 12 : null, model, '']); });
    downloadCsv(`cloud-atlas-comparison-${new Date().toISOString().slice(0, 10)}.csv`, rows);
  };

  return (
    <div className="panel absolute z-40 left-1/2 -translate-x-1/2 top-[52px] w-[800px] max-w-[calc(100vw-24px)] max-h-[calc(100vh-150px)] overflow-auto">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--line)] sticky top-0 bg-[#03060c] z-10">
        <div className="cond text-[10px] tracking-[0.2em] text-[var(--accent)]">COMPARISON ENGINE</div>
        <Seg value={model} options={['on-demand', 'spot', 'commit-1y'] as PricingModel[]} onChange={(m) => setWorkload({ pricingModel: m })} fmt={(m) => PRICING_MODELS[m].short} />
        <span className="note hidden md:inline">{PRICING_MODELS[model].note}</span>
        <div className="ml-auto flex gap-1">
          <button onClick={exportCsv} className="btn !h-6">csv</button>
          <button onClick={() => set({ compareOpen: false })} className="btn !h-6">close</button>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 px-4 pt-3">
        {[0, 1, 2].map((i) => <RegionSelect key={i} regions={regions} value={picks[i] ?? ''} onChange={(v) => setPicks((p) => { const n = [...p]; n[i] = v; return n; })} />)}
      </div>

      <section className="px-4 pt-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="sec-t">Compute only</span>
          <Seg value={cfg} options={COMPUTE_CONFIGS} onChange={setCfg} fmt={(c) => c.replace('x', '/') + 'G'} />
          <Seg value={arch} options={['x86_64', 'arm64'] as Workload['arch'][]} onChange={setArch} />
        </div>
        <table className="dt">
          <thead><tr><th>Region</th><th>Offering</th><th className="n">Hourly</th><th className="n">Monthly · 730 h</th><th className="n">Annual · 8,760 h</th><th className="n">vs cheapest</th>{origin && <th className="n"><Term k="rtt">est. RTT</Term></th>}</tr></thead>
          <tbody>{vmRows.map(({ r, vm }) => (
            <tr key={r.key}>
              <td><span className="sw mr-1.5" style={{ background: PROVIDERS[r.provider].color }} /><span className="text-[var(--ink)]">{PROVIDERS[r.provider].label}</span> {r.id}</td>
              <td className="text-[10.5px]">{vm?.label.replace('Standard_', '') ?? <span className="text-[var(--ink-4)]">no verified data</span>}</td>
              <td className="n hi">{money(vm?.unitPrice)}</td>
              <td className="n">{money(vm && vm.unitPrice * HOURS_MONTH, 2)}</td>
              <td className="n">{money(vm && vm.unitPrice * HOURS_YEAR, 0)}</td>
              <td className={`n ${vm && vm.unitPrice === cheapVm && have.length > 1 ? 'best' : ''}`}>{vm && have.length > 1 ? (vm.unitPrice === cheapVm ? 'cheapest' : `+${pctDiff(vm.unitPrice, cheapVm).toFixed(1)}%`) : '—'}</td>
              {origin && <td className="n">~{Math.round(estRttMs(origin, r))} ms</td>}
            </tr>))}</tbody>
        </table>
        <p className="note mt-1.5">Linux, cheapest general-purpose family with an exact <Term k="vcpu">vCPU</Term>/RAM match, compute only. CPU generations differ, so per-core performance is not equal.</p>
      </section>

      <section className="px-4 py-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="sec-t">Workload bill</span>
          <select className="field !h-6" value={tplId} onChange={(e) => setTplId(e.target.value)}>{TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
          <span className="note">{templateById(tplId).blurb}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-[var(--ink-2)] mb-2.5">
          {custom.vms && <label className="flex items-center gap-1.5">{num(custom.vms.count, (n) => setCustom({ ...custom, vms: { ...custom.vms!, count: n } }), 'w-14')} VMs × {custom.vms.cfg.replace('x', '/')}G {custom.vms.arch}</label>}
          {custom.gpu && <label className="flex items-center gap-1.5">{num(custom.gpu.instances, (n) => setCustom({ ...custom, gpu: { ...custom.gpu!, instances: n } }), 'w-14')} × {custom.gpu.count}× {custom.gpu.model.replace('NVIDIA ', '')}</label>}
          <label className="flex items-center gap-1.5">{num(custom.storageGB, (n) => setCustom({ ...custom, storageGB: n }))} GB object storage</label>
          <label className="flex items-center gap-1.5">{num(custom.egressGB, (n) => setCustom({ ...custom, egressGB: n }))} GB <Term k="egress">egress</Term></label>
          {custom.db && <span>+ {custom.db.engine} {custom.db.cfg.replace('x', '/')}G</span>}
        </div>
        <table className="dt">
          <thead><tr><th>Line item</th>{bills.map(({ r }) => <th key={r.key} className="n"><span style={{ color: PROVIDERS[r.provider].color }}>{PROVIDERS[r.provider].label}</span> <span className="normal-case tracking-normal mono">{r.id}</span></th>)}</tr></thead>
          <tbody>
            {(bills[0]?.bill.lines ?? []).map((l, i) => (
              <tr key={l.item}><td className="text-[10.5px]">{l.item} <span className="text-[var(--ink-3)]">· {l.qty}</span></td>
                {bills.map(({ r, bill }) => <td key={r.key} className="n" title={bill.lines[i]?.note ?? ''}>{money(bill.lines[i]?.monthly, 2)}</td>)}</tr>
            ))}
            <tr><td className="text-[var(--ink)]">Total / month</td>{bills.map(({ r, bill }) => <td key={r.key} className={`n ${bill.total === cheapTotal && totals.length > 1 ? 'best' : 'hi'}`} title={bill.missing.length ? `Missing verified pricing: ${bill.missing.join(', ')}` : ''}>{bill.total != null ? money(bill.total, 2) : 'incomplete'}</td>)}</tr>
            <tr><td>Annual</td>{bills.map(({ r, bill }) => <td key={r.key} className="n">{bill.total != null ? money(bill.total * 12, 0) : '—'}</td>)}</tr>
            <tr><td>vs cheapest</td>{bills.map(({ r, bill }) => <td key={r.key} className="n">{bill.total != null && totals.length > 1 ? (bill.total === cheapTotal ? 'cheapest' : `+${pctDiff(bill.total, cheapTotal).toFixed(1)}%`) : '—'}</td>)}</tr>
          </tbody>
        </table>
        <ul className="note mt-2 space-y-0.5 list-disc pl-4">
          <li>The pricing model applies to VM and GPU lines; storage, egress and database are on-demand.</li>
          <li>Excludes OS licences, boot disks, request fees, DB storage/backup, load balancers, support and tax. Egress at first paid tier; free allowances not deducted.</li>
          <li>No winner is declared unless at least two regions have verified pricing for every line.</li>
        </ul>
      </section>
    </div>
  );
}
