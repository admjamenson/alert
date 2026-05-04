import i18n from '../../i18n';
import { LocalSupportFaqRepository } from '../../infrastructure/support/LocalSupportFaqRepository';
import { SupportAssistantReply } from '../../domain/support/SupportAssistant';
import { SupportPolicy } from '../../domain/support/SupportPolicy';

type ExecuteParams = {
  question: string;
  locale: string;
  supportEmail: string;
};

export const GetSupportAssistantReplyQuery = {
  execute({ question, locale, supportEmail }: ExecuteParams): SupportAssistantReply {
    const t = (key: string, options?: Record<string, any>) =>
      i18n.t(key, { lng: locale, ...options });

    const scope = SupportPolicy.evaluate(question);
    if (!scope.allowed) {
      return {
        intent: 'blocked',
        shouldEscalate: true,
        text: t('support_chat_refusal', { email: supportEmail }),
      };
    }

    const entry = LocalSupportFaqRepository.findMatch(question);
    if (entry) {
      return {
        intent: 'faq',
        shouldEscalate: false,
        text: t(entry.responseKey),
      };
    }

    return {
      intent: 'fallback',
      shouldEscalate: true,
      text: t('support_chat_fallback', { email: supportEmail }),
    };
  },
};
