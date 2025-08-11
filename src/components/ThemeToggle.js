import React from 'react';

const ThemeToggle = ({ theme, setTheme }) => {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Theme</span>
      <select
        aria-label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        style={{
          padding: '6px 8px',
          borderRadius: 8,
          border: '1px solid var(--gray-300)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)'
        }}
      >
        <option value="auto">Auto</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="hc">High contrast</option>
      </select>
    </label>
  );
};

export default ThemeToggle;
