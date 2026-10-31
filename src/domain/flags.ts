/** Единственное включающее значение; не связано с ANALYTICS_MODE / LLM_PROVIDER. */
export function chatbotEnabled(value: string | undefined): boolean { return value === 'true'; }
