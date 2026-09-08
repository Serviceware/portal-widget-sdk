import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { randomUUID } from 'crypto';

interface WidgetMetadata {
    id: string;
    name: string;
    logo: string | null;
    tags: string[];
    meta: Array<{
        language: string;
        name: string;
        description: string;
        descriptionShort: string;
    }>;
    widgetVersion: WidgetVersion;
}

interface WidgetVersion {
    id: string;
    name: string;
    number: string;
    date: string;
    state: string;
    authenticated: boolean;
    angularVersion: number;
    defaultSize: { columns: number; rows: number };
    filename: string;
    changes: Array<{ language: string; description: string }>;
    dependencies: Array<{ name: string; dependency: string }>;
}

interface ChangelogChanges {
    Added: string[];
    Changed: string[];
    Deprecated: string[];
    Removed: string[];
    Fixed: string[];
    Security: string[];
}

interface PackageJson {
    version?: string;
}

interface CLIOptions {
    widgetPath: string;
    version?: string;
    date?: string;
    languages: string[];
    dryRun: boolean;
    interactive: boolean;
    force: boolean;
    authenticated?: boolean;
    angularVersion?: number;
    defaultSize?: { columns: number; rows: number };
    dependencies: Array<{ name: string; dependency: string }>;
}

interface WidgetVersionUpdates {
    authenticated?: boolean;
    angularVersion?: number;
    defaultSize?: { columns: number; rows: number };
    dependencies: Array<{ name: string; dependency: string }>;
}

function parseBooleanFlag(value: string, flagLabel: string): boolean {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
    throw new Error(`Invalid value for ${flagLabel}. Expected true or false.`);
}

function parsePositiveInt(value: string, flagLabel: string): number {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) {
        throw new Error(`Invalid value for ${flagLabel}. Expected a non-negative integer.`);
    }
    return n;
}

function parseSize(value: string): { columns: number; rows: number } {
    const m = value.trim().match(/^(\d+)x(\d+)$/);
    if (!m) throw new Error('Invalid size format. Expected <columns>x<rows> (e.g., 2x1).');
    return { columns: parsePositiveInt(m[1], 'columns'), rows: parsePositiveInt(m[2], 'rows') };
}

function parseDependency(value: string): { name: string; dependency: string } {
    const trimmed = value.trim();
    // Try to match: Name=Constraint (e.g., Portal=>2.2.0) or Name<operator>Version (e.g., Portal>2.2.0)
    const match = trimmed.match(/^([^=<>\s]+)\s*=?\s*((?:>=|<=|>|<|=).*)$/);
    if (!match || !match[1] || !match[2]) {
        throw new Error(
            'Invalid dependency format. Expected Name=Constraint or Name<operator>Version (e.g., Portal=>2.2.0 or Portal>2.2.0).'
        );
    }
    return { name: match[1].trim(), dependency: match[2].trim() };
}

function partitionLanguages(metadata: WidgetMetadata, languages: string[]): { valid: string[]; invalid: string[] } {
    const available = new Set(metadata.meta.map(m => m.language));
    const valid: string[] = [];
    const invalid: string[] = [];
    for (const l of languages) {
        if (available.has(l)) valid.push(l);
        else invalid.push(l);
    }
    return { valid, invalid };
}

function warnUnknownLanguages(invalid: string[]): void {
    if (invalid.length > 0) {
        console.warn(`⚠️ Warning: unknown languages will be ignored: ${invalid.join(', ')}`);
    }
}

/**
 * Format change description input into HTML.
 * - If input contains HTML tags, return as-is (wrapped in <p> if needed)
 * - If single sentence, wrap in <p>...</p>
 * - If multiple sentences (split by ". "), create <ul><li><p>...</p></li></ul>
 */
