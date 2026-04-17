import inlineCode from '../scripts/live-inline.js?raw';
import { executeInlineScript } from '../utils/executeInlineScript';

export function initLivePage() {
  return executeInlineScript(inlineCode, 'live-page');
}
