// One validation rule for the document review screen and Edge Function.
export function reviewID(result, candidate = {}) {
  const type = String(result.document_type || '');
  if (!/^(?:ID)$|(?:ID|ІД)[\s-]*картк/iu.test(type)) return { blocked: false, issues: [] };
  const e = result.extracted || {}, issues = [];
  let p = candidate.profile_data || {};
  if (typeof p === 'string') { try { p = JSON.parse(p); } catch { p = {}; } }
  const name = v => String(v || '').normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/[’'`ʼ]/g, '').replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean).sort().join(' ');
  const digits = v => String(v || '').replace(/[\s\u00a0]/g, '');
  const date = v => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v || ''))) return false;
    const d = new Date(v + 'T00:00:00Z');
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  };
  const owner = e.name_nominative || e.full_name || result.candidate_name;
  if (!name(owner)) issues.push('AI не прочитав ПІБ власника ID-картки.');
  const candidateName = candidate.name_nominative || candidate.full_name;
  if (candidateName && name(owner) !== name(candidateName)) issues.push('ПІБ власника ID-картки не збігається з кандидатом.');
  if (!/^\d{9}$/.test(digits(e.document_number || e.passport_number))) issues.push('Номер ID-картки має містити 9 цифр без серії.');
  if (!/^\d{4}$/.test(digits(e.document_issuer || e.passport_issuer))) issues.push('Код органу видачі ID-картки має містити 4 цифри.');
  const issued = e.document_date || e.passport_issue_date, expiry = e.passport_expiry_date;
  if (!date(issued)) issues.push('Дата видачі ID-картки відсутня або некоректна.');
  if (!date(expiry)) issues.push('Дата «Дійсний до» відсутня або некоректна.');
  if (date(issued) && date(expiry) && expiry <= issued) issues.push('Строк дії ID-картки має завершуватися після видачі.');
  for (const [key, value] of [['passport_number', e.document_number || e.passport_number], ['passport_issue_date', issued], ['passport_expiry_date', expiry]]) {
    if (p.identity_document_type === 'ID' && p[key] && value && String(p[key]).trim() !== String(value).trim()) issues.push('Реквізит ID-картки відрізняється від збереженого поля ' + key + '.');
  }
  if (e.birth_date && !date(e.birth_date)) issues.push('Дата народження в ID-картці некоректна.');
  const birthday = candidate.birth_date || p.birth_date;
  if (birthday && e.birth_date && String(birthday).slice(0, 10) !== e.birth_date) issues.push('Дата народження не збігається з карткою кандидата.');
  if (date(e.birth_date) && date(issued) && issued <= e.birth_date) issues.push('Дата видачі ID-картки не може передувати народженню.');
  if (e.rnokpp && !/^\d{10}$/.test(digits(e.rnokpp))) issues.push('РНОКПП в ID-картці має містити 10 цифр.');
  const tax = candidate.rnokpp || p.rnokpp;
  if (tax && e.rnokpp && digits(tax) !== digits(e.rnokpp)) issues.push('РНОКПП не збігається з карткою кандидата.');
  if (e.unzr && !/^\d{8}-\d{5}$/.test(String(e.unzr))) issues.push('УНЗР в ID-картці має некоректний формат.');
  if (p.unzr && e.unzr && String(p.unzr) !== String(e.unzr)) issues.push('УНЗР не збігається з карткою кандидата.');
  const confidence = Number(result.confidence);
  if (result.confidence === null || result.confidence === undefined || !Number.isFinite(confidence) || confidence <= 0 || confidence > 1) issues.push('AI не надав коректної впевненості розпізнавання ID-картки.');
  if (result.review_required === true) issues.push('Сервер позначив результат ID-картки як такий, що потребує перевірки.');
  return { blocked: issues.length > 0, issues };
}

if (typeof window !== 'undefined') window.CRMIDValidation = { review: reviewID };