function formatChangeDescription(input: string): string {
    const trimmed = input.trim();

    // If already contains HTML, return as-is wrapped in <p> if not already wrapped
    if (trimmed.includes('<') || trimmed.includes('>')) {
        return trimmed.startsWith('<') ? trimmed : `<p>${trimmed}</p>`;
    }

    // Split on ". " to get sentences, keeping the period
    const sentences = trimmed
        .split(/\.\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(s => (s.endsWith('.') ? s : `${s}.`)); // Ensure period at end

    // Single sentence: wrap in <p>
    if (sentences.length === 1) {
        return `<p>${sentences[0]}</p>`;
    }

    // Multiple sentences: create list
    const listItems = sentences.map(s => `<li><p>${s}</p></li>`).join('');
    return `<ul>${listItems}</ul>`;
}

/**
 * Prompt for user-facing changes: choose languages and enter descriptions
 */
async function promptForUserFacingChanges(
    metadata: WidgetMetadata,
    preselectedLanguages?: string[]
): Promise<Map<string, string>> {
    const available = metadata.meta.map(m => m.language);
    const metadataChanges = new Map<string, string>();

    // If languages are provided via flags in interactive mode, skip the initial yes/no
    let selected: string[] = [];
    if (preselectedLanguages && preselectedLanguages.length > 0) {
        const { valid, invalid } = partitionLanguages(metadata, preselectedLanguages);
        warnUnknownLanguages(invalid);
        selected = valid;
    } else {
        const shouldUpdate = (await question('\nUpdate user-facing change descriptions? (y/N): ')).trim().toLowerCase();
        if (!(shouldUpdate === 'y' || shouldUpdate === 'yes')) {
            return metadataChanges;
        }

        console.log(`Available languages: ${available.join(', ')}`);
        const input = (await question('Enter language codes to update (comma-separated), or blank to skip: ')).trim();
        if (!input) return metadataChanges;

        const requested = input
            .split(',')
            .map(s => s.trim())
            .filter(s => !!s);

        const { valid, invalid } = partitionLanguages(metadata, requested);
        warnUnknownLanguages(invalid);
        selected = valid;
    }

    if (selected.length === 0) return metadataChanges;

    console.log('\n=== widget-metadata.json Changes ===');
    console.log('Enter user-facing change descriptions for each language.');
    console.log('(Leave blank to keep existing description for that language)');
    console.log('TIP: Enter multiple sentences separated by periods to create a bulleted list.');

    for (const lang of selected) {
        const description = await question(`\n[${lang}] Change description: `);
        if (description.trim()) {
            metadataChanges.set(lang, formatChangeDescription(description));
        }
    }
    return metadataChanges;
}

// Create readline interface for user input
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

/**
 * Promisify readline question
 */
function question(query: string): Promise<string> {
    return new Promise(resolve => {
        rl.question(query, (answer: string) => {
            resolve(answer);
        });
    });
}

/**
 * Execute command in terminal
 */
function run(command: string): void {
    console.log(`\n› ${command}`);
    execSync(command, { stdio: 'inherit' });
}

/**
 * Parse command line arguments
 */
function parseArguments(): CLIOptions {
    const args = process.argv.slice(2);
    const options: CLIOptions = {
        widgetPath: process.cwd(),
        dryRun: false,
        interactive: true,
        force: false,
        languages: [],
        dependencies: []
    };

    let pendingSizeCols: number | undefined;
    let pendingSizeRows: number | undefined;

    for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        switch (arg) {
            case '--widget':
                options.widgetPath = path.resolve(args[++i]);
                break;
            case '--version':
                options.version = args[++i];
                break;
            case '--date':
                options.date = args[++i];
                break;
            case '--lang':
                options.languages = args[++i].split(',').map(l => l.trim());
                break;
            case '--dry-run':
                options.dryRun = true;
                break;
            case '--no-interactive':
                options.interactive = false;
                break;
            case '--force':
                options.force = true;
                break;
            case '--authenticated':
                options.authenticated = parseBooleanFlag(args[++i], '--authenticated');
                break;
            case '--angular':
            case '--angular-version':
                options.angularVersion = parsePositiveInt(args[++i], '--angular');
                break;
            case '--size':
            case '--default-size':
                options.defaultSize = parseSize(args[++i]);
                break;
            case '--size-cols':
                pendingSizeCols = parsePositiveInt(args[++i], '--size-cols');
                break;
            case '--size-rows':
                pendingSizeRows = parsePositiveInt(args[++i], '--size-rows');
                break;
            case '--dependency':
            case '--dep':
                options.dependencies.push(parseDependency(args[++i]));
                break;
            case '--help':
            case '-h':
                printHelp();
                process.exit(0);
                break;
            default:
                // Support shorthand like --size2x1
                if (arg.startsWith('--size') && /^--size\d+x\d+$/.test(arg)) {
                    const sizePart = arg.replace(/^--size/, '');
                    options.defaultSize = parseSize(sizePart);
                    break;
                }
                if (arg.startsWith('--')) {
                    console.error(`Unknown option: ${arg}`);
                    process.exit(1);
                }
                break;
        }
    }

    if (!options.defaultSize && (pendingSizeCols !== undefined || pendingSizeRows !== undefined)) {
        if (pendingSizeCols === undefined || pendingSizeRows === undefined) {
            console.error('❌ Error: --size-cols and --size-rows must be provided together');
            process.exit(1);
        }
        options.defaultSize = { columns: pendingSizeCols, rows: pendingSizeRows };
    }

    return options;
}

