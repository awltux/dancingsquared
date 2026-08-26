// Preview: a top-down, 2D SVG board view of a module/tip. Dancers are squares
// (men) or circles (women), coloured by home couple, numbered, with a triangle
// marking their front. It is animated by stepping the Sequencer beat forward
// through the call sequence. Owns the preview state + animation timer and the
// SVG rendering, plus the event wiring for its overlay.

import type { Sequencer } from 'dancing-squared-engine';

interface PreviewState {
  titles: string[];
  beat: number;
  total: number; // total beats in the sequence
  playing: boolean;
  timer?: number;
  trail: { x: number; y: number }[][]; // cached path per dancer for the current call
  trailKey: string; // identifies which call the cached trail belongs to
  view: { minX: number; maxX: number; minY: number; maxY: number }; // fixed zoom for the whole sequence
}

const COUPLE_HEX = ['#e33b3b', '#e8c23a', '#3fbf6f', '#3b7ee8']; // 1 red, 2 yellow, 3 green, 4 blue
const PREVIEW_BPM = 64; // playback tempo for the 2D preview

export class Preview {
  private state: PreviewState | null = null;

  constructor(
    private readonly seq: Sequencer,
    private readonly root: HTMLElement,
    private readonly render: () => void,
  ) {}

  /** Whether a preview is currently open. */
  get active(): boolean {
    return this.state !== null;
  }

  /** Open a preview for a sequence of call titles. */
  open(titles: string[]): void {
    const total = Math.round(this.seq.evaluateSequence(titles, 1e9).beats);
    this.cancelTimer();
    this.state = {
      titles,
      beat: 0,
      total,
      playing: false,
      trail: this.computeTrail(titles, 0),
      trailKey: this.callKey(titles, 0),
      view: this.sequenceBounds(titles),
    };
    this.render();
  }

  /** Markup for the open preview overlay (empty string when closed). */
  overlay(): string {
    if (!this.state) return '';
    const p = this.state;
    return `
    <div class="overlay" data-closepreview>
      <div class="modal preview-modal">
        <h2>Preview</h2>
        <div class="preview-board" id="previewBoard">${this.boardSVG(p.titles, p.beat, p.trail, p.view)}</div>
        <input type="range" id="previewScrub" class="preview-scrub" min="0" max="${p.total}" step="1" value="${p.beat}" />
        <div class="preview-controls">
          <button class="big preview-play" data-prevplay>${p.playing ? '⏸' : '▶'}</button>
        </div>
        <div class="preview-call" id="previewCall">${this.callAt(p.titles, p.beat)}</div>
        <button class="big primary" data-prevclose style="margin-top:12px">Close</button>
      </div>
    </div>`;
  }

  /** Refresh the open preview overlay in place (no full re-render). */
  update(): void {
    if (!this.state) return;
    const p = this.state;
    const board = this.root.querySelector('#previewBoard') as HTMLElement | null;
    if (board) {
      const ck = this.callKey(p.titles, p.beat);
      if (p.trailKey !== ck) {
        p.trail = this.computeTrail(p.titles, p.beat);
        p.trailKey = ck;
      }
      board.innerHTML = this.boardSVG(p.titles, p.beat, p.trail, p.view);
    }
    const scrub = this.root.querySelector('#previewScrub') as HTMLInputElement | null;
    if (scrub) scrub.value = String(Math.min(p.beat, p.total));
    const call = this.root.querySelector('#previewCall') as HTMLElement | null;
    if (call) call.textContent = this.callAt(p.titles, p.beat);
    const play = this.root.querySelector('[data-prevplay]');
    if (play) play.textContent = p.playing ? '⏸' : '▶';
  }

  close(): void {
    this.cancelTimer();
    this.state = null;
    this.render();
  }

  togglePlay(): void {
    if (!this.state) return;
    this.state.playing = !this.state.playing;
    if (this.state.playing) {
      if (this.state.beat >= this.state.total) this.state.beat = 0;
      const MS_PER_BEAT = 60000 / PREVIEW_BPM;
      let last = performance.now();
      const frame = (now: number): void => {
        if (!this.state || !this.state.playing) return;
        const dt = Math.min(now - last, 250);
        last = now;
        this.state.beat += dt / MS_PER_BEAT;
        if (this.state.beat >= this.state.total) {
          this.state.beat = this.state.total;
          this.state.playing = false;
          this.state.timer = undefined;
          this.update();
          return;
        }
        this.update();
        this.state.timer = requestAnimationFrame(frame);
      };
      this.cancelTimer();
      this.state.timer = requestAnimationFrame(frame);
    } else {
      this.cancelTimer();
    }
    this.update();
  }

  private cancelTimer(): void {
    if (this.state && this.state.timer != null) cancelAnimationFrame(this.state.timer);
    if (this.state) this.state.timer = undefined;
  }

