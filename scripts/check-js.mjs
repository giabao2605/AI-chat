import { spawnSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_DIRECTORIES = ['src', 'public', 'scripts'];
const JAVASCRIPT_EXTENSIONS = new Set(['.js', '.mjs', '.cjs']);

async function walkJavaScriptFiles(directory, files) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await walkJavaScriptFiles(path, files);
    else if (entry.isFile() && JAVASCRIPT_EXTENSIONS.has(extname(entry.name))) files.push(path);
  }
}

export async function collectJavaScriptFiles(projectRoot, directories = DEFAULT_DIRECTORIES) {
  const root = resolve(projectRoot);
  const files = [];
  for (const directory of directories) await walkJavaScriptFiles(join(root, directory), files);
  return files.sort((a, b) => a.localeCompare(b));
}

export function checkJavaScriptFiles(files, { projectRoot = process.cwd() } = {}) {
  let failures = 0;
  for (const file of files) {
    const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (result.status === 0) continue;
    failures += 1;
    const label = relative(projectRoot, file) || file;
    console.error(`\nSyntax check failed: ${label}`);
    if (result.stderr) console.error(result.stderr.trimEnd());
    else if (result.stdout) console.error(result.stdout.trimEnd());
  }
  return failures;
}

async function main() {
  const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const files = await collectJavaScriptFiles(projectRoot);
  const failures = checkJavaScriptFiles(files, { projectRoot });
  if (failures) {
    console.error(`\n${failures} JavaScript file(s) failed syntax check.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Checked ${files.length} JavaScript file(s).`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) await main();
