import type { CSSProperties } from 'react'

type Props = { size?: number; style?: CSSProperties; strokeWidth?: number; className?: string }

function base({ size = 18, strokeWidth = 1.5, style, className, children }: Props & { children: React.ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, display: 'inline-block', ...style }} className={className}>
      {children}
    </svg>
  )
}

export const IconMenu       = (p: Props) => base({ ...p, children: <><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="17" x2="20" y2="17" /></> })
export const IconBell       = (p: Props) => base({ ...p, children: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 21a2 2 0 0 0 4 0" /></> })
export const IconClose      = (p: Props) => base({ ...p, children: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></> })
export const IconSearch     = (p: Props) => base({ ...p, children: <><circle cx="11" cy="11" r="6.5" /><line x1="20" y1="20" x2="16.5" y2="16.5" /></> })
export const IconSettings   = (p: Props) => base({ ...p, children: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.01a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.01a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></> })
export const IconArrowUp    = (p: Props) => base({ ...p, children: <><line x1="12" y1="19" x2="12" y2="5" /><polyline points="5 12 12 5 19 12" /></> })
export const IconArrowDown  = (p: Props) => base({ ...p, children: <><line x1="12" y1="5" x2="12" y2="19" /><polyline points="19 12 12 19 5 12" /></> })
export const IconChevronLeft  = (p: Props) => base({ ...p, children: <polyline points="15 6 9 12 15 18" /> })
export const IconChevronRight = (p: Props) => base({ ...p, children: <polyline points="9 6 15 12 9 18" /> })
export const IconChevronsLeft  = (p: Props) => base({ ...p, children: <><polyline points="11 6 5 12 11 18" /><polyline points="18 6 12 12 18 18" /></> })
export const IconChevronsRight = (p: Props) => base({ ...p, children: <><polyline points="13 6 19 12 13 18" /><polyline points="6 6 12 12 6 18" /></> })
export const IconPlay       = (p: Props) => base({ ...p, children: <polygon points="6 4 20 12 6 20 6 4" /> })
export const IconStop       = (p: Props) => base({ ...p, children: <rect x="6" y="6" width="12" height="12" rx="1" /> })
export const IconPlanning   = (p: Props) => base({ ...p, children: <><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="16" y1="3" x2="16" y2="7" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="3" y1="10" x2="21" y2="10" /></> })
export const IconHome       = (p: Props) => base({ ...p, children: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1V10" /></> })
export const IconCheck      = (p: Props) => base({ ...p, children: <polyline points="5 12 10 17 19 7" /> })
export const IconCheckList  = (p: Props) => base({ ...p, children: <><polyline points="3 7 5 9 9 5" /><polyline points="3 14 5 16 9 12" /><line x1="13" y1="7" x2="20" y2="7" /><line x1="13" y1="14" x2="20" y2="14" /></> })
export const IconUsers      = (p: Props) => base({ ...p, children: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3 2.7-5.5 6-5.5s6 2.5 6 5.5" /><circle cx="17" cy="9" r="2.5" /><path d="M21 19c0-2.3-1.8-4-4-4" /></> })
export const IconUserPlus   = (p: Props) => base({ ...p, children: <><circle cx="9" cy="8" r="3.5" /><path d="M3 20c0-3 2.7-5.5 6-5.5s6 2.5 6 5.5" /><line x1="19" y1="6" x2="19" y2="12" /><line x1="16" y1="9" x2="22" y2="9" /></> })
export const IconBuilding   = (p: Props) => base({ ...p, children: <><rect x="4" y="4" width="16" height="16" rx="1" /><line x1="8" y1="8" x2="10" y2="8" /><line x1="14" y1="8" x2="16" y2="8" /><line x1="8" y1="12" x2="10" y2="12" /><line x1="14" y1="12" x2="16" y2="12" /><line x1="8" y1="16" x2="10" y2="16" /><line x1="14" y1="16" x2="16" y2="16" /></> })
export const IconActivity   = (p: Props) => base({ ...p, children: <polyline points="3 12 7 12 9 5 13 19 15 12 21 12" /> })
export const IconKey        = (p: Props) => base({ ...p, children: <><circle cx="8" cy="14" r="4" /><path d="M11 11l9-9" /><line x1="17" y1="5" x2="20" y2="8" /><line x1="14" y1="8" x2="17" y2="11" /></> })
export const IconDocument   = (p: Props) => base({ ...p, children: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><polyline points="14 3 14 8 19 8" /></> })
export const IconShare      = (p: Props) => base({ ...p, children: <><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.6" y1="13.5" x2="15.4" y2="17.5" /><line x1="15.4" y1="6.5" x2="8.6" y2="10.5" /></> })
export const IconDownload   = (p: Props) => base({ ...p, children: <><path d="M5 17v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3" /><polyline points="7 11 12 16 17 11" /><line x1="12" y1="3" x2="12" y2="15" /></> })
export const IconFilter     = (p: Props) => base({ ...p, children: <polygon points="3 5 21 5 14 13 14 19 10 21 10 13 3 5" /> })
export const IconSort       = (p: Props) => base({ ...p, children: <><line x1="7" y1="6" x2="7" y2="18" /><polyline points="3 10 7 6 11 10" /><line x1="17" y1="6" x2="17" y2="18" /><polyline points="21 14 17 18 13 14" /></> })
export const IconHourglass  = (p: Props) => base({ ...p, children: <><line x1="6" y1="3" x2="18" y2="3" /><line x1="6" y1="21" x2="18" y2="21" /><path d="M7 3v3c0 2 2 3 5 6 3-3 5-4 5-6V3" /><path d="M7 21v-3c0-2 2-3 5-6 3 3 5 4 5 6v3" /></> })
export const IconAlert      = (p: Props) => base({ ...p, children: <><path d="M12 3l10 18H2z" /><line x1="12" y1="10" x2="12" y2="15" /><line x1="12" y1="18" x2="12" y2="18.5" /></> })
export const IconClock      = (p: Props) => base({ ...p, children: <><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12 16 14" /></> })
export const IconComment    = (p: Props) => base({ ...p, children: <path d="M4 5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H10l-4 4v-4H6a2 2 0 0 1-2-2z" /> })
export const IconRange      = (p: Props) => base({ ...p, children: <><line x1="4" y1="12" x2="20" y2="12" /><polyline points="9 7 4 12 9 17" /><polyline points="15 7 20 12 15 17" /></> })
export const IconMore       = (p: Props) => base({ ...p, children: <><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></> })
export const IconRocket     = (p: Props) => base({ ...p, children: <><path d="M14 4l6 6-7 7-3 1-3-3 1-3 6-7c.6-.6 1.4-1 2-1z" /><line x1="9" y1="15" x2="6" y2="18" /><circle cx="15" cy="9" r="1.5" /></> })
export const IconLogo       = (p: Props) => base({ ...p, children: <polyline points="3 6 9 13 9 18" /> })
export const IconLogoutOutline = (p: Props) => base({ ...p, children: <><path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4" /><polyline points="14 8 19 12 14 16" /><line x1="9" y1="12" x2="19" y2="12" /></> })
export const IconSun        = (p: Props) => base({ ...p, children: <><circle cx="12" cy="12" r="4" /><line x1="12" y1="3" x2="12" y2="5" /><line x1="12" y1="19" x2="12" y2="21" /><line x1="3" y1="12" x2="5" y2="12" /><line x1="19" y1="12" x2="21" y2="12" /><line x1="5.6" y1="5.6" x2="7" y2="7" /><line x1="17" y1="17" x2="18.4" y2="18.4" /><line x1="5.6" y1="18.4" x2="7" y2="17" /><line x1="17" y1="7" x2="18.4" y2="5.6" /></> })
export const IconMoon       = (p: Props) => base({ ...p, children: <path d="M20 14a8 8 0 1 1-9-9 6 6 0 0 0 9 9z" /> })
export const IconAuto       = (p: Props) => base({ ...p, children: <><circle cx="12" cy="12" r="9" /><path d="M12 3v18" /><path d="M3 12h18" /></> })
export const IconChart      = (p: Props) => base({ ...p, children: <><line x1="4" y1="20" x2="20" y2="20" /><rect x="6" y="11" width="3" height="9" /><rect x="11" y="6" width="3" height="14" /><rect x="16" y="14" width="3" height="6" /></> })
export const IconCalendar   = (p: Props) => base({ ...p, children: <><rect x="3" y="5" width="18" height="16" rx="2" /><line x1="16" y1="3" x2="16" y2="7" /><line x1="8" y1="3" x2="8" y2="7" /><line x1="3" y1="10" x2="21" y2="10" /></> })
export const IconBoard      = (p: Props) => base({ ...p, children: <><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="9" x2="9" y2="21" /></> })
export const IconFolder     = (p: Props) => base({ ...p, children: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /> })
export const IconFolderOpen = (p: Props) => base({ ...p, children: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2H3zm0 2h18l-2 8a2 2 0 0 1-2 1.5H5a2 2 0 0 1-2-1.5z" /> })
export const IconRefresh    = (p: Props) => base({ ...p, children: <><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" /><path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" /></> })
