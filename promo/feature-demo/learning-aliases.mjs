import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
export const learningAliases = Object.fromEntries([
  ['services/learningSessions.ts', 'learning-sessions.ts'],
  ['services/flashcards.ts', 'learning-cards.ts'],
  ['services/studyPaths.ts', 'learning-paths.ts'],
  ['services/reviews.ts', 'learning-reviews.ts'],
].map(([source, replacement]) => [path.join(root, 'src', source), path.join(here, replacement)]));

export const learningPlugins = [];
