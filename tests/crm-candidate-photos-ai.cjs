const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setupPhotosContext() {
  function createMockCanvas(w, h, fillFn) {
    const data = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const idx = (y * w + x) * 4;
        const lum = fillFn ? fillFn(x, y) : 200;
        data[idx] = lum;
        data[idx + 1] = lum;
        data[idx + 2] = lum;
        data[idx + 3] = 255;
      }
    }
    const canvas = {
      width: w,
      height: h,
      _drawn: [],
      getContext(type) {
        return {
          fillStyle: '',
          fillRect() {},
          drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh) {
            canvas._drawn.push({ sx, sy, sw, sh, dx, dy, dw, dh });
          },
          getImageData(x, y, gw, gh) {
            return { data };
          }
        };
      },
      toDataURL() { return 'data:image/jpeg;base64,mock'; },
      toBlob(cb) { cb(new Uint8Array([1, 2, 3])); }
    };
    return canvas;
  }

  const mockDoc = {
    createElement(tag) {
      if (tag === 'canvas') return createMockCanvas(120, 160);
      return { tagName: tag.toUpperCase() };
    },
    querySelectorAll() { return []; },
    addEventListener() {}
  };

  const ctx = {
    window: {},
    document: mockDoc,
    escapeHtml: s => String(s || ''),
    URL: { createObjectURL: () => 'blob:mock', revokeObjectURL: () => {} },
    supabaseClient: {
      auth: { onAuthStateChange: () => {} },
      storage: {
        from: () => ({
          createSignedUrl: async () => ({ data: { signedUrl: 'http://mock' }, error: null })
        })
      }
    },
    CRMResponsibility: {
      latest: docs => docs
    },
    createMockCanvas
  };

  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../candidate-photos.js'), 'utf8'), ctx);
  return ctx;
}

test('CandidatePhotos.findPhotoDoc prioritizes 3x4 > 9x12 > photo > ID-card > driver license > passport', () => {
  const ctx = setupPhotosContext();
  const find = ctx.window.CandidatePhotos.findPhotoDoc;

  // 1. Candidate with only ID-card
  const docsIdOnly = [
    { id: '1', document_type: 'Українська ID-картка', storage_path: 'id.pdf', created_at: '2026-10-01' },
    { id: '2', document_type: 'РНОКПП', storage_path: 'tax.pdf', created_at: '2026-10-01' }
  ];
  assert.equal(find(docsIdOnly).id, '1', 'Finds ID card when no photo doc exists');

  // 2. Candidate with ID-card and driver license
  const docsIdAndDriver = [
    { id: '1', document_type: 'Посвідчення водія', storage_path: 'driver.pdf', created_at: '2026-10-02' },
    { id: '2', document_type: 'Українська ID-картка', storage_path: 'id.pdf', created_at: '2026-10-01' }
  ];
  assert.equal(find(docsIdAndDriver).id, '2', 'ID-card takes precedence over driver license');

  // 3. Candidate with photo 9x12 and ID card (like Grechko)
  const docsPhotoAndId = [
    { id: '1', document_type: 'Українська ID-картка', storage_path: 'id.pdf', created_at: '2026-10-01' },
    { id: '2', document_type: 'Фото 9×12', storage_path: 'photo9x12.pdf', created_at: '2026-10-02' }
  ];
  assert.equal(find(docsPhotoAndId).id, '2', 'Photo 9x12 takes precedence over ID card');

  // 4. Candidate with 3x4 photo, 9x12 photo and ID card
  const docsAll = [
    { id: '1', document_type: 'Українська ID-картка', storage_path: 'id.pdf', created_at: '2026-10-01' },
    { id: '2', document_type: 'Фото 9×12', storage_path: 'photo9x12.pdf', created_at: '2026-10-02' },
    { id: '3', document_type: 'Фото 3×4', storage_path: 'photo3x4.pdf', created_at: '2026-10-03' }
  ];
  assert.equal(find(docsAll).id, '3', 'Photo 3x4 takes highest precedence');

  // 5. Deleted doc ignored
  const docsDeleted = [
    { id: '1', document_type: 'Фото 3×4', storage_path: 'photo.pdf', deleted_at: '2026-10-04' },
    { id: '2', document_type: 'Українська ID-картка', storage_path: 'id.pdf' }
  ];
  assert.equal(find(docsDeleted).id, '2', 'Deleted photo is ignored in favor of active ID card');
});

