declare module 'pdfmake/build/pdfmake' {
  interface PdfDocument {
    getBlob(callback: (blob: Blob) => void): void;
    getBuffer(callback: (buffer: Uint8Array) => void): void;
    download(fileName: string): void;
  }
  const pdfMake: {
    vfs: Record<string, string>;
    addVirtualFileSystem(vfs: Record<string, string>): void;
    createPdf(document: Record<string, unknown>): PdfDocument;
  };
  export default pdfMake;
}

declare module 'pdfmake/build/vfs_fonts.js' {
  const vfs: Record<string, string>;
  export default vfs;
}
