import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
const demo = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(demo, '../..');
export const planningAliases = {
  [path.join(root, 'src/services/dashboardState.ts')]: path.join(demo, 'planning-dashboard.ts'),
  [path.join(root, 'src/services/quizAttempts.ts')]: path.join(demo, 'planning-quiz-attempts.ts'),
};
export const planningPlugins = [{
  name: 'actual-planning-ui',
  enforce: 'pre',
  async transform(code, id) {
    if (/[\\/]src[\\/]pages[\\/]Stats\.tsx$/.test(id)) {
      // The app already hides AI usage. Omit retention only in the promo preview.
      const omitted = [
        'import ReviewOverview from "../features/learningSession/ReviewOverview";',
        '<ReviewOverview variant="stats" />',
      ];
      let source = code;
      for (const fragment of omitted) {
        if (!source.includes(fragment)) throw new Error('Stats promo panel adapter no longer matches the app source');
        source = source.replace(fragment, '');
      }
      return { code: source, map: null };
    }
    if (/[\\/]planning-plan\.tsx$/.test(id)) {
      const source = await readFile(path.join(root, 'src/pages/Dashboard.tsx'), 'utf8');
      const start = source.indexOf('              {studyPlanMessage ? (');
      const end = source.indexOf('            </Card>', start);
      if (start < 0 || end < start) throw new Error('Dashboard planning markup extraction failed');
      return { code: code.replace('{/* ACTUAL_DASHBOARD_PLAN_MARKUP */}', source.slice(start, end)), map: null };
    }
    if (/[\\/]UsageOverview\.tsx$/.test(id)) {
      let source = code.replace("import { BACKEND_URL, getJsonRequestHeaders } from '../../services/backend';", `import { loadDemoUsage } from ${JSON.stringify(path.join(demo, 'planning-workflow.ts').replaceAll('\\', '/'))};`);
      const start = source.indexOf('      const response=await fetch(');
      const end = source.indexOf('if(!controller.signal.aborted)setGroups(data.groups);', start);
      if (start < 0 || end < start) throw new Error('UsageOverview demo adapter extraction failed');
      source = source.slice(0, start) + '      const data=await loadDemoUsage();' + source.slice(end);
      return { code: source, map: null };
    }
    return null;
  },
}];
