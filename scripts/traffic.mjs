#!/usr/bin/env node
/**
 * The clone graph in the README.
 *
 *   node scripts/traffic.mjs            → fetch, merge and redraw
 *   node scripts/traffic.mjs --render   → redraw from what is already stored
 *
 * GitHub keeps clone counts for fourteen days and hands them only to someone
 * with push access, so a README badge cannot fetch them and nothing older than
 * a fortnight can be recovered once it has gone. The only way to have a graph
 * that grows is to write the numbers down before they expire: this merges each
 * day's figures into docs/clones.json and redraws docs/clones.svg, and a
 * daily workflow commits the result.
 *
 * Merging is by date and takes the larger count, because the same day is seen
 * up to fourteen times and a later read of today is the more complete one.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DATA = 'docs/clones.json';
const CHART = 'docs/clones.svg';

/** The clone counts GitHub still has, via whatever credentials gh is using. */
function fetchClones(repo) {
  const raw = execFileSync('gh', ['api', `repos/${repo}/traffic/clones`], { encoding: 'utf8', maxBuffer: 1 << 20 });
  const body = JSON.parse(raw);
  if (!Array.isArray(body?.clones)) throw new Error('GitHub did not return a clone list.');
  return body.clones.map(day => ({
    date: String(day.timestamp).slice(0, 10),
    count: Number(day.count) || 0,
    uniques: Number(day.uniques) || 0
  }));
}

/** What has been kept so far, or an empty history. */
function load() {
  try {
    const stored = JSON.parse(fs.readFileSync(DATA, 'utf8'));
    return Array.isArray(stored?.days) ? stored.days : [];
  } catch { return []; }
}

/**
 * Fold today's reading into the history.
 *
 * A day already recorded keeps whichever count is larger: today is read again
 * tomorrow with its full total, and a partial day must never overwrite a
 * complete one.
 */
