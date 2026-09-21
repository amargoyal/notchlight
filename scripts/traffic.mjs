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
 * day's figures into docs/traffic.json and redraws docs/traffic.svg, and a
 * daily workflow commits the result.
 *
 * Merging is by date and takes the larger count, because the same day is seen
 * up to fourteen times and a later read of today is the more complete one.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const DATA = 'docs/traffic.json';
const CHART = 'docs/traffic.svg';
/** Days drawn. Enough to show a shape without the bars becoming hairlines. */
const WINDOW = 60;

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

/** `19 Sep`, for an axis that has to stay narrow. */
const label = date => {
  const [, month, day] = date.split('-');
  return `${Number(day)} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month) - 1]}`;
};
const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The chart, as an SVG the README can point at.
 *
 * Drawn rather than fetched from a service, so the README has no third party in
 * it and works offline in a clone. Two colours use the app's own palette, and
 * both light and dark readers get legible text through a media query — GitHub
 * renders the file itself, so the query is honoured.
 */
export function render(days) {
  const shown = days.slice(-WINDOW);
  const W = 880, H = 260;
  const left = 44, right = 16, top = 22, bottom = 34;
  const plotW = W - left - right, plotH = H - top - bottom;
  const peak = Math.max(1, ...shown.map(d => d.count));
  // A round ceiling, so the gridline labels are numbers anyone would choose.
  const step = Math.max(1, Math.ceil(peak / 4 / 5) * 5);
  const ceiling = step * 4;
  const slot = plotW / Math.max(1, shown.length);
  const barW = Math.max(1, Math.min(14, slot - 2));
  const y = value => top + plotH - (value / ceiling) * plotH;

  const grid = Array.from({ length: 5 }, (_, i) => {
    const value = step * i;
    return `<line x1="${left}" y1="${y(value).toFixed(1)}" x2="${W - right}" y2="${y(value).toFixed(1)}" class="grid"/>`
      + `<text x="${left - 8}" y="${(y(value) + 4).toFixed(1)}" class="axis" text-anchor="end">${value}</text>`;
  }).join('');

  const bars = shown.map((day, i) => {
    const x = left + i * slot + (slot - barW) / 2;
    const total = `<rect x="${x.toFixed(1)}" y="${y(day.count).toFixed(1)}" width="${barW.toFixed(1)}" height="${(top + plotH - y(day.count)).toFixed(1)}" rx="2" class="total"/>`;
    const unique = `<rect x="${x.toFixed(1)}" y="${y(day.uniques).toFixed(1)}" width="${barW.toFixed(1)}" height="${(top + plotH - y(day.uniques)).toFixed(1)}" rx="2" class="unique"/>`;
    return `<g><title>${escape(day.date)}: ${day.count} clones, ${day.uniques} unique</title>${total}${unique}</g>`;
  }).join('');

  // Every few days, or the axis becomes a smear at sixty of them.
  const every = Math.max(1, Math.ceil(shown.length / 8));
  const ticks = shown.map((day, i) => i % every === 0 || i === shown.length - 1
    ? `<text x="${(left + i * slot + slot / 2).toFixed(1)}" y="${H - 12}" class="axis" text-anchor="middle">${label(day.date)}</text>` : '')
    .join('');

  const totals = shown.reduce((sum, day) => sum + day.count, 0);
  // Deliberately not a total of the daily uniques. The same person cloning on
  // two days is unique on both, so adding them up gives a number larger than
  // the count of people, and printing that beside the clone total would read as
  // "185 different people" when GitHub's own fortnight figure was 168.
  const since = shown.length ? label(shown[0].date) : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Clones per day since ${since}: ${totals} clones in ${shown.length} days">
  <style>
    .bg { fill: #fbf9f6; }
    .grid { stroke: #e2dbd1; stroke-width: 1; }
    .axis { font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; fill: #8a817a; }
    .title { font: 600 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #302922; }
    .key { font: 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; fill: #6b6258; }
    .total { fill: #c97c5c; }
    .unique { fill: #8a5238; }
    @media (prefers-color-scheme: dark) {
      .bg { fill: #1d1b19; }
      .grid { stroke: #332e29; }
      .axis { fill: #8d8279; }
      .title { fill: #f0e7dc; }
      .key { fill: #b3a79a; }
      .total { fill: #d4896a; }
      .unique { fill: #e6b9a4; }
    }
  </style>
  <rect width="${W}" height="${H}" rx="8" class="bg"/>
  <text x="${left}" y="15" class="title">Clones per day</text>
  <text x="${W - right}" y="15" class="key" text-anchor="end">${totals} clones since ${escape(since)}</text>
  <g transform="translate(${left + 108}, 8)">
    <rect width="9" height="9" rx="2" class="total"/><text x="14" y="8" class="key">clones</text>
    <rect x="66" width="9" height="9" rx="2" class="unique"/><text x="80" y="8" class="key">unique that day</text>
  </g>
  ${grid}
  ${bars}
  ${ticks}
</svg>
`;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const repo = process.env.GITHUB_REPOSITORY || 'amargoyal/notchlight';
  const days = process.argv.includes('--render') ? load() : merge(load(), fetchClones(repo));
  fs.mkdirSync('docs', { recursive: true });
  fs.writeFileSync(DATA, JSON.stringify({ repo, updated: new Date().toISOString().slice(0, 10), days }, null, 2) + '\n');
  fs.writeFileSync(CHART, render(days));
  const window = days.slice(-WINDOW);
  console.log(`${days.length} days recorded, ${window.reduce((n, d) => n + d.count, 0)} clones in the last ${window.length} → ${CHART}`);
}
