// Browser-side document rendering using MuPDF's WebAssembly build.
//
// The whole file is rendered in the browser so we only ever upload one small
// page image at a time. Uploading the entire document in a single request can
// exceed the deployment platform's request-size limit and fail with HTTP 413
// before it ever reaches the server. Rendering here supports PDF, XPS and OXPS.
//
// The MuPDF wasm files are served as static assets from `/mupdf/*` (copied into
// the Vite public directory) so the bundler never has to process the ~10MB wasm.

let mupdfPromise: Promise<any> | null = null;

async function loadMupdf(): Promise<any> {
  if (!mupdfPromise) {
    // Use a non-literal specifier + @vite-ignore so Vite leaves this import
    // untouched and the browser loads the module straight from /mupdf at runtime.
    const moduleUrl = "/mupdf/mupdf.js";
    mupdfPromise = import(/* @vite-ignore */ moduleUrl);
  }
  return mupdfPromise;
}

export interface RenderedDocument {
  totalPages: number;
  renderPage: (index: number) => Promise<Blob>;
  close: () => void;
}

export async function openDocument(file: File): Promise<RenderedDocument> {
  const mupdf = await loadMupdf();
  const bytes = new Uint8Array(await file.arrayBuffer());

  let doc: any;
  try {
    doc = mupdf.Document.openDocument(bytes, file.name);
  } catch {
    doc = mupdf.Document.openDocument(bytes, file.type || "application/pdf");
  }

  const totalPages: number = doc.countPages();

  const renderPage = async (index: number): Promise<Blob> => {
    const page = doc.loadPage(index);
    const pixmap = page.toPixmap(
      mupdf.Matrix.scale(2, 2), // ~144 DPI for legible OCR
      mupdf.ColorSpace.DeviceRGB,
      false,
    );
    const png = pixmap.asPNG();
    const blob = new Blob([new Uint8Array(png)], { type: "image/png" });
    try {
      pixmap.destroy?.();
    } catch {}
    try {
      page.destroy?.();
    } catch {}
    return blob;
  };

  const close = () => {
    try {
      doc.destroy?.();
    } catch {}
  };

  return { totalPages, renderPage, close };
}
