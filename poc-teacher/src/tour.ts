// Tour: the guided onboarding overlay shown the first time the app opens (and
// replayable via the home page). Owns the current step, the step list, and the
// overlay markup + event wiring, so the app script doesn't carry tour state.

const TOUR_KEY = 'dsTeacherTourDone';

interface TourStep {
  title: string;
  text: string;
  target?: string; // CSS selector for the element to spotlight
}

const TOUR_STEPS: TourStep[] = [
  { title: 'Welcome', text: 'This app plans your square dance classes — sessions, attendance, call progress and practice tips.' },
  { title: 'Your classes', text: 'Each card is a class you are teaching. Tap one to open its sessions.', target: '.section-title' },
  { title: 'New course', text: 'Start a new class from a programme of sessions.', target: '[data-nav="#/new"]' },
  { title: 'Programmes', text: 'Import, export and manage the session programmes.', target: '[data-nav="#/programmes"]' },
  { title: 'Bottom navigation', text: 'Jump between Home, Sessions, Students and Tips from the bar at the bottom.', target: '.bottombar' },
];

export class Tour {
  private step: number | null = null;
  private render: () => void = () => {};

  constructor(private readonly esc: (s: string) => string) {}

  /** Wire the app's re-render as the callback the tour uses to repaint. */
  attachRender(fn: () => void): void {
    this.render = fn;
  }

  get active(): boolean {
    return this.step !== null;
  }

  start(): void {
    this.step = 0;
    this.render();
  }

  end(): void {
    this.step = null;
    try {
      localStorage.setItem(TOUR_KEY, '1');
    } catch {
      /* ignore */
    }
    this.render();
  }

  /** Show the tour on first open (if it hasn't been seen). */
  maybeStart(): void {
    try {
      if (localStorage.getItem(TOUR_KEY) === '1') return;
    } catch {
      return;
    }
    this.start();
  }

  /** Markup for the active tour overlay (empty string when no tour is running). */
  overlay(): string {
    if (this.step === null) return '';
    const s = TOUR_STEPS[this.step];
    return `
    <div class="tour-overlay">
      <div class="tour-highlight"></div>
      <div class="tour-pop">
        <div class="tour-step">Step ${this.step + 1} of ${TOUR_STEPS.length}</div>
        <h2>${this.esc(s.title)}</h2>
        <p>${this.esc(s.text)}</p>
        <div class="tour-actions">
          ${this.step > 0 ? '<button class="big" data-tour-prev>Back</button>' : ''}
          ${this.step < TOUR_STEPS.length - 1
            ? '<button class="big primary" data-tour-next>Next</button>'
            : '<button class="big primary" data-tour-done>Done</button>'}
          <button class="icon-btn" data-tour-close title="Close">✕</button>
        </div>
      </div>
    </div>`;
  }

  /** Bind the tour's buttons and position the spotlight (called each render). */
  wire(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-tour]').forEach((el) =>
      el.addEventListener('click', () => this.start()));
    root.querySelectorAll<HTMLElement>('[data-tour-next]').forEach((el) =>
      el.addEventListener('click', () => {
        if (this.step !== null && this.step < TOUR_STEPS.length - 1) { this.step++; this.render(); }
      }));
    root.querySelectorAll<HTMLElement>('[data-tour-prev]').forEach((el) =>
      el.addEventListener('click', () => {
        if (this.step !== null && this.step > 0) { this.step--; this.render(); }
      }));
    root.querySelectorAll<HTMLElement>('[data-tour-done], [data-tour-close]').forEach((el) =>
      el.addEventListener('click', () => this.end()));
    root.querySelectorAll<HTMLElement>('.tour-overlay').forEach((el) =>
      el.addEventListener('click', (e) => {
        if (e.target === el) this.end(); // backdrop click closes
      }));
    if (this.step !== null) {
      const s = TOUR_STEPS[this.step];
      const hl = root.querySelector('.tour-highlight') as HTMLElement | null;
      if (s.target && hl) {
        const target = root.querySelector(s.target);
        if (target) {
          const r = (target as HTMLElement).getBoundingClientRect();
          hl.style.display = 'block';
          hl.style.top = `${r.top}px`;
          hl.style.left = `${r.left}px`;
          hl.style.width = `${r.width}px`;
          hl.style.height = `${r.height}px`;
        } else {
          hl.style.display = 'none';
        }
      } else if (hl) {
        hl.style.display = 'none';
      }
    }
  }
}