/**
 * Print help message
 */
function printHelp(): void {
    console.log(`
Widget Release Preparation Tool

Usage: prepare-widget-release [options]

Options:
  --widget <path>                Path to widget root directory (default: current directory)
  --version <semver>             Target version (e.g., 1.2.3)
  --date <YYYY-MM-DD>            Release date (default: today)
  --lang <codes>                 Comma-separated language codes to update in metadata (e.g., en,de)
  --dry-run                      Preview changes without writing files
  --no-interactive               Non-interactive mode (requires --version)
  --force                        Bypass version validation checks
  --authenticated <true|false>   Update widgetVersion.authenticated (blank to skip in interactive)
  --angular <number>             Update widgetVersion.angularVersion (integer)
  --size <cols>x<rows>           Update widgetVersion.defaultSize (e.g., 2x1)
  --size-cols <cols>             Columns part of default size (use with --size-rows)
  --size-rows <rows>             Rows part of default size (use with --size-cols)
  --dep <dependency>             Upsert widgetVersion.dependencies (e.g., Portal>2.2.0, can be repeated)
  -h, --help                     Show this help message

Examples:
  # Interactive mode
  prepare-widget-release --widget ./widgets/my-widget

  # Non-interactive mode
  prepare-widget-release --widget ./widgets/my-widget --version 2.1.0 --angular 19 --authenticated true --no-interactive

  # Shorthand size flag
  prepare-widget-release --widget ./widgets/my-widget --version 2.1.0 --size2x1 --no-interactive
`);
}

/**
 * Validate semantic version format
 */
function isValidSemver(version: string): boolean {
    const semverRegex = /^\d+\.\d+\.\d+$/;
    return semverRegex.test(version);
}

/**
 * Compare two semantic versions
 * @returns -1 if v1 < v2, 0 if equal, 1 if v1 > v2
 */
function compareSemver(v1: string, v2: string): number {
    const parts1 = v1.split('.').map(Number);
    const parts2 = v2.split('.').map(Number);

    for (let i = 0; i < 3; i++) {
        if (parts1[i] > parts2[i]) return 1;
        if (parts1[i] < parts2[i]) return -1;
    }
    return 0;
}

/**
 * Calculate new version based on current version and bump type
 */
