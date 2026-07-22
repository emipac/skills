import { readFile, writeFile } from 'node:fs/promises';

const manifestPaths = [
  '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json',
];

const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));

for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = packageManifest.version;

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log(`Synchronized plugin manifests to ${packageManifest.version}.`);
