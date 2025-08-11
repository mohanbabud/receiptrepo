import React from 'react';

// Simple macOS-inspired folder icon (solid color, rounded tab)
export function MacFolderIcon({ open = false, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* back/lid when open */}
      {open && (
        <path
          d="M3 8h18c.55 0 1 .45 1 1v2c0 .55-.45 1-1 1H3c-.55 0-1-.45-1-1V9c0-.55.45-1 1-1z"
          fill="currentColor"
          opacity="0.25"
        />
      )}
      {/* tab */}
      <path d="M3 6h6l1.5 1.5H21c.55 0 1 .45 1 1v8.5c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V7c0-.55.45-1 1-1z" fill="currentColor" />
    </svg>
  );
}

// Generic macOS-inspired file icon with folded corner and small glyphs per type
export function MacFileIcon({ type, className = '' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {/* file base with fold */}
      <path d="M6 2h7l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z" fill="currentColor" opacity="0.2" />
      <path d="M13 2v5c0 .55.45 1 1 1h5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <rect x="5" y="3" width="14" height="18" rx="2" ry="2" fill="none" stroke="currentColor" strokeWidth="1.2" />

      {/* simple glyphs */}
      {type === 'image' && (
        <>
          <circle cx="9.5" cy="13" r="1.3" fill="currentColor" />
          <path d="M7 17l3-3 2 2 2.5-2.5L19 17z" fill="currentColor" />
        </>
      )}
      {type === 'video' && <path d="M7 12.5v4a1 1 0 0 0 1.5.87l3.8-2.2a1 1 0 0 0 0-1.74L8.5 11.1A1 1 0 0 0 7 12v.5z" fill="currentColor" />}
      {type === 'audio' && (
        <path d="M10 12v5a2 2 0 1 1-1.5-1.94V11c0-.55.45-1 1-1h3v2h-2z" fill="currentColor" />
      )}
      {type === 'pdf' && (
        <text x="7" y="16.5" fontSize="6" fontWeight="700" fill="currentColor">PDF</text>
      )}
      {!type && (
        <rect x="8" y="12" width="8" height="6" rx="1" fill="currentColor" />
      )}
    </svg>
  );
}

const MacIcons = { MacFolderIcon, MacFileIcon };
export default MacIcons;