function calculateNewVersion(currentVersion: string, bumpType: 'major' | 'minor' | 'patch'): string {
    const [major, minor, patch] = currentVersion.split('.').map(Number);

    switch (bumpType) {
        case 'major':
            return `${major + 1}.0.0`;
        case 'minor':
            return `${major}.${minor + 1}.0`;
        case 'patch':
            return `${major}.${minor}.${patch + 1}`;
        default:
            throw new Error(`Invalid bump type: ${bumpType}`);
    }
}

/**
 * Generate a new UUID v4
 */
function generateUUID(): string {
    return randomUUID();
}

/**
 * Get current date in YYYY-MM-DD HH:mm format (UTC)
 */
function getCurrentDate(dateOverride?: string): string {
    if (dateOverride) {
        return `${dateOverride} 10:00`;
    }
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, '0');
    const day = String(now.getUTCDate()).padStart(2, '0');
    const hours = String(now.getUTCHours()).padStart(2, '0');
    const minutes = String(now.getUTCMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}`;
}

/**
 * Load widget metadata
 */
function loadWidgetMetadata(widgetPath: string): WidgetMetadata {
    const metadataPath = path.join(widgetPath, 'widget-metadata.json');
    if (!fs.existsSync(metadataPath)) {
        throw new Error(`widget-metadata.json not found at: ${metadataPath}`);
    }
    return JSON.parse(fs.readFileSync(metadataPath, 'utf8')) as WidgetMetadata;
}

/**
 * Load package.json if exists
 */
function loadPackageJson(widgetPath: string): PackageJson | null {
    const pkgPath = path.join(widgetPath, 'package.json');
    if (!fs.existsSync(pkgPath)) {
        return null;
    }
    return JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as PackageJson;
}

/**
 * Gets a multi-line input from the user
 */
async function getMultilineInput(prompt: string): Promise<string[]> {
    console.log(prompt);
    console.log('(Enter a blank line when finished)');

    const lines: string[] = [];
    let line: string;

    do {
        line = await question('> ');
        if (line.trim()) {
            lines.push(line.trim());
        }
    } while (line.trim());

    return lines;
}

/**
 * Prompt for changelog changes
 */
async function promptForChangelogChanges(): Promise<ChangelogChanges> {
    console.log('\n=== CHANGELOG.md Updates (Keep a Changelog format) ===');
    console.log('\nPlease enter technical changes for this release:');

    const changes: ChangelogChanges = {
        Added: [],
        Changed: [],
        Deprecated: [],
        Removed: [],
        Fixed: [],
        Security: []
    };

    console.log('\n📦 ADDED (new features):');
    changes.Added = await getMultilineInput('Enter new features/additions (one per line):');

    console.log('\n🔄 CHANGED (changes in existing functionality):');
    changes.Changed = await getMultilineInput('Enter changes to existing functionality (one per line):');

    console.log('\n⚠️ DEPRECATED (soon-to-be removed features):');
    changes.Deprecated = await getMultilineInput('Enter deprecated features (one per line):');

    console.log('\n🐛 FIXED (bug fixes):');
    changes.Fixed = await getMultilineInput('Enter bug fixes (one per line):');

    console.log('\n🔒 SECURITY (vulnerabilities):');
    changes.Security = await getMultilineInput('Enter security fixes (one per line):');

    console.log('\n🗑️ REMOVED (removed features):');
    changes.Removed = await getMultilineInput('Enter removed features (one per line):');

    // Check if any changes were entered
    const hasChanges = Object.values(changes).some(category => category.length > 0);
    if (!hasChanges) {
        console.log('\n⚠️ No changes entered. Please enter at least one change.');
        return promptForChangelogChanges();
    }

    return changes;
}

/**
 * Prompt for version bump type
 */
async function promptForVersion(currentVersion: string): Promise<string> {
    console.log('\nSelect version bump type:');
    console.log('1. patch - for backwards compatible bug fixes');
    console.log('2. minor - for backwards compatible new features');
    console.log('3. major - for breaking changes');
    console.log('4. custom - enter a specific version');

    const choice = await question('Enter your choice (1-4): ');

    if (choice === '4') {
        let customVersion = await question('Enter version (e.g., 2.1.0): ');
        while (!isValidSemver(customVersion)) {
            console.log('❌ Invalid version format. Use semantic versioning (e.g., 1.2.3)');
            customVersion = await question('Enter version: ');
        }
        return customVersion;
    }

    const bumpTypeMap: Record<string, 'major' | 'minor' | 'patch'> = {
        '1': 'patch',
        '2': 'minor',
        '3': 'major'
    };

    const bumpType = bumpTypeMap[choice];

    if (!bumpType) {
        console.log('❌ Invalid choice. Please try again.');
        return promptForVersion(currentVersion);
    }

    return calculateNewVersion(currentVersion, bumpType);
}

/**
 * Prompt for metadata changes per language
 */
// removed: promptForMetadataChanges (now handled by promptForUserFacingChanges)

async function promptForWidgetVersionUpdates(current: WidgetVersion): Promise<WidgetVersionUpdates> {
    const updates: WidgetVersionUpdates = { dependencies: [] };

    console.log('\n=== Widget settings ===');

    // Authenticated
    const authInput = await question(
        `Require authentication [current: ${current.authenticated ? 'true' : 'false'}] (true/false, blank to keep): `
    );
    if (authInput.trim()) {
        try {
            updates.authenticated = parseBooleanFlag(authInput, 'authenticated');
        } catch (e) {
            console.log(`Skipping invalid authenticated value: ${(e as Error).message}`);
        }
    }

    // Angular version
    const angInput = await question(`Angular version [current: ${current.angularVersion}] (integer, blank to keep): `);
    if (angInput.trim()) {
        try {
            updates.angularVersion = parsePositiveInt(angInput, 'angular');
        } catch (e) {
            console.log(`Skipping invalid angular version: ${(e as Error).message}`);
        }
    }

    // Default size
    const sizeInput = await question(
        `Default size [current: ${current.defaultSize.columns}x${current.defaultSize.rows}] (<cols>x<rows>, blank to keep): `
    );
    if (sizeInput.trim()) {
        try {
            updates.defaultSize = parseSize(sizeInput);
        } catch (e) {
            console.log(`Skipping invalid size value: ${(e as Error).message}`);
        }
    }

    // Dependencies (multi-line Name=Constraint or Name>Version)
    console.log(
        '\nProduct dependencies (e.g., Portal>2.2.0 or Portal=>2.2.0). Enter one per line. Blank line to finish.'
    );
    const depLines = await getMultilineInput('Enter product dependency updates:');
    for (const line of depLines) {
        try {
            updates.dependencies.push(parseDependency(line));
        } catch (e) {
            console.log(`Skipping invalid dependency '${line}': ${(e as Error).message}`);
        }
    }

    return updates;
}

/**
 * Update CHANGELOG.md with new entry
 */
function updateChangelog(
    widgetPath: string,
    version: string,
    date: string,
    changes: ChangelogChanges,
    dryRun: boolean
): void {
    const changelogPath = path.join(widgetPath, 'CHANGELOG.md');

    // Extract just the date part (YYYY-MM-DD) from the full date string
    const dateOnly = date.split(' ')[0];

    // Build changelog entry using Keep a Changelog format
    let changelogEntry = `## ${version} (${dateOnly})\n`;

    // Add each category of changes to the changelog
    for (const [category, items] of Object.entries(changes)) {
        if (items.length > 0) {
            changelogEntry += `\n### ${category}\n\n`;
            for (const item of items) {
                changelogEntry += `- ${item.trim()}\n`;
            }
        }
    }

    let changelog = '';
    if (fs.existsSync(changelogPath)) {
        changelog = fs.readFileSync(changelogPath, 'utf8');
    }

    // If changelog exists, insert new entry at the top
    if (changelog) {
        // Find the first version entry (## x.y.z)
        const firstEntryMatch = changelog.match(/^## \d+\.\d+\.\d+/m);

        if (firstEntryMatch && firstEntryMatch.index !== undefined) {
            const insertIndex = firstEntryMatch.index;
            changelog = changelog.substring(0, insertIndex) + changelogEntry + '\n' + changelog.substring(insertIndex);
        } else {
            // No existing entries, append at the end
            changelog += '\n' + changelogEntry;
        }
    } else {
        // Create new changelog
        changelog = changelogEntry;
    }

    if (!dryRun) {
        fs.writeFileSync(changelogPath, changelog, 'utf8');
        console.log(`✅ Updated ${changelogPath}`);
    } else {
        console.log(`\n[DRY RUN] Would update ${changelogPath}:`);
        console.log(changelogEntry);
    }
}

