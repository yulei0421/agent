import { copyFile, mkdir } from 'node:fs/promises';

await mkdir('dist-electron', { recursive: true });
await copyFile('electron/package.json', 'dist-electron/package.json');
