export type Num = number | null | undefined;

const ok = (v: Num): v is number => v != null && Number.isFinite(v);

export const clean = (xs: Num[]): number[] => xs.filter(ok);

export function mean(xs: Num[]): number | null {
  const c = clean(xs);
  return c.length ? c.reduce((a, b) => a + b, 0) / c.length : null;
}

export function sum(xs: Num[]): number {
  return clean(xs).reduce((a, b) => a + b, 0);
}

export function sd(xs: Num[]): number | null {
  const c = clean(xs);
  if (c.length < 2) return null;
  const m = c.reduce((a, b) => a + b, 0) / c.length;
  return Math.sqrt(c.reduce((a, b) => a + (b - m) ** 2, 0) / (c.length - 1));
}

export function quantile(xs: Num[], q: number): number | null {
  const c = clean(xs).sort((a, b) => a - b);
  if (!c.length) return null;
  const pos = (c.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return c[lo] + (c[hi] - c[lo]) * (pos - lo);
}

export const median = (xs: Num[]) => quantile(xs, 0.5);

/** Trailing rolling mean; needs at least `minN` valid points in the window. */
export function rolling(xs: Num[], window: number, minN = Math.ceil(window / 2)): (number | null)[] {
  const out: (number | null)[] = [];
  for (let i = 0; i < xs.length; i++) {
    let s = 0;
    let n = 0;
    for (let j = Math.max(0, i - window + 1); j <= i; j++) {
      const v = xs[j];
      if (ok(v)) {
        s += v;
        n++;
      }
    }
    out.push(n >= minN ? s / n : null);
  }
  return out;
}

export function rollingSd(xs: Num[], window: number): (number | null)[] {
  return xs.map((_, i) => sd(xs.slice(Math.max(0, i - window + 1), i + 1)));
}

/** Pairwise-complete Pearson correlation. */
export function pearson(a: Num[], b: Num[]): { r: number; n: number; p: number } | null {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (ok(a[i]) && ok(b[i])) {
      xs.push(a[i] as number);
      ys.push(b[i] as number);
    }
  }
  const n = xs.length;
  if (n < 5) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (!sxx || !syy) return null;
  const r = sxy / Math.sqrt(sxx * syy);
  const t = r * Math.sqrt((n - 2) / Math.max(1e-12, 1 - r * r));
  return { r, n, p: tTestP(t, n - 2) };
}

export function linreg(xs: number[], ys: number[]): { slope: number; intercept: number; r2: number } | null {
  const n = xs.length;
  if (n < 3) return null;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  if (!sxx) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r2: syy ? (sxy * sxy) / (sxx * syy) : 0 };
}

/** Welch's t-test between two samples. Returns two-sided p and Cohen's d. */
export function welch(a: Num[], b: Num[]): { t: number; p: number; d: number; ma: number; mb: number } | null {
  const x = clean(a);
  const y = clean(b);
  if (x.length < 3 || y.length < 3) return null;
  const ma = mean(x)!;
  const mb = mean(y)!;
  const va = sd(x)! ** 2;
  const vb = sd(y)! ** 2;
  const se = Math.sqrt(va / x.length + vb / y.length);
  if (!se) return null;
  const t = (ma - mb) / se;
  const df = (va / x.length + vb / y.length) ** 2 /
    ((va / x.length) ** 2 / (x.length - 1) + (vb / y.length) ** 2 / (y.length - 1));
  const pooled = Math.sqrt(((x.length - 1) * va + (y.length - 1) * vb) / (x.length + y.length - 2));
  return { t, p: tTestP(t, df), d: pooled ? (ma - mb) / pooled : 0, ma, mb };
}

// --- Student t distribution two-sided p-value via regularized incomplete beta
function tTestP(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return 1;
  const x = df / (df + t * t);
  return Math.min(1, Math.max(0, ibeta(x, df / 2, 0.5)));
}

function lgamma(z: number): number {
  const g = 7;
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61503916999185, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - lgamma(1 - z);
  z -= 1;
  let x = c[0];
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i);
  const t = z + g + 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

function ibeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(lgamma(a + b) - lgamma(a) - lgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (bt * betacf(x, a, b)) / a : 1 - (bt * betacf(1 - x, b, a)) / b;
}

function betacf(x: number, a: number, b: number): number {
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < 1e-30) d = 1e-30;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < 1e-30) d = 1e-30;
    c = 1 + aa / c;
    if (Math.abs(c) < 1e-30) c = 1e-30;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-7) break;
  }
  return h;
}

// --- dates
export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function weekday(iso: string): number {
  // 0 = Monday … 6 = Sunday
  return (new Date(iso + 'T12:00:00Z').getUTCDay() + 6) % 7;
}

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
}
