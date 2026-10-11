import { createContext, useContext } from 'react';

export interface Tokens {
  dark: boolean;
  surface: string;
  page: string;
  ink: string;
  ink2: string;
  muted: string;
  grid: string;
  axis: string;
  series: string[]; // categorical, fixed order
  seq: string[]; // sequential blue ramp light→dark
  diverging: [string, string, string]; // neg, mid, pos
  good: string;
  warning: string;
  serious: string;
  critical: string;
  stage: { deep: string; light: string; rem: string; wake: string };
}

const SEQ_LIGHT = ['#cde2fb', '#9ec5f4', '#6da7ec', '#3987e5', '#256abf', '#184f95', '#0d366b'];
const SEQ_DARK = ['#1d2a3a', '#0d366b', '#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6'];

export const LIGHT: Tokens = {
  dark: false,
  surface: '#fcfcfb',
  page: '#f9f9f7',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  axis: '#c3c2b7',
  series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
  seq: SEQ_LIGHT,
  diverging: ['#2a78d6', '#f0efec', '#e34948'],
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
  // sleep stages: ordered depth ramp (deep darkest) + wake in orange
  stage: { deep: '#184f95', light: '#6da7ec', rem: '#6250d6', wake: '#eb6834' },
};

export const DARK: Tokens = {
  dark: true,
  surface: '#1a1a19',
  page: '#0d0d0d',
  ink: '#f0efec',
  ink2: '#c3c2b7',
  muted: '#898781',
  grid: '#2c2c2a',
  axis: '#383835',
  series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
  seq: SEQ_DARK,
  diverging: ['#3987e5', '#383835', '#e66767'],
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
  stage: { deep: '#256abf', light: '#86b6ef', rem: '#9085e9', wake: '#d95926' },
};

export const ThemeCtx = createContext<Tokens>(LIGHT);
export const useTokens = () => useContext(ThemeCtx);
