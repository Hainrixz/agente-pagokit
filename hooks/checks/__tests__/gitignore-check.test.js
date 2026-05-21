'use strict';

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function mkProj({ gitignoreContent } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pagokit-test-gi-'));
  // mark as git repo so walk-up stops here
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  if (gitignoreContent != null) {
    fs.writeFileSync(path.join(dir, '.gitignore'), gitignoreContent);
  }
  return dir;
}

module.exports = (() => {
  const cases = [];

  // Case 1: .env with proper gitignore passes
  {
    const projectDir = mkProj({ gitignoreContent: '.env\n.env.local\nnode_modules/\n' });
    cases.push({
      name: '.env with .env in .gitignore passes',
      check: 'gitignore-check',
      ctx: {
        filePath: path.join(projectDir, '.env'),
        content: 'STRIPE_SECRET_KEY=sk_test_REPLACE_ME\n',
        toolName: 'Write',
        projectDir,
      },
      expected: 'pass',
    });
  }

  // Case 2: .env without gitignore covering it is denied
  {
    const projectDir = mkProj({ gitignoreContent: 'node_modules/\n' });
    cases.push({
      name: '.env without coverage is denied',
      check: 'gitignore-check',
      ctx: {
        filePath: path.join(projectDir, '.env'),
        content: 'STRIPE_SECRET_KEY=sk_test_REPLACE_ME\n',
        toolName: 'Write',
        projectDir,
      },
      expected: 'deny',
    });
  }

  // Case 3: .env.example is allowlisted regardless of gitignore
  {
    const projectDir = mkProj({ gitignoreContent: '' });
    cases.push({
      name: '.env.example is allowlisted',
      check: 'gitignore-check',
      ctx: {
        filePath: path.join(projectDir, '.env.example'),
        content: 'STRIPE_SECRET_KEY=sk_test_REPLACE_ME\n',
        toolName: 'Write',
        projectDir,
      },
      expected: 'pass',
    });
  }

  // Case 4: .env.local with .env* in gitignore passes
  {
    const projectDir = mkProj({ gitignoreContent: '.env*\n!.env.example\n' });
    cases.push({
      name: '.env.local covered by .env* glob passes',
      check: 'gitignore-check',
      ctx: {
        filePath: path.join(projectDir, '.env.local'),
        content: 'STRIPE_SECRET_KEY=sk_test_REPLACE_ME\n',
        toolName: 'Write',
        projectDir,
      },
      expected: 'pass',
    });
  }

  // Case 5: pagokit-ignore bypass
  {
    const projectDir = mkProj({ gitignoreContent: '' });
    cases.push({
      name: 'pagokit-ignore tag bypasses the check',
      check: 'gitignore-check',
      ctx: {
        filePath: path.join(projectDir, '.env'),
        content: '# pagokit-ignore: gitignore-check -- ephemeral test\nKEY=value\n',
        toolName: 'Write',
        projectDir,
      },
      expected: 'pass',
    });
  }

  return cases;
})();