test('isolatePortrait preserves full single photo and does not quarter it', async () => {
  const ctx = setupPhotosContext();
  const isolate = ctx.window.CandidatePhotos.isolatePortrait;

  // Single portrait photo (w=300, h=400): face in middle (lum 130), bright background (lum 230)
  const singleCanvas = ctx.createMockCanvas(300, 400, (x, y) => {
    const dx = x - 150, dy = y - 180;
    if (Math.sqrt(dx * dx + dy * dy) < 70) return 130; // face
    return 230; // background
  });

  const res = await isolate(singleCanvas, { document_type: 'Фото 9×12' });
  assert.ok(res, 'Returns canvas');
  assert.equal(res.width, 120);
  assert.equal(res.height, 160);

  // Check drawn params: it must draw full width/height or centered, NEVER sx=0, sy=0, sw=w*0.44!
  const drawn = res._drawn[0];
  assert.ok(drawn, 'Canvas drawImage was called');
  assert.ok(drawn.sw > 200, 'Single photo keeps full/large width, not sliced into 44% quarter');
  assert.ok(drawn.sh > 300, 'Single photo keeps full/large height, not sliced into 44% quarter');
});

test('isolatePortrait isolates 4-up sheet top-left portrait photo', async () => {
  const ctx = setupPhotosContext();
  const isolate = ctx.window.CandidatePhotos.isolatePortrait;

  // 4-up 2x2 sheet (w=300, h=400): gutters at x=150 and y=200 with lum 240, 4 dark quadrants (lum 110)
  const fourUpCanvas = ctx.createMockCanvas(300, 400, (x, y) => {
    if (Math.abs(x - 150) < 10 || Math.abs(y - 200) < 10) return 240; // gutters
    return 110; // subjects
  });

  const res = await isolate(fourUpCanvas, { document_type: 'Фото 9×12' });
  assert.ok(res);
  const drawn = res._drawn[0];
  assert.ok(drawn);
  // It should crop top-left quadrant (~44% of sheet)
  assert.ok(drawn.sw <= 300 * 0.50, '4-up sheet crops top-left width');
  assert.ok(drawn.sh <= 400 * 0.50, '4-up sheet crops top-left height');
  assert.ok(drawn.sx < 30, 'Top-left starts near 0');
  assert.ok(drawn.sy < 30, 'Top-left starts near 0');
});

test('isolatePortrait extracts photo from ID-card when photo doc is missing', async () => {
  const ctx = setupPhotosContext();
  const isolate = ctx.window.CandidatePhotos.isolatePortrait;

  // ID-card canvas: landscape (w=600, h=380)
  const idCanvas = ctx.createMockCanvas(600, 380);

  const res = await isolate(idCanvas, { document_type: 'Українська ID-картка' });
  assert.ok(res);
  const drawn = res._drawn[0];
  assert.ok(drawn);
  // Photo on ID-card is on the left
  assert.ok(drawn.sx < 600 * 0.10, 'Photo starts on left of ID card');
  assert.ok(drawn.sw <= 600 * 0.35, 'Photo width is left column (~30%) of ID card');
});

test('isolatePortrait uses AI-provided photo_box when present in ai_extracted', async () => {
  const ctx = setupPhotosContext();
  const isolate = ctx.window.CandidatePhotos.isolatePortrait;

  const canvas = ctx.createMockCanvas(1000, 1000);
  const docWithAi = {
    document_type: 'Українська ID-картка',
    ai_extracted: {
      photo_box: [10, 5, 80, 40] // ymin, xmin, ymax, xmax (in percent)
    }
  };

  const res = await isolate(canvas, docWithAi);
  assert.ok(res);
  const drawn = res._drawn[0];
  assert.ok(drawn);
  assert.equal(drawn.sx, 50); // 5% of 1000
  assert.equal(drawn.sy, 100); // 10% of 1000
  assert.equal(drawn.sw, 350); // (40-5)% = 35% of 1000
  assert.equal(drawn.sh, 700); // (80-10)% = 70% of 1000
});
