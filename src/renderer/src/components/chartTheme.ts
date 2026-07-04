import React from 'react'

// Chart chrome + the validated income/spending pair (see dataviz palette check):
// light surface #ffffff -> income #008300 / spending #e34948
// dark  surface #1e293b -> income #0ca30c / spending #e66767
export function chartTheme(dark: boolean): {
  income: string
  spending: string
  accent: string
  accentSoft: string
  grid: string
  ink: string
  surface: string
} {
  return dark
    ? {
        income: '#0ca30c',
        spending: '#e66767',
        accent: '#3987e5',
        accentSoft: '#86b6ef',
        grid: '#334155',
        ink: '#94a3b8',
        surface: '#1e293b'
      }
    : {
        income: '#008300',
        spending: '#e34948',
        accent: '#2a78d6',
        accentSoft: '#6da7ec',
        grid: '#e2e8f0',
        ink: '#64748b',
        surface: '#ffffff'
      }
}

export function tooltipStyle(dark: boolean): React.CSSProperties {
  return {
    backgroundColor: dark ? '#0f172a' : '#ffffff',
    border: `1px solid ${dark ? '#334155' : '#e2e8f0'}`,
    borderRadius: 8,
    fontSize: 12,
    color: dark ? '#f1f5f9' : '#0f172a'
  }
}
