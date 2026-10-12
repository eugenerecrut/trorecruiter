// Prepare JPEG uploads locally before Storage, OCR and document metadata writes.
(function () {
  'use strict';
  const prepared = new WeakMap();
  const maxBytes = 20 * 1024 * 1024;
  let libraryPromise;

  async function library() {
    if (window.PDFLib) return window.PDFLib;
    if (!libraryPromise) libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
      script.onload = () => window.PDFLib ? resolve(window.PDFLib) : reject(new Error('Бібліотека PDF недоступна.'));
      script.onerror = () => { script.remove(); reject(new Error('Не вдалося завантажити бібліотеку PDF. Перевірте з’єднання та спробуйте ще раз.')); };
      document.head.append(script);
    }).catch(error => { libraryPromise = null; throw error; });
    return libraryPromise;
  }

  // Read the optional orientation tag without re-encoding image pixels.
  function orientation(bytes) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    try {
      let offset = 2;
      while (offset + 4 <= view.byteLength) {
        if (view.getUint8(offset++) !== 255) break;
        while (view.getUint8(offset) === 255) offset++;
        const marker = view.getUint8(offset++);
        if (marker === 0xda || marker === 0xd9) break;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
        const length = view.getUint16(offset);
        const end = offset + length;
        if (length < 2 || end > view.byteLength) break;
        if (marker === 0xe1 && length >= 16 && view.getUint32(offset + 2) === 0x45786966 && view.getUint16(offset + 6) === 0) {
          const tiff = offset + 8;
          const endian = view.getUint16(tiff);
          if (endian !== 0x4949 && endian !== 0x4d4d) return 1;
          const little = endian === 0x4949;
          if (view.getUint16(tiff + 2, little) !== 42) return 1;
          const directory = tiff + view.getUint32(tiff + 4, little);
          if (directory < tiff || directory + 2 > end) return 1;
          const count = view.getUint16(directory, little);
          for (let i = 0; i < count; i++) {
            const entry = directory + 2 + i * 12;
            if (entry + 12 > end) break;
            if (view.getUint16(entry, little) === 0x0112 && view.getUint16(entry + 2, little) === 3 && view.getUint32(entry + 4, little) === 1) {
              const value = view.getUint16(entry + 8, little);
              return value >= 1 && value <= 8 ? value : 1;
            }
          }
        }
        offset = end;
      }
    } catch (_) { /* Malformed optional EXIF does not invalidate image data. */ }
    return 1;
  }

  function isJPEG(file) {
    return !!file && (/^image\/(?:jpeg|jpg)$/i.test(file.type || '') || /\.jpe?g$/i.test(file.name || ''));
  }
  async function convert(file) {
    if (file.size > maxBytes) throw new Error('Файл більший за 20 МБ.');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes[0] !== 255 || bytes[1] !== 216) throw new Error('Файл не містить коректного JPEG-зображення.');
      const pdfLib = await library();
      const pdf = await pdfLib.PDFDocument.create();
      const image = await pdf.embedJpg(bytes);
      // Bound PDF point dimensions for existing OCR rendering, retaining original pixels.
      const scale = Math.min(1, 1000 / Math.max(image.width, image.height));
      const width = image.width * scale, height = image.height * scale;
      const exif = orientation(bytes);
      const page = pdf.addPage(exif >= 5 ? [height, width] : [width, height]);
      const matrices = {
        1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, width, 0],
        3: [-1, 0, 0, -1, width, height], 4: [1, 0, 0, -1, 0, height],
        5: [0, -1, -1, 0, height, width], 6: [0, -1, 1, 0, 0, width],
        7: [0, 1, 1, 0, 0, 0], 8: [0, 1, -1, 0, height, 0]
      };
      page.pushOperators(pdfLib.pushGraphicsState(), pdfLib.concatTransformationMatrix(...matrices[exif]));
      page.drawImage(image, { x: 0, y: 0, width, height });
      page.pushOperators(pdfLib.popGraphicsState());
      const result = await pdf.save();
      if (result.byteLength > maxBytes) throw new Error('PDF після конвертації більший за 20 МБ.');
      const name = String(file.name || 'document.jpg').replace(/\.jpe?g$/i, '') + '.pdf';
      return new File([result], name, { type: 'application/pdf', lastModified: file.lastModified });
    } catch (error) {
      throw new Error('JPEG → PDF: ' + (error.message || 'Не вдалося перетворити зображення.'));
    }
  }
  function prepare(file) {
    if (!isJPEG(file)) return Promise.resolve(file);
    if (!prepared.has(file)) prepared.set(file, convert(file).catch(error => { prepared.delete(file); throw error; }));
    return prepared.get(file);
  }
  window.CRMUploadPDF = { prepare, isJPEG };
})();