/**
 * Update widget-metadata.json with new version info
 */
function updateWidgetMetadata(
    widgetPath: string,
    version: string,
    date: string,
    metadataChanges: Map<string, string>,
    widgetUpdates: WidgetVersionUpdates,
    dryRun: boolean
): void {
    const metadataPath = path.join(widgetPath, 'widget-metadata.json');
    const metadata = loadWidgetMetadata(widgetPath);

    // Update widgetVersion fields
    metadata.widgetVersion.id = generateUUID();
    metadata.widgetVersion.number = version;
    metadata.widgetVersion.date = date;
    metadata.widgetVersion.state = 'released';
    metadata.widgetVersion.filename = `${metadata.widgetVersion.name}-${version}.tar.gz`;

    // Apply technical updates if provided
    if (widgetUpdates.authenticated !== undefined) {
        metadata.widgetVersion.authenticated = widgetUpdates.authenticated;
    }
    if (widgetUpdates.angularVersion !== undefined) {
        metadata.widgetVersion.angularVersion = widgetUpdates.angularVersion;
    }
    if (widgetUpdates.defaultSize) {
        metadata.widgetVersion.defaultSize = widgetUpdates.defaultSize;
    }
    if (widgetUpdates.dependencies && widgetUpdates.dependencies.length > 0) {
        for (const { name, dependency } of widgetUpdates.dependencies) {
            const existing = metadata.widgetVersion.dependencies.find(d => d.name === name);
            if (existing) existing.dependency = dependency;
            else metadata.widgetVersion.dependencies.push({ name, dependency });
        }
    }

    // Update changes array for specified languages
    if (metadataChanges.size > 0) {
        for (const [lang, description] of metadataChanges.entries()) {
            const existingChange = metadata.widgetVersion.changes.find(c => c.language === lang);
            if (existingChange) {
                existingChange.description = description;
            } else {
                metadata.widgetVersion.changes.push({ language: lang, description });
            }
        }
    }

    if (!dryRun) {
        fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 4) + '\n', 'utf8');
        console.log(`✅ Updated ${metadataPath}`);
    } else {
        console.log(`\n[DRY RUN] Would update ${metadataPath}:`);
        console.log(`  Version: ${metadata.widgetVersion.number}`);
        console.log(`  Date: ${metadata.widgetVersion.date}`);
        console.log(`  ID: ${metadata.widgetVersion.id}`);
        console.log(`  Filename: ${metadata.widgetVersion.filename}`);
        if (widgetUpdates.authenticated !== undefined) {
            console.log(`  Authenticated: ${widgetUpdates.authenticated}`);
        }
        if (widgetUpdates.angularVersion !== undefined) {
            console.log(`  Angular version: ${widgetUpdates.angularVersion}`);
        }
        if (widgetUpdates.defaultSize) {
            console.log(`  Default size: ${widgetUpdates.defaultSize.columns}x${widgetUpdates.defaultSize.rows}`);
        }
        if (widgetUpdates.dependencies && widgetUpdates.dependencies.length > 0) {
            console.log('  Dependencies to upsert:');
            for (const { name, dependency } of widgetUpdates.dependencies) {
                console.log(`    ${name}: ${dependency}`);
            }
        }
        if (metadataChanges.size > 0) {
            console.log('  Changes (user-facing):');
            for (const [lang, desc] of metadataChanges.entries()) {
                console.log(`    [${lang}] ${desc}`);
            }
        }
    }
}

