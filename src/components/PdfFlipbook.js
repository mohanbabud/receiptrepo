import React, { useEffect, useState, useCallback, useRef } from 'react';
import HTMLFlipBook from 'react-pageflip';
import { Document, Page, pdfjs } from 'react-pdf';

// Always use the classic JS worker served from public to avoid module-worker issues
pdfjs.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL || ''}/pdf.worker.min.js`;

const PdfFlipbook = ({ url, height = 600, rotate = 0 }) => {
  const [numPages, setNumPages] = useState(null);
  const [error, setError] = useState('');
  const [width, setWidth] = useState(420);
  const containerRef = useRef(null);

  const onDocumentLoadSuccess = useCallback((pdf) => {
    setNumPages(pdf.numPages);
  }, []);

  useEffect(() => {
    const onResize = () => {
      const w = Math.min(560, Math.max(280, containerRef.current?.clientWidth || 420));
      setWidth(w);
    };
    onResize();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  if (!url) return <div style={{ padding: 12, color: '#666' }}>Fetching preview…</div>;

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {error && (
        <div className="message error" style={{ marginBottom: 8 }}>❌ {error}</div>
      )}
      <Document file={url} onLoadSuccess={onDocumentLoadSuccess} onLoadError={(e) => setError(e?.message || 'Failed to load PDF')}>
        {numPages ? (
          <HTMLFlipBook width={width} height={height} size="stretch" minWidth={280} maxWidth={1024} minHeight={320} maxHeight={1200} drawShadow={true} showCover={false} mobileScrollSupport={true} usePortrait={true}>
      {Array.from({ length: numPages }, (_, i) => (
              <div key={i} className="page" style={{ background: '#fff' }}>
        <Page pageNumber={i + 1} width={width} renderAnnotationLayer={false} renderTextLayer={false} rotate={rotate} />
              </div>
            ))}
          </HTMLFlipBook>
        ) : (
          <div style={{ padding: 12, color: '#666' }}>Loading pages…</div>
        )}
      </Document>
    </div>
  );
};

export default PdfFlipbook;
