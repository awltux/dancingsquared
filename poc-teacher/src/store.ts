// TeacherStore: owns the app's PERSISTENT state (classes, programmes, tip config,
// call-probability overrides, saved modules, collapsible-section state) and the
// localStorage load/save for each. Transient UI state (notices, tour step, open
// preview/modal) stays in the controller. Isolating persistence behind a class
// makes the storage schema explicit and testable, and removes the many loose
// module-level load/save helpers from the app script.

import type { ClassInstance, TipConfig } from './teacher';
import { DEFAULT_TIP_CONFIG } from './teacher';
import type { Programme } from './programme';
import { ssdProgramme, mainstream2026Programme } from './programme';

const STORE_KEY = 'dsTeacherData';
const PROG_KEY = 'dsTeacherProgrammes';
const CFG_KEY = 'dsTeacherTipConfig';
const CALLPROB_KEY = 'dsTeacherCallProbs';
const MODULES_KEY = 'dsTeacherSavedModules';
const DETAILS_KEY = 'dsTeacherDetailsOpen';

/** A saved practice tip/module, with metadata on when/where it was created. */
export interface SavedModule {
  name: string;
  titles: string[];
  createdAt: number;
  createdClass: string;
  createdSession: string;
  expanded?: boolean;
}

function getItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function setItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore storage failures */
  }
}

export class TeacherStore {
  classes: ClassInstance[];
  programmes: Programme[];
  tipConfig: TipConfig;
  callProbs: Record<string, Record<string, number>>;
  savedModules: Record<string, SavedModule[]>;
  detailsState: Map<string, boolean>;

  constructor() {
    this.classes = this.loadClasses();
    this.programmes = this.loadProgrammes();
    this.tipConfig = this.loadTipConfig();
    this.callProbs = this.loadCallProbs();
    this.savedModules = this.loadSavedModules();
    this.detailsState = this.loadDetailsState();
  }

  // ---- classes ----

  private loadClasses(): ClassInstance[] {
    const raw = getItem(STORE_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ClassInstance[];
        if (Array.isArray(parsed) && parsed.length) return parsed;
      } catch {
        /* fall through to empty */
      }
    }
    return [];
  }

  saveClasses(): void {
    setItem(STORE_KEY, JSON.stringify(this.classes));
  }

  // ---- programmes ----

  private loadProgrammes(): Programme[] {
    const raw = getItem(PROG_KEY);
    if (raw) {
      try {
        const p = JSON.parse(raw) as Programme[];
        if (Array.isArray(p) && p.length) return p;
      } catch {
        /* fall through to defaults */
      }
    }
    return [ssdProgramme(), mainstream2026Programme()];
  }

  saveProgrammes(): void {
    setItem(PROG_KEY, JSON.stringify(this.programmes));
  }

  // ---- tip config ----

  private loadTipConfig(): TipConfig {
    const raw = getItem(CFG_KEY);
    if (raw) {
      try {
        return { ...DEFAULT_TIP_CONFIG, ...(JSON.parse(raw) as TipConfig) };
      } catch {
        /* fall through */
      }
    }
    return { ...DEFAULT_TIP_CONFIG };
  }

  saveTipConfig(): void {
    setItem(CFG_KEY, JSON.stringify(this.tipConfig));
  }

  // ---- call probability overrides ----

  private loadCallProbs(): Record<string, Record<string, number>> {
    const raw = getItem(CALLPROB_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as Record<string, Record<string, number>>;
      } catch {
        /* fall through */
      }
    }
    return {};
  }

  saveCallProbs(): void {
    setItem(CALLPROB_KEY, JSON.stringify(this.callProbs));
  }

  /** The effective call probability for a (class, call) — an override if set,
   * else the global current/prev default, with a bonus for prioritised calls. */
  effectiveCallProb(id: string, title: string, currentSet: Set<string>, prioritised?: Set<string>): number {
    const ov = this.callProbs[id]?.[title];
    if (ov != null) return ov;
    const base = currentSet.has(title) ? this.tipConfig.currentProb : this.tipConfig.prevProb;
    if (prioritised && prioritised.has(title)) return Math.min(1, base + 0.25);
    return base;
  }

  // ---- saved modules ----

  private loadSavedModules(): Record<string, SavedModule[]> {
    const raw = getItem(MODULES_KEY);
    if (raw) {
      try {
        return JSON.parse(raw) as Record<string, SavedModule[]>;
      } catch {
        /* fall through */
      }
    }
    return {};
  }

  saveSavedModules(): void {
    setItem(MODULES_KEY, JSON.stringify(this.savedModules));
  }

  // ---- collapsible <details> open/closed state ----

  private loadDetailsState(): Map<string, boolean> {
    const raw = getItem(DETAILS_KEY);
    if (raw) {
      try {
        return new Map(Object.entries(JSON.parse(raw) as Record<string, boolean>));
      } catch {
        /* ignore */
      }
    }
    return new Map();
  }

  saveDetailsState(): void {
    setItem(DETAILS_KEY, JSON.stringify(Object.fromEntries(this.detailsState)));
  }

  /** The `open` attribute for a <details> whose state is persisted by `key`,
   * defaulting to `def` the first time. */
  detailsOpenAttr(key: string, def: boolean): string {
    const v = this.detailsState.get(key);
    return (v === undefined ? def : v) ? ' open' : '';
  }
}
