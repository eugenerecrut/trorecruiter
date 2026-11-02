const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('CRMServiceRecord.open provides editable grid form matching Card 13 design', async () => {
  // Minimal DOM mock
  class MockNode {
    constructor(tagName) {
      this.tagName = tagName ? tagName.toUpperCase() : 'DIV';
      this.children = [];
      this.attributes = {};
      this.style = {};
      this.hidden = false;
      this._value = '';
      this._checked = true;
      this.isConnected = true;
    }
    get value() { return this._value; }
    set value(v) { this._value = String(v ?? ''); }
    get checked() { return this._checked; }
    set checked(v) { this._checked = !!v; }
    setAttribute(k, v) { this.attributes[k] = v; }
    getAttribute(k) { return this.attributes[k]; }
    addEventListener(ev, fn) { this['on' + ev] = fn; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { this.isConnected = false; }
    scrollIntoView() {}
    querySelector(sel) {
      return this.find(node => {
        if (sel === 'form') return node.tagName === 'FORM';
        if (sel === 'iframe') return node.tagName === 'IFRAME';
        if (sel === '[data-service-close]') return node.attributes['data-service-close'] !== undefined;
        if (sel === '[data-service-reset]') return node.attributes['data-service-reset'] !== undefined;
        if (sel === '[data-service-save]') return node.attributes['data-service-save'] !== undefined;
        if (sel === '[data-service-submit]') return node.attributes['data-service-submit'] !== undefined;
        if (sel === '[data-service-persist]') return node.attributes['data-service-persist'] !== undefined;
        if (sel === '[data-service-status]') return node.attributes['data-service-status'] !== undefined;
        if (sel === '[data-download]') return node.attributes['data-download'] !== undefined;
        if (sel.startsWith('[data-service-field="')) {
          const key = sel.slice('[data-service-field="'.length, -2);
          return node.attributes['data-service-field'] === key;
        }
        return false;
      });
    }
    querySelectorAll(sel) {
      const res = [];
      this.traverse(node => {
        if (sel.includes('input') && node.tagName === 'INPUT') res.push(node);
        else if (sel.includes('textarea') && node.tagName === 'TEXTAREA') res.push(node);
        else if (sel.includes('button') && node.tagName === 'BUTTON') res.push(node);
      });
      return res;
    }
    find(predicate) {
      for (const c of this.children) {
        if (predicate(c)) return c;
        const found = c.find(predicate);
        if (found) return found;
      }
      return null;
    }
    traverse(fn) {
      for (const c of this.children) {
        fn(c);
        c.traverse(fn);
      }
    }
  }

  // Parse a basic HTML string into MockNodes
  function parseSimpleHtml(html) {
    const root = new MockNode('root');
    // regex to extract tags and text
    const tagRegex = /<(\/)?([a-z0-9-]+)([^>]*)>|([^<]+)/gi;
    let match;
    const stack = [root];
    while ((match = tagRegex.exec(html)) !== null) {
      const [full, isClosing, tagName, attrsStr, text] = match;
      if (text) continue;
      if (isClosing) {
        if (stack.length > 1 && stack[stack.length - 1].tagName.toLowerCase() === tagName.toLowerCase()) {
          stack.pop();
        }
      } else {
        const node = new MockNode(tagName);
        if (attrsStr) {
          const attrRegex = /([a-z0-9_-]+)(?:=["']([^"']*)["'])?/gi;
          let attrMatch;
          while ((attrMatch = attrRegex.exec(attrsStr)) !== null) {
            const [, attrName, attrVal] = attrMatch;
            node.attributes[attrName] = attrVal !== undefined ? attrVal : '';
            if (attrName === 'value') node.value = attrVal;
            if (attrName === 'checked') node.checked = true;
            if (attrName === 'hidden') node.hidden = true;
          }
        }
        stack[stack.length - 1].children.push(node);
        // void tags don't get pushed to stack
        if (!['input', 'img', 'br', 'hr'].includes(tagName.toLowerCase())) {
          // If it is textarea, grab its content
          if (tagName.toLowerCase() === 'textarea') {
            const closeTag = '</textarea>';
            const closeIdx = html.indexOf(closeTag, tagRegex.lastIndex);
            if (closeIdx >= 0) {
              node.value = html.slice(tagRegex.lastIndex, closeIdx);
              tagRegex.lastIndex = closeIdx + closeTag.length;
              continue;
            }
          }
          stack.push(node);
        }
      }
    }
    return root.children;
  }

  let appended = null;
  const mockDocument = {
    createElement(tag) {
      const node = new MockNode(tag);
      let innerHTML = '';
      Object.defineProperty(node, 'innerHTML', {
        get() { return innerHTML; },
        set(val) {
          innerHTML = val;
          node.children = parseSimpleHtml(val);
        }
      });
      return node;
    },
    body: {
      append(el) { appended = el; }
    }
  };

  const candidate = {
    id: 'test-cand-1',
    full_name: 'БАРАНОВСЬКА Карина Андріївна',
    name_nominative: 'Барановська Карина Андріївна',
    sex: 'female',
    rnokpp: '3705004481',
    birth_date: '2001-05-18',
    profile_data: {}
  };

  let updatedProfile = null;
  const mockSupabase = {
    from(table) {
      return {
        select() {
          return {
            eq() {
              return {
                single: async () => ({ data: { updated_at: '2026-11-02T12:00:00Z' }, error: null }),
                maybeSingle: async () => ({ data: null, error: null })
              };
            }
          };
        },
        update(data) {
          return {
            eq() {
              updatedProfile = data.profile_data;
              return {
                select() {
                  return {
                    single: async () => ({ data: { updated_at: '2026-11-02T12:00:01Z' }, error: null })
                  };
                }
              };
            }
          };
        }
      };
    }
  };

  const ctx = {
    window: {},
    document: mockDocument,
    URL: { createObjectURL: () => 'blob:mock-url', revokeObjectURL: () => {} },
    supabaseClient: mockSupabase,
    CRMWorkspace: { guard: async () => true, busy: false },
    loadExternalScript: async () => {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../crm-service-record.js'), 'utf8'), ctx);

  const dialog = await ctx.window.CRMServiceRecord.open(candidate, {}, { save: async () => {} });
  assert.ok(dialog, 'Dialog was returned');
  assert.ok(appended, 'Dialog was appended to body');
  assert.equal(dialog.className, 'crm-dialog crm-workflow-dialog');

  const form = dialog.querySelector('form');
  assert.ok(form, 'Contains form element');
  assert.equal(form.attributes.class, 'crm-workflow-grid', 'Form uses crm-workflow-grid class like Card 13');

  // Verify fields are present as inputs or textareas
  const rnokppInput = dialog.querySelector('[data-service-field="personal_number"]');
  assert.ok(rnokppInput, 'RNOKPP field is present');
  assert.equal(rnokppInput.value, '3705004481');

  const surnameInput = dialog.querySelector('[data-service-field="surname"]');
  assert.ok(surnameInput, 'Surname field is present');
  assert.equal(surnameInput.value, 'БАРАНОВСЬКА');

  const givenNamesInput = dialog.querySelector('[data-service-field="given_names"]');
  assert.ok(givenNamesInput, 'Given names field is present');
  assert.equal(givenNamesInput.value, 'Карина Андріївна');

  // Verify buttons and elements
  const submitBtn = dialog.querySelector('[data-service-submit]');
  assert.ok(submitBtn, 'Submit button is present');

  const saveBtn = dialog.querySelector('[data-service-save]');
  assert.ok(saveBtn, 'Save button is present');

  const resetBtn = dialog.querySelector('[data-service-reset]');
  assert.ok(resetBtn, 'Reset button is present');

  const persistCb = dialog.querySelector('[data-service-persist]');
  assert.ok(persistCb, 'Persist checkbox is present');

  const iframe = dialog.querySelector('iframe');
  assert.ok(iframe, 'Preview iframe is present');

  const downloadLink = dialog.querySelector('[data-download]');
  assert.ok(downloadLink, 'Download link is present');

  // Test field edit & reset
  surnameInput.value = 'НОВЕ-ПРІЗВИЩЕ';
  assert.equal(dialog.querySelector('[data-service-field="surname"]').value, 'НОВЕ-ПРІЗВИЩЕ');

  // Click reset
  dialog.querySelector('[data-service-reset]').onclick();
  assert.equal(dialog.querySelector('[data-service-field="surname"]').value, 'БАРАНОВСЬКА', 'Reset restored candidate fact');

  // Close dialog
  dialog.querySelector('[data-service-close]').onclick();
  assert.equal(dialog.isConnected, false, 'Dialog closed cleanly');
});
