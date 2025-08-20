import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';

// Use the same local worker we copied to public/
pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

const PdfPlainViewer = ({ url, height = 600 }) => {
  const [numPages, setNumPages] = useState(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(520);
  const containerRef = useRef(null);

  const onDocumentLoadSuccess = useCallback((pdf) => {
    setNumPages(pdf.numPages);
    setPage(1);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const w = Math.min(900, Math.max(280, containerRef.current?.clientWidth || 520));
      setWidth(w);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!url) return <div style={{ padding: 12, color: '#666' }}>Fetching preview…</div>;

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center', marginBottom: 8 }}>
        <button className="action-btn" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>◀ Prev</button>
        <span>Page</span>
        <input
          type="number"
          min={1}
          max={numPages || 1}
          value={page}
          onChange={(e) => {
            const v = parseInt(e.target.value || '1', 10);
            setPage(Number.isFinite(v) && v > 0 ? v : 1);
          }}
          style={{ width: 72 }}
        />
        <span>/ {numPages || '-'}</span>
        <button className="action-btn" onClick={() => setPage(p => Math.min((numPages || p + 1), p + 1))} disabled={!numPages || page >= numPages}>Next ▶</button>
      </div>
      {error && <div className="message error">❌ {error}</div>}
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <Document file={url} onLoadSuccess={onDocumentLoadSuccess} onLoadError={(e) => setError(e?.message || 'Failed to load PDF')}>
          <Page pageNumber={page} width={width} height={height} renderAnnotationLayer={false} renderTextLayer={false} />
        </Document>
      </div>
    </div>
  );
};

export default PdfPlainViewer;
