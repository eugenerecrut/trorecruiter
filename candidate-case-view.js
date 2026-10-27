/* Read-only projection. Writers and document generators remain the existing CRM handlers. */
(function (root) {
  'use strict';
  const parse = value => { try { return typeof value === 'string' ? JSON.parse(value) || {} : value || {}; } catch { return {}; } };
  function buildCandidateCaseView(candidate, personalFile, documents, requirements, templateRequirements = {}) {
    personalFile = personalFile && (!personalFile.candidate_id || personalFile.candidate_id === candidate.id) ? personalFile : {};
    const p = parse(candidate.profile_data);
    const mismatched = documents.filter(doc => doc.candidate_id && doc.candidate_id !== candidate.id);
    const latest = root.CRMResponsibility.latest(documents.filter(doc => !doc.candidate_id || doc.candidate_id === candidate.id));
    const report = root.CRMCaseAssistant.build(candidate, requirements, latest, personalFile);
    const issues = report.issues.map(item => ({
      id: JSON.stringify([item.document.id, item.key || '', item.kind, item.text]),
      fact: item.key || null, reason: item.text, current: item.current,
      alternatives: item.incoming === undefined ? [] : [item.incoming], sourceIds: [item.document.id],
      severity: item.kind === 'error' ? 'error' : 'review', actions: ['review-source'], decision: null
    }));
    for(const doc of latest){
      if((!doc.document_type||root.CRMCandidateConditions.documentCondition(doc.document_type,candidate)!==false)&&doc.verification_status==='Потребує перевірки'&&!issues.some(i=>i.sourceIds.includes(doc.id)))
        issues.push({id:JSON.stringify([doc.id,'verification']),fact:null,reason:'Потрібна перевірка документа.',
          current:null,alternatives:[],sourceIds:[doc.id],severity:'review',actions:['review-source'],decision:null});
    }
    for(const doc of mismatched)issues.push({id:JSON.stringify([doc.id,'candidate-mismatch']),fact:null,
      reason:'Документ належить іншій картці. Перевірте відповідність кандидату.',current:null,alternatives:[],
      sourceIds:[doc.id],severity:'error',actions:['review-source'],decision:null});
    const files = latest.map(doc => ({
      id: doc.id, source: doc, hasCopy: !!doc.storage_path,
      // Technical states take precedence over a previous verification/extraction.
      aiState: doc.processing_status || 'Не оброблено', verificationState: doc.verification_status || 'Не перевірено',
      condition: root.CRMCandidateConditions.documentCondition(doc.document_type, candidate)
    }));
    const service = report.serviceRecord;
    const readiness = {
      serviceRecord: { ready: service?.ready ?? null, missing: service?.issues || [], scope: 'дані; геометрія PDF перевіряється генератором' },
      questionnaire: { ready: report.package.ready, missing: report.package.missing, scope: 'електронні копії для PDF «Анкета»' },
      information: { ready: null, missing: [], scope: 'перевіряється чинним генератором; окремий контракт не задано' },
      fullPackage: { ready: null, missing: [], scope: 'склад і місткість перевіряються чинним генератором' }
    };
    // Optional explicit contracts may add blockers, but must never assert layout readiness.
    for (const [key, contract] of Object.entries(templateRequirements)) {
      if (!readiness[key] || !Array.isArray(contract?.missing)) continue;
      const missing = [...readiness[key].missing, ...contract.missing];
      readiness[key] = { ...readiness[key], ready: missing.length || readiness[key].ready === false ? false : null, missing };
    }
    const selected = templateRequirements.selected || 'serviceRecord';
    const missing = readiness[selected]?.missing || [];
    const access = issues.find(i => /власник|належ|доступ|інш.*особ/iu.test(i.reason));
    const nextAction = access ? { kind: 'review', text: 'Перевірити належність документа' }
      : report.state.processing ? { kind: 'wait', text: 'Триває розпізнавання документів' }
      : issues.length ? { kind: 'review', text: 'Перевірити питання: ' + issues.length }
      : selected === 'serviceRecord' && !service ? { kind: 'review', text: 'Перевірка даних послужного недоступна. Оновіть сторінку.' }
      : missing.length || report.fills.length || report.missingData.length ? { kind: 'review', text: 'Доповнити дані для обраної форми' }
      : { kind: 'case', text: 'Перейти до формування та перевірки PDF' };
    return {
      identity: { name: candidate.full_name || p.name_nominative || '', phone: candidate.phone || '',
        responsible: candidate.responsible_recruiter_id || null, serviceType: p.service_type || personalFile?.service_type || '',
        sources: p.field_sources || {}, confirmations: p.field_confirmations || {} },
      documents: files, completeness: report.state, issues, readiness, nextAction, report
    };
  }
  root.CRMCandidateCaseView = { build: buildCandidateCaseView,
    enabled: () => {
      if(typeof root.CRMFeatureFlags?.compactCaseView==='boolean')return root.CRMFeatureFlags.compactCaseView;
      // UI-only opt-in for read-only canary acceptance; never changes permissions or persisted data.
      return !!root.location && new URLSearchParams(root.location.search).get('compactCaseView')==='1';
    } };
})(typeof window === 'undefined' ? globalThis : window);
