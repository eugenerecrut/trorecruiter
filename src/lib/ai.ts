// AI document classification disabled by design.
// Document processing must use deterministic OCR + rules.

export type DocumentExtraction = {
  documentType: string | null;
  rnokpp: string | null;
  warnings: string[];
};

const RNOKPP_RE = /\b\d{10}\b/g;

export function extractRnokpp(text: string): string | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const candidates = normalized.match(RNOKPP_RE) ?? [];
  return candidates.find(isValidRnokpp) ?? candidates[0] ?? null;
}

function isValidRnokpp(value: string): boolean {
  if (!/^\d{10}$/.test(value)) return false;
  const digits = value.split('').map(Number);
  const weights = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const sum = weights.reduce((acc, weight, i) => acc + digits[i] * weight, 0);
  const control = sum % 11;
  return control < 10 && control === digits[9];
}

export function classifyDocument(fileName: string, ocrText: string): DocumentExtraction {
  const text = `${fileName}\n${ocrText}`.toLowerCase();
  const rnokpp = extractRnokpp(ocrText);

  if (
    text.includes('реєстраційний номер облікової картки платника податків') ||
    text.includes('картка платника податків') ||
    text.includes('реєстраційний номер облікової картки') ||
    text.includes('податковий номер') ||
    /(?:^|[^а-яіїє])рнокпп(?:$|[^а-яіїє])/.test(text) ||
    /(?:^|[^а-яіїє])іпн(?:$|[^а-яіїє])/.test(text)
  ) {
    return {
      documentType: 'Картка платника податків',
      rnokpp,
      warnings: rnokpp ? [] : ['РНОКПП не знайдено в OCR']
    };
  }

  return {
    documentType: null,
    rnokpp,
    warnings: rnokpp ? ['Тип документа не визначено правилами OCR'] : []
  };
}

export async function classifyDocumentWithAI(): Promise<never> {
  throw new Error('AI document classification is disabled. Use OCR + deterministic rules.');
}
