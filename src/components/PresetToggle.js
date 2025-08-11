import React from 'react';

const PresetToggle = ({ preset, setPreset }) => {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>Theme preset</span>
      <select
        aria-label="Theme preset"
        value={preset}
        onChange={(e) => setPreset(e.target.value)}
        style={{
          padding: '6px 8px',
          borderRadius: 8,
          border: '1px solid var(--gray-300)',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)'
        }}
      >
        <option value="default">Default</option>
        <option value="ocean">Ocean</option>
        <option value="sunset">Sunset</option>
        <option value="forest">Forest</option>
        <option value="graphite">Graphite</option>
      </select>
    </label>
  );
};

export default PresetToggle;