/**
 * Format files with Prettier
 */
function formatWithPrettier(filePaths: string[]): void {
    try {
        const files = filePaths.join(' ');
        run(`pnpm prettier --write ${files}`);
    } catch (_error) {
        console.warn('⚠️ Warning: prettier formatting failed, but continuing');
    }
}

/**
 * Main function
 */
async function main(): Promise<void> {
    try {
        const options = parseArguments();

        console.log('\n🚀 Widget Release Preparation Tool\n');
        console.log(`Widget path: ${options.widgetPath}`);

        // Load widget metadata
        const metadata = loadWidgetMetadata(options.widgetPath);
        const currentVersion = metadata.widgetVersion.number;
        console.log(`Current version: ${currentVersion}`);
        console.log(`Widget name: ${metadata.widgetVersion.name}`);

        // Load package.json if exists
        const packageJson = loadPackageJson(options.widgetPath);
        if (packageJson && packageJson.version) {
            console.log(`Package.json version: ${packageJson.version}`);
        }

        // Determine target version
        let targetVersion = options.version;

        if (!targetVersion && options.interactive) {
            targetVersion = await promptForVersion(currentVersion);
        } else if (!targetVersion) {
            console.error('❌ Error: --version is required in non-interactive mode');
            process.exit(1);
        }

        // Validate version
        if (!isValidSemver(targetVersion)) {
            console.error(`❌ Error: Invalid version format: ${targetVersion}`);
            process.exit(1);
        }

        // Check if version is higher than current
        if (compareSemver(targetVersion, currentVersion) <= 0 && !options.force) {
            console.error(
                `❌ Error: Target version (${targetVersion}) must be higher than current version (${currentVersion})`
            );
            console.error('Use --force to bypass this check');
            process.exit(1);
        }

        // Check version consistency with package.json
        if (packageJson && packageJson.version && packageJson.version !== targetVersion && !options.force) {
            console.error(
                `❌ Error: Target version (${targetVersion}) does not match package.json version (${packageJson.version})`
            );
            console.error('Use --force to bypass this check');
            process.exit(1);
        }

        // Get changelog changes (interactive only)
        let changelogChanges: ChangelogChanges | null = null;
        if (options.interactive) {
            changelogChanges = await promptForChangelogChanges();
        }

        // Get metadata changes (single streamlined step)
        let metadataChanges = new Map<string, string>();
        if (options.interactive) {
            metadataChanges = await promptForUserFacingChanges(metadata, options.languages);
        } else {
            // Non-interactive mode: honor --lang only for applying provided values? (no prompts in non-interactive)
            // By design, metadataChanges remains empty in non-interactive mode.
        }

        // Get optional field updates (interactive or from flags)
        let widgetUpdates: WidgetVersionUpdates = { dependencies: [] };
        if (options.interactive) {
            const updateTech = (
                await question(
                    '\nUpdate rest of fields (authentication requirement, Angular version, default size, product dependencies)? (y/N): '
                )
            )
                .trim()
                .toLowerCase();
            if (updateTech === 'y' || updateTech === 'yes') {
                widgetUpdates = await promptForWidgetVersionUpdates(metadata.widgetVersion);
            }
        } else {
            if (options.authenticated !== undefined) widgetUpdates.authenticated = options.authenticated;
            if (options.angularVersion !== undefined) widgetUpdates.angularVersion = options.angularVersion;
            if (options.defaultSize) widgetUpdates.defaultSize = options.defaultSize;
            if (options.dependencies.length > 0) widgetUpdates.dependencies = options.dependencies;
        }

        // Get target date
        const targetDate = getCurrentDate(options.date);

        // Show summary
        console.log('\n📋 Summary of changes:');
        console.log(`Version: ${currentVersion} → ${targetVersion}`);
        console.log(`Date: ${targetDate}`);

        if (changelogChanges) {
            console.log('\nCHANGELOG.md updates:');
            for (const [category, items] of Object.entries(changelogChanges)) {
                if (items.length > 0) {
                    console.log(`  ${category}:`);
                    for (const item of items) {
                        console.log(`    - ${item}`);
                    }
                }
            }
        } else {
            console.log('\nCHANGELOG.md updates: (skipped in non-interactive mode)');
        }

        if (metadataChanges.size > 0) {
            console.log('\nwidget-metadata.json user-facing changes:');
            for (const [lang, desc] of metadataChanges.entries()) {
                console.log(`  [${lang}] ${desc}`);
            }
        }

        if (
            widgetUpdates.authenticated !== undefined ||
            widgetUpdates.angularVersion !== undefined ||
            widgetUpdates.defaultSize ||
            (widgetUpdates.dependencies && widgetUpdates.dependencies.length > 0)
        ) {
            console.log('\nwidget-metadata.json settings to update:');
            if (widgetUpdates.authenticated !== undefined) {
                console.log(`  Require authentication → ${widgetUpdates.authenticated}`);
            }
            if (widgetUpdates.angularVersion !== undefined) {
                console.log(`  Angular version → ${widgetUpdates.angularVersion}`);
            }
            if (widgetUpdates.defaultSize) {
                console.log(`  Default size → ${widgetUpdates.defaultSize.columns}x${widgetUpdates.defaultSize.rows}`);
            }
            if (widgetUpdates.dependencies && widgetUpdates.dependencies.length > 0) {
                console.log('  Product dependencies to upsert:');
                for (const { name, dependency } of widgetUpdates.dependencies) {
                    console.log(`    ${name}: ${dependency}`);
                }
            }
        }

        // Confirm in interactive mode
        if (options.interactive && !options.dryRun) {
            const confirm = await question('\nDo you want to proceed with these changes? (y/N): ');
            if (!(confirm.toLowerCase() === 'y' || confirm.toLowerCase() === 'yes')) {
                console.log('Release preparation cancelled by user.');
                return;
            }
        }

        // Update files
        if (options.interactive) {
            // Only update changelog in interactive mode
            const dateOnly = targetDate.split(' ')[0];
            updateChangelog(
                options.widgetPath,
                targetVersion,
                dateOnly,
                changelogChanges as ChangelogChanges,
                options.dryRun
            );
        }
        updateWidgetMetadata(
            options.widgetPath,
            targetVersion,
            targetDate,
            metadataChanges,
            widgetUpdates,
            options.dryRun
        );

        // Format with Prettier if not dry run
        if (!options.dryRun) {
            console.log('\n› Formatting files with Prettier...');
            const files: string[] = [path.join(options.widgetPath, 'widget-metadata.json')];
            if (options.interactive) files.unshift(path.join(options.widgetPath, 'CHANGELOG.md'));
            formatWithPrettier(files);
        }

        console.log('\n✅ Widget release preparation completed successfully!');
        console.log(`\nWidget has been prepared for release v${targetVersion}`);

        if (!options.dryRun) {
            console.log('\nNext steps:');
            console.log('1. Review the changes in CHANGELOG.md and widget-metadata.json');
            console.log('2. Commit the changes to your repository');
            console.log('3. Create and merge the PR to trigger the release pipeline');
        }
    } catch (error) {
        console.error('\n❌ Error during release preparation:', (error as Error).message);
        process.exit(1);
    } finally {
        rl.close();
    }
}

// Run the main function
main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
});
