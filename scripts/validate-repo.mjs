import { access, readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];
const expectedName = 'ai-skills-framework';
const expectedRepository = 'https://github.com/emipac/skills';
const portableFrontmatterKeys = new Set([
  'allowed-tools',
  'description',
  'license',
  'metadata',
  'name',
]);

const readJson = async (relativePath) => {
  try {
    return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
  } catch (error) {
    errors.push(`${relativePath}: invalid JSON (${error.message})`);
    return {};
  }
};

const packageManifest = await readJson('package.json');
const claudeManifest = await readJson('.claude-plugin/plugin.json');
const codexManifest = await readJson('.codex-plugin/plugin.json');
const codexMarketplace = await readJson('.agents/plugins/marketplace.json');

if (packageManifest.name !== expectedName) {
  errors.push(`package.json: name must be ${expectedName}`);
}

if (packageManifest.repository?.url !== expectedRepository) {
  errors.push(`package.json: repository must be ${expectedRepository}`);
}

for (const [manifestPath, manifest] of [
  ['.claude-plugin/plugin.json', claudeManifest],
  ['.codex-plugin/plugin.json', codexManifest],
]) {
  if (manifest.name !== expectedName) {
    errors.push(`${manifestPath}: name must be ${expectedName}`);
  }

  if (manifest.version !== packageManifest.version) {
    errors.push(`${manifestPath}: version must match package.json`);
  }
}

if (codexManifest.skills !== './skills/') {
  errors.push('.codex-plugin/plugin.json: skills must be ./skills/');
}

const marketplacePlugin = codexMarketplace.plugins?.find(
  (plugin) => plugin.name === expectedName,
);

if (marketplacePlugin?.source?.path !== './') {
  errors.push('.agents/plugins/marketplace.json: root plugin source must be ./');
}

const skillsRoot = path.join(root, 'skills');
const skillDirectoryEntries = (await readdir(skillsRoot, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .sort((left, right) => left.name.localeCompare(right.name));
const releasedSkills = [];

for (const entry of skillDirectoryEntries) {
  const skillPath = path.join(skillsRoot, entry.name, 'SKILL.md');

  try {
    await access(skillPath);
  } catch {
    errors.push(`skills/${entry.name}: released skill directory must contain SKILL.md`);
    continue;
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.name)) {
    errors.push(`skills/${entry.name}: directory name must be kebab-case`);
  }

  const skillDocument = await readFile(skillPath, 'utf8');
  const frontmatterMatch = skillDocument.match(/^---\n([\s\S]*?)\n---\n/);

  if (!frontmatterMatch) {
    errors.push(`skills/${entry.name}/SKILL.md: missing YAML frontmatter`);
    continue;
  }

  const nameMatch = frontmatterMatch[1].match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatterMatch[1].match(/^description:\s*(.+)$/m);
  const frontmatterKeys = [
    ...frontmatterMatch[1].matchAll(/^([a-z][a-z0-9-]*):/gm),
  ].map((match) => match[1]);

  for (const frontmatterKey of frontmatterKeys) {
    if (!portableFrontmatterKeys.has(frontmatterKey)) {
      errors.push(
        `skills/${entry.name}/SKILL.md: non-portable frontmatter key ${frontmatterKey}`,
      );
    }
  }

  if (nameMatch?.[1].trim() !== entry.name) {
    errors.push(`skills/${entry.name}/SKILL.md: frontmatter name must match directory`);
  }

  if (!descriptionMatch?.[1].trim()) {
    errors.push(`skills/${entry.name}/SKILL.md: description is required`);
  }

  releasedSkills.push(entry.name);
}

const claudeSkills = Array.isArray(claudeManifest.skills)
  ? claudeManifest.skills.map((skillPath) => skillPath.replace('./skills/', '')).sort()
  : [];

if (JSON.stringify(claudeSkills) !== JSON.stringify(releasedSkills)) {
  errors.push('.claude-plugin/plugin.json: skills must exactly match released skills/ directories');
}

const nestedSkillDocuments = [];

const findSkillDocuments = async (directory, depth = 0) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await findSkillDocuments(entryPath, depth + 1);
    } else if (entry.name === 'SKILL.md' && depth !== 1) {
      nestedSkillDocuments.push(path.relative(root, entryPath));
    }
  }
};

await findSkillDocuments(skillsRoot);

for (const skillDocument of nestedSkillDocuments) {
  errors.push(`${skillDocument}: released SKILL.md must be exactly one directory below skills/`);
}

const markdownFiles = [];

const collectMarkdownFiles = async (directory) => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (
      ['.git', 'node_modules'].includes(entry.name)
      || (directory === root && ['deprecated', 'experimental'].includes(entry.name))
    ) {
      continue;
    }

    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      await collectMarkdownFiles(entryPath);
    } else if (entry.name.endsWith('.md')) {
      markdownFiles.push(entryPath);
    }
  }
};

await collectMarkdownFiles(root);

for (const markdownPath of markdownFiles) {
  const markdown = (await readFile(markdownPath, 'utf8')).replace(
    /```[\s\S]*?```/g,
    '',
  );
  const linkPattern = /(?<!!)\[[^\]]*\]\(([^)]+)\)/g;

  for (const match of markdown.matchAll(linkPattern)) {
    const rawTarget = match[1].trim().replace(/^<|>$/g, '');

    if (/^(?:[a-z]+:|#)/i.test(rawTarget)) {
      continue;
    }

    const targetWithoutAnchor = decodeURIComponent(rawTarget.split('#')[0]);

    if (!targetWithoutAnchor) {
      continue;
    }

    const resolvedTarget = path.resolve(path.dirname(markdownPath), targetWithoutAnchor);

    try {
      await stat(resolvedTarget);
    } catch {
      errors.push(
        `${path.relative(root, markdownPath)}: broken relative link ${rawTarget}`,
      );
    }
  }
}

if (errors.length > 0) {
  console.error(`Repository validation failed with ${errors.length} error(s):`);

  for (const error of errors) {
    console.error(`- ${error}`);
  }

  process.exit(1);
}

console.log(`Validated ${releasedSkills.length} released skills and ${markdownFiles.length} Markdown files.`);