  /** Bind the preview's event handlers (called each render). */
  wire(root: HTMLElement): void {
    root.querySelectorAll<HTMLElement>('[data-preview]').forEach((el) =>
      el.addEventListener('click', () => {
        let titles: string[] = [];
        try { titles = JSON.parse(el.dataset.preview || '[]'); } catch { titles = []; }
        this.open(titles);
      }));
    root.querySelectorAll<HTMLElement>('[data-prevclose]').forEach((el) =>
      el.addEventListener('click', () => this.close()));
    root.querySelectorAll<HTMLElement>('[data-closepreview]').forEach((el) =>
      el.addEventListener('click', (e) => {
        if ((e.target as HTMLElement).classList.contains('overlay')) this.close();
      }));
    root.querySelectorAll<HTMLElement>('[data-prevplay]').forEach((el) =>
      el.addEventListener('click', () => this.togglePlay()));
    root.querySelectorAll<HTMLInputElement>('#previewScrub').forEach((el) =>
      el.addEventListener('input', () => {
        if (!this.state) return;
        this.cancelTimer();
        this.state.playing = false;
        this.state.beat = +el.value;
        this.update();
      }));
  }

  // ---------------------------------------------------------------- SVG rendering

  private callBounds(titles: string[], beat: number): { start: number; end: number } {
    const name = this.seq.sequenceInfo(titles, beat)?.name;
    if (!name) return { start: 0, end: 0 };
    let start = beat;
    while (start > 0 && this.seq.sequenceInfo(titles, start - 1)?.name === name) start--;
    let end = beat;
    while (this.seq.sequenceInfo(titles, end + 1)?.name === name) end++;
    return { start, end };
  }

  private callKey(titles: string[], beat: number): string {
    const name = this.seq.sequenceInfo(titles, beat)?.name ?? '';
    return `${name}|${this.callBounds(titles, beat).start}`;
  }

  private sequenceBounds(titles: string[]): { minX: number; maxX: number; minY: number; maxY: number } {
    const total = Math.round(this.seq.evaluateSequence(titles, 1e9).beats);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const steps = Math.max(10, total);
    for (let s = 0; s <= steps; s++) {
      const bo = this.seq.evaluateSequence(titles, (total * s) / steps).board;
      bo.dancers.forEach((d) => {
        minX = Math.min(minX, d.x); maxX = Math.max(maxX, d.x);
        minY = Math.min(minY, d.y); maxY = Math.max(maxY, d.y);
      });
    }
    const pad = 0.5;
    return { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: maxY + pad };
  }

  private computeTrail(titles: string[], beat: number): { x: number; y: number }[][] {
    const { start, end } = this.callBounds(titles, beat);
    const N = this.seq.evaluateSequence(titles, beat).board.dancers.length;
    const trails: { x: number; y: number }[][] = Array.from({ length: N }, () => []);
    if (end <= start) {
      const bo = this.seq.evaluateSequence(titles, beat).board;
      bo.dancers.forEach((d, i) => trails[i].push({ x: d.x, y: d.y }));
      return trails;
    }
    const steps = Math.max(4, Math.round((end - start) * 3));
    for (let s = 0; s <= steps; s++) {
      const b = start + ((end - start) * s) / steps;
      const bo = this.seq.evaluateSequence(titles, b).board;
      bo.dancers.forEach((d, i) => trails[i].push({ x: d.x, y: d.y }));
    }
    return trails;
  }

  private boardSVG(
    titles: string[],
    beat: number,
    trail: { x: number; y: number }[][],
    view: { minX: number; maxX: number; minY: number; maxY: number },
  ): string {
    const board = this.seq.evaluateSequence(titles, beat).board;
    const ds = board.dancers;
    const rx = view.maxX - view.minX || 1, ry = view.maxY - view.minY || 1;
    const W = 460, H = 460, pad = 40, R = 14;
    const sx = (x: number) => pad + ((x - view.minX) / rx) * (W - 2 * pad);
    const sy = (y: number) => H - pad - ((y - view.minY) / ry) * (H - 2 * pad);
    const path = trail.map((t, i) => {
      if (t.length < 2) return '';
      const color = COUPLE_HEX[(ds[i].couple - 1) % COUPLE_HEX.length] ?? '#9aa6b2';
      const pts = t.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ');
      return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" opacity="0.45" stroke-linejoin="round" stroke-linecap="round"/>`;
    }).join('');
    const icons = ds.map((d) => {
      const color = COUPLE_HEX[(d.couple - 1) % COUPLE_HEX.length] ?? '#9aa6b2';
      const cx = sx(d.x), cy = sy(d.y);
      const deg = -((d.heading * 180) / Math.PI);
      const shape = d.gender === 'boy'
        ? `<rect x="${-R}" y="${-R}" width="${2 * R}" height="${2 * R}" rx="4" fill="${color}" stroke="#fff" stroke-width="2"/>`
        : `<circle r="${R}" fill="${color}" stroke="#fff" stroke-width="2"/>`;
      const front = `<polygon points="${R},0 ${R - 6},-5 ${R - 6},5" fill="#fff"/>`;
      return `<g transform="translate(${cx},${cy}) rotate(${deg})">${shape}${front}</g>
      <text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="bold" fill="#fff" pointer-events="none">${d.couple}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Top-down board view">${path}${icons}</svg>`;
  }

  private callAt(titles: string[], beat: number): string {
    const info = this.seq.sequenceInfo(titles, beat);
    return info ? info.name : '…';
  }
}