export function merge(existing, fresh) {
  const byDate = new Map(existing.map(day => [day.date, day]));
  for (const day of fresh) {
    const before = byDate.get(day.date);
    byDate.set(day.date, before
      ? { date: day.date, count: Math.max(before.count, day.count), uniques: Math.max(before.uniques, day.uniques) }
      : day);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/** `19 Sep` while the history is short, `Sep 2026` once it spans months. */
const label = (date, months) => {
  const [year, month, day] = date.split('-');
  const name = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month) - 1];
  return months ? `${name} ${year}` : `${Number(day)} ${name}`;
};
/** `524`, `1.2K`, `11K` — the axis has no room for thousands separators. */
const compact = n => n < 1000 ? String(n) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K` : `${Math.round(n / 1000)}K`;
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Steps a person would have chosen, as multiples of a power of ten. */
const LADDER = [1, 1.5, 2, 2.5, 3, 4, 5, 10];

/** A gridline step giving about four lines, landing on a round number. */
export function niceStep(peak, lines = 4) {
  const rough = Math.max(1, peak) / lines;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const pick = LADDER.find(rung => rough / magnitude <= rung) ?? 10;
  return pick * magnitude;
}

/**
 * The top of the axis: a whole number of steps, with a little room above the
 * line so the end dot is not cut in half by the frame. Without the headroom a
 * total that lands exactly on a step draws along the very top edge.
 */
export function ceilingFor(peak, step) {
  return Math.max(step, Math.ceil((peak * 1.08) / step) * step);
}

/** Each day's total added to everything before it. */
export function cumulative(days) {
  let running = 0;
  return days.map(day => ({ date: day.date, total: (running += day.count) }));
}

/**
 * The chart, as an SVG the README can point at.
 *
 * A running total rather than a bar a day: the daily figure is noisy and mostly
 * zero, and the thing worth seeing is the shape of the curve. Drawn here rather
 * than fetched from a service, so the README has no third party in it and works
 * offline in a clone. GitHub renders the file itself, so the light and dark
 * rules below are honoured.
 */
export function render(days, repo = 'amargoyal/notchlight') {
  const points = cumulative(days);
  const W = 880, H = 320;
  const left = 62, right = 26, top = 78, bottom = 52;
  const plotW = W - left - right, plotH = H - top - bottom;
  const total = points.length ? points[points.length - 1].total : 0;
  const step = niceStep(total);
  const ceiling = ceilingFor(total, step);
  const lines = Math.round(ceiling / step);
  // One point cannot be a line; a flat one still reads as "nothing yet".
  const x = i => points.length < 2 ? left + plotW : left + (i / (points.length - 1)) * plotW;
  const y = value => top + plotH - (value / ceiling) * plotH;

  const grid = Array.from({ length: lines + 1 }, (_, i) => {
    const value = step * i;
    return `<line x1="${left}" y1="${y(value).toFixed(1)}" x2="${W - right}" y2="${y(value).toFixed(1)}" class="grid"/>`
      + `<text x="${left - 12}" y="${(y(value) + 4).toFixed(1)}" class="axis" text-anchor="end">${compact(value)}</text>`;
  }).join('\n  ');

  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.total).toFixed(1)}`).join(' ');
  const area = points.length
    ? `${path} L${x(points.length - 1).toFixed(1)} ${(top + plotH).toFixed(1)} L${x(0).toFixed(1)} ${(top + plotH).toFixed(1)} Z`
    : '';

  // Roughly five labels, always including the first and the last day — and the
  // last one wins: a regular tick landing a day before it would overprint it.
  const months = points.length > 120;
  const every = Math.max(1, Math.round((points.length - 1) / 4));
  const marks = [];
  for (let i = 0; i < points.length; i += every) marks.push(i);
  const end = points.length - 1;
  while (marks.length && end - marks[marks.length - 1] < every / 2) marks.pop();
  if (marks[marks.length - 1] !== end) marks.push(end);
  const ticks = marks.map(i =>
    `<text x="${x(i).toFixed(1)}" y="${H - 22}" class="axis" text-anchor="${i === 0 ? 'start' : i === end ? 'end' : 'middle'}">${label(points[i].date, months)}</text>`
  ).join('\n  ');

  const last = points[points.length - 1];
  const updated = new Date().toISOString().slice(0, 10);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Clone history for ${escape(repo)}: ${total} clones over ${points.length} days">
  <style>
    .card { fill: #fbf9f6; stroke: #e2dbd1; }
    .grid { stroke: #e7e0d6; stroke-width: 1; }
    .axis { font: 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #8a817a; }
    .title { font: 700 21px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #302922; }
    .sub { font: 14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #8a817a; }
    .total { font: 700 15px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #6b6258; }
    .foot { font: 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #a49a90; }
    .line { fill: none; stroke: #c97c5c; stroke-width: 2.5; stroke-linejoin: round; stroke-linecap: round; }
    .fill { fill: #c97c5c; opacity: .11; }
    .dot { fill: #c97c5c; }
    @media (prefers-color-scheme: dark) {
      .card { fill: #161514; stroke: #2b2724; }
      .grid { stroke: #2b2724; }
      .axis { fill: #8d8279; }
      .title { fill: #f0e7dc; }
      .sub { fill: #8d8279; }
      .total { fill: #b3a79a; }
      .foot { fill: #6f665e; }
      .line { stroke: #d4896a; }
      .fill { fill: #d4896a; opacity: .12; }
      .dot { fill: #d4896a; }
    }
  </style>
  <rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="12" class="card"/>
  <text x="${left - 28}" y="40" class="title">Clone History</text>
  <text x="${left - 28}" y="62" class="sub">${escape(repo)}</text>
  <text x="${W - right}" y="40" class="total" text-anchor="end">${total.toLocaleString('en-US')} clones</text>
  ${grid}
  ${area ? `<path d="${area}" class="fill"/>` : ''}
  ${points.length ? `<path d="${path}" class="line"/>` : ''}
  ${last ? `<circle cx="${x(points.length - 1).toFixed(1)}" cy="${y(last.total).toFixed(1)}" r="5" class="dot"/>` : ''}
  ${ticks}
  <text x="${W - right}" y="${H - 12}" class="foot" text-anchor="end">Updated ${updated}</text>
</svg>
`;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const repo = process.env.GITHUB_REPOSITORY || 'amargoyal/notchlight';
  const days = process.argv.includes('--render') ? load() : merge(load(), fetchClones(repo));
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify({ repo, updated: new Date().toISOString().slice(0, 10), days }, null, 2) + '\n');
  fs.writeFileSync(CHART, render(days, repo));
  console.log(`${days.length} days recorded, ${days.reduce((n, d) => n + d.count, 0)} clones in total → ${CHART}`);
}
