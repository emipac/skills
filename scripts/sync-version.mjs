import { readFile, writeFile } from 'node:fs/promises';

const manifestPaths = [
  '.codex-plugin/plugin.json',
  '.claude-plugin/plugin.json',
];

// The guide names the release in two places a reader sees first. A release
// that bumps package.json without them leaves the guide describing an older
// framework, so they move with the manifests.
const guidePath = 'docs/framework-guide.html';
const guideReleaseMarkers = [
  /(Release )\d+\.\d+\.\d+( · Gate-capable)/g,
  /(AI Skills Framework )\d+\.\d+\.\d+( · )/g,
];

const packageManifest = JSON.parse(await readFile('package.json', 'utf8'));
const { version } = packageManifest;

for (const manifestPath of manifestPaths) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest.version = version;

  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

let guide = await readFile(guidePath, 'utf8');

for (const marker of guideReleaseMarkers) {
  if (!marker.test(guide)) {
    throw new Error(`${guidePath} no longer carries the release marker ${marker}; update sync-version.mjs with the guide.`);
  }

  marker.lastIndex = 0;
  guide = guide.replace(marker, `$1${version}$2`);
}

await writeFile(guidePath, guide);

console.log(`Synchronized plugin manifests and the framework guide to ${version}.`);
