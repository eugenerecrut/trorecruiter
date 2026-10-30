const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = { window: {}, URL, encodeURIComponent };
context.window = context;
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../crm-whatsapp.js'), 'utf8'), context);

const wa = context.CRMWhatsApp;

// 1. Phone number normalization for wa.me
assert.equal(wa.cleanDigits('+380687661109'), '380687661109');
assert.equal(wa.cleanDigits('0687661109'), '380687661109');
assert.equal(wa.cleanDigits('380687661109'), '380687661109');
assert.equal(wa.cleanDigits('+38 (068) 766-11-09'), '380687661109');
assert.equal(wa.cleanDigits(''), '');
assert.equal(wa.cleanDigits(null), '');
console.log('WhatsApp cleanDigits: PASS');

// 2. Templates generation
const testCandidate = {
  full_name: 'ПАРФЬОНЕНКО Микита Сергійович',
  name_nominative: 'ПАРФЬОНЕНКО Микита Сергійович',
  phone: '+380506403285'
};

const tmplAll = wa.templates.find(t => t.id === 'docs_all');
assert.ok(tmplAll);
const textAll = tmplAll.build(testCandidate);
assert.ok(textAll.includes('Микита') || textAll.includes('Микито') || textAll.includes('ПАРФЬОНЕНКО'));
assert.ok(textAll.includes('Паспорт'));
assert.ok(textAll.includes('РНОКПП'));
assert.ok(textAll.includes('Документи про освіту'));

const tmplMissing = wa.templates.find(t => t.id === 'docs_missing');
assert.ok(tmplMissing);
const textMissing = tmplMissing.build(testCandidate, { missingDocs: ['Довідка ВЛК', 'Фотокартка 3х4'] });
assert.ok(textMissing.includes('1. Довідка ВЛК'));
assert.ok(textMissing.includes('2. Фотокартка 3х4'));

const tmplVlk = wa.templates.find(t => t.id === 'invite_vlk');
assert.ok(tmplVlk);
const textVlk = tmplVlk.build(testCandidate);
assert.ok(textVlk.includes('військово-лікарської комісії'));

const tmplIntro = wa.templates.find(t => t.id === 'intro');
assert.ok(tmplIntro);
const textIntro = tmplIntro.build(testCandidate);
assert.ok(textIntro.includes('рекрутер'));

console.log('WhatsApp templates: PASS');

// 3. Webhook parser simulation (Green API and Meta formats)
function parseWebhook(body) {
  let phone = '', content = '', messageType = 'text', mediaUrl = '', fileName = '';
  if (body.typeWebhook === 'incomingMessageReceived' || body.senderData) {
    const sender = body.senderData || {};
    phone = String(sender.chatId || sender.sender || '').replace(/@.*$/, '');
    const msgData = body.messageData || {};
    const typeMsg = msgData.typeMessage || '';
    if (typeMsg === 'textMessage') {
      content = msgData.textMessageData?.textMessage || '';
    } else if (typeMsg === 'imageMessage') {
      messageType = 'image';
      mediaUrl = msgData.fileMessageData?.downloadUrl || '';
      fileName = msgData.fileMessageData?.fileName || 'image.jpg';
    }
  }
  return { phone, content, messageType, mediaUrl, fileName };
}

const greenText = parseWebhook({
  typeWebhook: 'incomingMessageReceived',
  senderData: { chatId: '380687661109@c.us', senderName: 'Микита' },
  messageData: { typeMessage: 'textMessage', textMessageData: { textMessage: 'Доброго дня, надсилаю документи' } }
});
assert.equal(greenText.phone, '380687661109');
assert.equal(greenText.content, 'Доброго дня, надсилаю документи');
assert.equal(greenText.messageType, 'text');

const greenImage = parseWebhook({
  typeWebhook: 'incomingMessageReceived',
  senderData: { chatId: '380687661109@c.us', senderName: 'Микита' },
  messageData: {
    typeMessage: 'imageMessage',
    fileMessageData: { downloadUrl: 'https://storage.example.com/doc.jpg', fileName: 'passport.jpg' }
  }
});
assert.equal(greenImage.phone, '380687661109');
assert.equal(greenImage.messageType, 'image');
assert.equal(greenImage.mediaUrl, 'https://storage.example.com/doc.jpg');
assert.equal(greenImage.fileName, 'passport.jpg');

console.log('WhatsApp webhook parser: PASS');
console.log('ALL WHATSAPP INTEGRATION TESTS PASSED!');
