import { existsSync } from 'node:fs';
import { join } from 'node:path';

export interface DesktopEnvironmentFileOptions {
  readonly configuredFile?: string;
  readonly userDataDirectory: string;
  readonly brandedUserDataDirectory: string;
  readonly applicationDirectory: string;
}

export function resolveDesktopEnvironmentFile(options: DesktopEnvironmentFileOptions): string | undefined {
  const configuredFile = options.configuredFile?.trim();
  if (configuredFile) {
    if (!existsSync(configuredFile)) throw new Error(`AGENT_ENV_FILE does not exist: ${configuredFile}`);
    return configuredFile;
  }

  const candidates = [
    join(options.userDataDirectory, '.env'),
    join(options.brandedUserDataDirectory, '.env'),
    join(options.applicationDirectory, '.env')
  ];
  return candidates.find((candidate, index) => candidates.indexOf(candidate) === index && existsSync(candidate));
}
