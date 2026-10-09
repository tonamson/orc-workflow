'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { directoryListingUrl, parseDirectoryListing, type ServerDirectoryListing } from './directory-picker-model';

function directoryError(status: number): string {
  if (status === 400) return 'Đường dẫn không hợp lệ.';
  if (status === 403) return 'Thư mục nằm ngoài các thư mục được phép.';
  if (status === 404) return 'Không tìm thấy thư mục này.';
  return 'Không tải được danh sách thư mục. Hãy thử lại.';
}

export function ServerDirectoryPicker({ onSelect }: { onSelect: (path: string) => void }) {
  const [open, setOpen] = useState(false);
  const [portalReady, setPortalReady] = useState(false);
  const [listing, setListing] = useState<ServerDirectoryListing | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const dialogRef = useRef<HTMLDialogElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const requestedPath = useRef<string | undefined>(undefined);

  useEffect(() => { setPortalReady(true); }, []);

  const loadDirectory = useCallback(async (path?: string) => {
    requestedPath.current = path;
    const sequence = ++requestSequence.current;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(directoryListingUrl(path), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(directoryError(response.status));
      const result = parseDirectoryListing(await response.json());
      if (sequence !== requestSequence.current || !dialogRef.current?.open) return;
      setListing(result);
    } catch (cause) {
      if (controller.signal.aborted || sequence !== requestSequence.current) return;
      setError(cause instanceof Error ? cause.message : 'Không tải được danh sách thư mục. Hãy thử lại.');
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!open || !portalReady || !dialog) return;
    if (!dialog.open) dialog.showModal();
    void loadDirectory();
    return () => {
      requestSequence.current += 1;
      requestRef.current?.abort();
      requestRef.current = null;
      if (dialog.open) dialog.close();
    };
  }, [open, loadDirectory, portalReady]);

  const close = () => setOpen(false);

  return <>
    <button type="button" className="directory-picker-open" onClick={() => setOpen(true)}>Chọn thư mục</button>
    {portalReady && createPortal(<dialog ref={dialogRef} className="server-directory-dialog" aria-labelledby="server-directory-title" onCancel={event => { event.preventDefault(); close(); }} onClose={() => setOpen(false)}>
      <div className="server-directory-content">
        <header className="server-directory-header"><div><h2 id="server-directory-title">Chọn thư mục trên máy chủ</h2><p>Chọn thư mục mã nguồn để điền vào đường dẫn workspace.</p></div><button type="button" className="server-directory-close" aria-label="Đóng hộp thoại" onClick={close}>×</button></header>
        <nav className="server-directory-roots" aria-label="Thư mục được phép">
          <span>Vị trí được phép</span>
          {listing?.roots.map(root => <button type="button" key={root} aria-pressed={listing.path === root} disabled={loading} onClick={() => void loadDirectory(root)}>{root}</button>)}
        </nav>
        <div className="server-directory-location"><button type="button" disabled={loading || !listing?.parentPath} onClick={() => listing?.parentPath && void loadDirectory(listing.parentPath)}>↑ Lên một cấp</button><code aria-live="polite">{listing?.path ?? (loading ? 'Đang tải…' : 'Chưa có thư mục')}</code></div>
        <section className="server-directory-list" aria-label="Thư mục con" aria-busy={loading}>
          {loading && <p className="server-directory-message" role="status">Đang tải danh sách thư mục…</p>}
          {!loading && error && <div className="server-directory-message server-directory-error" role="alert"><p>{error}</p><button type="button" onClick={() => void loadDirectory(requestedPath.current)}>Thử lại</button></div>}
          {!loading && !error && listing && listing.directories.length === 0 && <p className="server-directory-message">Thư mục này chưa có thư mục con.</p>}
          {!error && listing?.directories.map(directory => <button type="button" className="server-directory-item" key={directory.path} disabled={loading} onClick={() => void loadDirectory(directory.path)}><span aria-hidden="true">📁</span><span>{directory.name}</span><span aria-hidden="true">›</span></button>)}
          {listing?.truncated && <p className="server-directory-message">Danh sách đã được rút gọn. Hãy mở thư mục để tiếp tục tìm.</p>}
        </section>
        <footer className="server-directory-footer"><button type="button" className="directory-picker-cancel" onClick={close}>Hủy</button><button type="button" className="directory-picker-choose" disabled={!listing || loading || Boolean(error)} onClick={() => { if (listing) { onSelect(listing.path); close(); } }}>Dùng thư mục này</button></footer>
      </div>
    </dialog>, document.body)}
  </>;
}
