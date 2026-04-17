import inlineCode from '../scripts/library-inline.js?raw';
import { executeInlineScript } from '../utils/executeInlineScript';

export function initLibraryPage() {
  return executeInlineScript(inlineCode, 'library-page');
}
