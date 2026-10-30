import React, { useEffect, useRef, useState } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf';
// eslint-disable-next-line import/no-webpack-loader-syntax
import PdfWorker from 'pdfjs-dist/legacy/build/pdf.worker.entry';

pdfjsLib.GlobalWorkerOptions.workerSrc = PdfWorker;

// Renders one page of a PDF (object URL) to a canvas; works in every browser, no PDF plugin needed.
export default function PdfViewer({ url, page, onLoaded }) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [doc, setDoc] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const task = pdfjsLib.getDocument(url);
    task.promise.then((d) => { if (!cancelled) { setDoc(d); onLoaded?.(d.numPages); } })
      .catch(() => !cancelled && setError('This PDF could not be displayed.'));
    return () => { cancelled = true; task.destroy(); };
  }, [url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!doc) return undefined;
    let cancelled = false;
    let renderTask;
    setBusy(true);
    doc.getPage(Math.min(Math.max(page, 1), doc.numPages)).then((pg) => {
      if (cancelled) return;
      const width = (wrapRef.current?.clientWidth || 600) - 16;
      const base = pg.getViewport({ scale: 1 });
      const viewport = pg.getViewport({ scale: (width / base.width) * (window.devicePixelRatio || 1) });
      const canvas = canvasRef.current;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = `${width}px`;
      renderTask = pg.render({ canvasContext: canvas.getContext('2d'), viewport });
      return renderTask.promise;
    }).then(() => !cancelled && setBusy(false)).catch(() => {});
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [doc, page]);

  return (
    <Box ref={wrapRef} sx={{ flex: 1, overflow: 'auto', bgcolor: 'grey.300', p: 1, position: 'relative' }}>
      {error && <Typography color="error">{error}</Typography>}
      {busy && !error && <CircularProgress size={24} sx={{ position: 'absolute', top: 16, left: 16 }} />}
      <canvas ref={canvasRef} style={{ boxShadow: '0 1px 4px rgba(0,0,0,.4)', background: '#fff' }} />
    </Box>
  );
}
