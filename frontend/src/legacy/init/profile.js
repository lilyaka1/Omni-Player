import inlineCode from '../scripts/profile-inline.js?raw';
import { executeInlineScript } from '../utils/executeInlineScript';

export function initProfilePage() {
  return executeInlineScript(inlineCode, 'profile-page');
}
