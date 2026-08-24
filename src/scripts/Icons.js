import React from 'react'

// Stroke icons on a 24px grid, drawn inline so no icon font or sprite has to be
// fetched and every glyph inherits the current text colour.
function Icon(props) {
    return (
        <svg width={props.size || 16} height={props.size || 16} viewBox="0 0 24 24"
             fill="none" stroke="currentColor" strokeWidth={props.stroke || 1.5}
             strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"
             focusable="false">
            {props.children}
        </svg>
    )
}

export const Shield = (p) => (
    <Icon {...p}>
        <path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z" />
        <path d="M12 11v3" />
        <circle cx="12" cy="9" r="0.6" fill="currentColor" />
    </Icon>
)

export const Upload = (p) => (
    <Icon {...p}>
        <path d="M12 15V4" />
        <path d="M8 8l4-4 4 4" />
        <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" />
    </Icon>
)

export const FileIcon = (p) => (
    <Icon {...p}>
        <path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" />
        <path d="M14 3v5h5" />
    </Icon>
)

export const TextIcon = (p) => (
    <Icon {...p}>
        <path d="M5 7h14" />
        <path d="M5 12h10" />
        <path d="M5 17h7" />
    </Icon>
)

export const ImageIcon = (p) => (
    <Icon {...p}>
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <circle cx="9" cy="10" r="1.4" />
        <path d="M5 17l4.5-4 3 2.5L16 12l3 3" />
    </Icon>
)

export const Copy = (p) => (
    <Icon {...p}>
        <rect x="9" y="9" width="11" height="11" rx="2" />
        <path d="M15 5H6a2 2 0 00-2 2v9" />
    </Icon>
)

export const Trash = (p) => (
    <Icon {...p}>
        <path d="M4 7h16" />
        <path d="M9 7V5h6v2" />
        <path d="M6 7l1 13h10l1-13" />
    </Icon>
)

export const MoreTime = (p) => (
    <Icon {...p}>
        <path d="M20.5 12a8.5 8.5 0 10-8.5 8.5" />
        <path d="M12 8v4l3 2" />
        <path d="M17 19h6" />
        <path d="M20 16v6" />
    </Icon>
)

export const Qr = (p) => (
    <Icon {...p}>
        <rect x="4" y="4" width="6" height="6" rx="1" />
        <rect x="14" y="4" width="6" height="6" rx="1" />
        <rect x="4" y="14" width="6" height="6" rx="1" />
        <path d="M14 14h2v2h-2z" fill="currentColor" stroke="none" />
        <path d="M18 18h2v2h-2z" fill="currentColor" stroke="none" />
        <path d="M14 20h2" />
        <path d="M18 14h2" />
    </Icon>
)

export const Share = (p) => (
    <Icon {...p}>
        <path d="M14 4h6v6" />
        <path d="M20 4l-8 8" />
        <path d="M18 14v4a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h4" />
    </Icon>
)

export const Lock = (p) => (
    <Icon {...p}>
        <rect x="5" y="10" width="14" height="10" rx="2" />
        <path d="M8 10V8a4 4 0 018 0v2" />
    </Icon>
)

export const Check = (p) => (
    <Icon {...p}>
        <path d="M5 12.5l4.5 4.5L19 7.5" />
    </Icon>
)

export const AlertIcon = (p) => (
    <Icon {...p}>
        <path d="M12 4l9 16H3l9-16z" />
        <path d="M12 10v4" />
        <circle cx="12" cy="17" r="0.6" fill="currentColor" />
    </Icon>
)

export const Info = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 11v5" />
        <circle cx="12" cy="8" r="0.6" fill="currentColor" />
    </Icon>
)

export const ChevronDown = (p) => (
    <Icon {...p}>
        <path d="M6 9l6 6 6-6" />
    </Icon>
)

export const ChevronRight = (p) => (
    <Icon {...p}>
        <path d="M9 6l6 6-6 6" />
    </Icon>
)

export const X = (p) => (
    <Icon {...p}>
        <path d="M6 6l12 12" />
        <path d="M18 6L6 18" />
    </Icon>
)

export const Minus = (p) => (
    <Icon {...p}>
        <path d="M6 12h12" />
    </Icon>
)

export const Plus = (p) => (
    <Icon {...p}>
        <path d="M12 6v12" />
        <path d="M6 12h12" />
    </Icon>
)

export const Moon = (p) => (
    <Icon {...p}>
        <path d="M20 14.5A8.5 8.5 0 019.5 4a8.5 8.5 0 1010.5 10.5z" />
    </Icon>
)

export const Sun = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 3v2" />
        <path d="M12 19v2" />
        <path d="M3 12h2" />
        <path d="M19 12h2" />
        <path d="M5.6 5.6L7 7" />
        <path d="M17 17l1.4 1.4" />
        <path d="M18.4 5.6L17 7" />
        <path d="M7 17l-1.4 1.4" />
    </Icon>
)

export const Timer = (p) => (
    <Icon {...p}>
        <circle cx="12" cy="13" r="7" />
        <path d="M12 10v3l2 1.5" />
        <path d="M9 3h6" />
    </Icon>
)

export const Refresh = (p) => (
    <Icon {...p}>
        <path d="M20 12a8 8 0 10-3 6.2" />
        <path d="M20 5v5h-5" />
    </Icon>
)
