#!/usr/bin/env node
import { main } from './cli/main';

main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : 'Unknown error.';
    console.error(`Error: ${message}`);
    process.exitCode = 1;
});
