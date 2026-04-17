import inlineCode from '../scripts/home-inline.js?raw';
import { executeInlineScript } from '../utils/executeInlineScript';

export function initHomePage() {
  return executeInlineScript(inlineCode, 'home-page');
}
