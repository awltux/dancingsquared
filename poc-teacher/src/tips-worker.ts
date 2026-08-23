// Web worker: run tip generation off the main thread so the UI stays responsive
// and a spinner can animate while the (potentially slow) getout search runs.
import { makeSequencer } from './catalog';
import { generateTips, DEFAULT_TIP_CONFIG } from './teacher';
import type { TipConfig } from './teacher';

interface GenRequest {
  movesXml: string;
  formationsXml: string;
  calls: { title: string; xml: string }[];
  avail: string[];
  priority: Record<string, number>;
  config?: TipConfig;
  current: string[];
  overrides: Record<string, number>;
  currentProb: number;
  prevProb: number;
  prioritised: string[];
  familyMap: Record<string, string>;
  opts: { minLen?: number; maxLen?: number; count?: number; getoutMax?: number };
}

const ctx = self as unknown as {
  onmessage: (e: MessageEvent<GenRequest>) => void;
  postMessage: (msg: { tips: string[][]; error?: string }) => void;
};

ctx.onmessage = (e) => {
  const d = e.data;
  console.log('[tips-worker] request received', {
    calls: d.calls.length,
    avail: d.avail.length,
    current: d.current.length,
    prioritised: d.prioritised.length,
    opts: d.opts,
  });
  try {
    const seq = makeSequencer(d.movesXml, d.formationsXml, d.calls);
    const current = new Set(d.current);
    const prioritised = new Set(d.prioritised);
    const callProb = (t: string) => {
      if (d.overrides[t] != null) return d.overrides[t];
      const base = current.has(t) ? d.currentProb : d.prevProb;
      if (prioritised.has(t)) return Math.min(1, base + 0.25);
      return base;
    };
    const family = (t: string) => d.familyMap[t] ?? '';
    console.log('[tips-worker] sequencer built, calls =', d.calls.map((c) => c.title));
    const tips = generateTips(seq, new Set(d.avail), new Map(Object.entries(d.priority)), {
      ...d.opts,
      config: { ...DEFAULT_TIP_CONFIG, ...(d.config ?? {}) },
      current,
      callProb,
      family,
    });
    console.log('[tips-worker] generated', tips.length, 'tips:', tips.map((t) => t.join(' > ')));
    ctx.postMessage({ tips });
  } catch (err) {
    console.error('[tips-worker] ERROR in tip generation:', err);
    ctx.postMessage({ tips: [], error: String(err) });
  }
};
