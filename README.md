# Pulse Lab — deep analytics for your Fitbit data

A private, browser-only analytics platform for Fitbit / Google Health data
(works with Fitbit Air and any other Fitbit tracker). Import your Google
Takeout export and explore it far beyond what the Fitbit / Google Health app
shows. **Nothing is uploaded** — parsing and analysis run entirely in your
browser, and data is stored locally in IndexedDB.

## What you get

| View | Highlights |
|---|---|
| **Overview** | KPI tiles with change vs the previous period, top auto-insights, trend explorer with 7/28-day rolling means and a ±1σ band, calendar heatmap for any metric, data-coverage check |
| **Insights** | Significant trends (regression + p-value), strain/possible-illness detector (RHR↑ + HRV↓ + skin temp↑ vs your own 30-day baseline), weekday rhythm, sleep regularity & social jetlag, streaks, sleep debt, personal records |
| **Activity** | Daily steps vs goal, hour × weekday heatmap, weekday box plots, weekly intensity mix, distribution |
| **Heart** | Resting HR with strain flags, heart-rate "fingerprint" (every day × every 30 min), intraday HR with zone bands + hourly steps, time in zones, daily HR rhythm, HRV |
| **Sleep** | Sleep schedule (bedtime→wake bars), stages per night, composition, hypnogram per night, cumulative sleep debt, weekday pattern, sleep score |
| **Recovery** | Readiness, HRV, skin-temperature deviation, SpO₂, breathing rate, stress management |
| **Workouts** | Weekly training volume, per-activity summary, intensity vs duration scatter, full log |
| **Correlation lab** | Full correlation matrix, scatter explorer with regression, r, p and lagged (next-day / +2 days) effects, ranked strongest relationships |
| **Compare** | Any two periods, weekend vs weekday, workout vs rest days, or after ≥7 h sleep vs less — Welch t-test + Cohen's d for every metric |
| **Data table** | Every daily metric in one table, CSV export |

## Getting your data

1. Open <https://takeout.google.com> with the Google account linked to your Fitbit.
2. *Deselect all* → tick **Fitbit** → *Export once* as **.zip**.
3. When the download is ready, open Pulse Lab → **Import & settings** and drop the ZIP
   (or choose the extracted `Fitbit` folder).

Recognised files: `Global Export Data/*` (steps, heart_rate, resting_heart_rate,
calories, distance, active minutes, sleep, exercise, weight) plus the CSV
folders for HRV, SpO₂, temperature, respiratory rate, sleep score, stress,
readiness and Active Zone Minutes. Any CSV with a `date` column and columns like
`steps`, `resting_heart_rate`, `hrv`, `sleep_minutes`… is also accepted.

> Minute-level heart rate and steps are stored in UTC in some exports. If the hourly
> charts look shifted, set your UTC offset under *Import & settings* and re-import.

No data yet? Click **Load demo data** to explore a realistic synthetic year.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # static site in dist/
```

The included GitHub Actions workflow publishes `dist/` to GitHub Pages on every
push to `main`/`master` (enable *Settings → Pages → Source: GitHub Actions*).

## Tech

React + TypeScript + Vite, Apache ECharts, JSZip (in a Web Worker), idb-keyval.
Statistics (rolling stats, Pearson r with p-values, OLS, Welch's t-test) are
implemented in `src/lib/stats.ts`.

*Pulse Lab is not a medical device; insights are statistical patterns, not diagnoses.*
