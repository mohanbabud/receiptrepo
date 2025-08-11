import React from 'react';

const AccentToggle = ({ accent, setAccent }) => {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Accent</span>
      <select
        aria-label="Accent color"
        value={accent}
        onChange={(e) => setAccent(e.target.value)}
        style={{
          padding: '6px 8px',
          borderRadius: 8,
          border: '1px solid var(--gray-300)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)'
        }}
      >
        <option value="teal">Teal</option>
        <option value="blue">Blue</option>
        <option value="violet">Violet</option>
        <option value="indigo">Indigo</option>
        <option value="emerald">Emerald</option>
        <option value="rose">Rose</option>
        <option value="amber">Amber</option>
      </select>
    </label>
  );
};

export default AccentToggle;
