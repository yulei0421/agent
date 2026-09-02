import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';

export interface SidecarLaunchOptions {
  readonly port: number;
  readonly token: string;
  readonly origin: string;
  readonly rendererDir: string;
  readonly serverEntry: string;
}

export interface DesktopSidecar {
  readonly origin: string;
  readonly token: string;
  readonly child: ChildProcess;
  stop(): Promise<void>;
}

export function createSidecarEnvironment(
  baseEnvironment: NodeJS.ProcessEnv,
  options: Pick<SidecarLaunchOptions, 'port' | 'origin' | 'token' | 'rendererDir'> & { environmentFile?: string }
): NodeJS.ProcessEnv {
  return {
    ...baseEnvironment,
    ELECTRON_RUN_AS_NODE: '1',
    PORT: String(options.port),
    CLIENT_URL: options.origin,
    DESKTOP_SESSION_TOKEN: options.token,
    STATIC_RENDERER_DIR: options.rendererDir,
    ...(options.environmentFile ? { AGENT_ENV_FILE: options.environmentFile } : {})
  };
}

export async function findAvailableLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : undefined;
      server.close((error) => error ? reject(error) : port ? resolve(port) : reject(new Error('Could not reserve a loopback port')));
    });
  });
}

export function createSidecarLaunchOptions(port: number, rendererDir: string, serverEntry: string): SidecarLaunchOptions {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Sidecar port is invalid');
  if (!rendererDir || !serverEntry) throw new Error('Sidecar paths are required');
  return Object.freeze({
    port,
    token: randomBytes(32).toString('base64url'),
    origin: `http://127.0.0.1:${port}`,
    rendererDir,
    serverEntry
  });
}

async function waitForHealth(origin: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 125));
  }
  throw new Error(`Desktop sidecar did not become healthy: ${lastError instanceof Error ? lastError.message : 'timeout'}`);
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.killed) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && !child.killed) child.kill('SIGKILL');
    }, 5_000);
    timer.unref?.();
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
}

export async function startDesktopSidecar(input: {
  readonly port: number;
  readonly token: string;
  readonly origin: string;
  readonly rendererDir: string;
  readonly serverEntry: string;
  readonly executablePath: string;
  readonly environmentFile?: string;
  readonly workingDirectory?: string;
}): Promise<DesktopSidecar> {
  const child = spawn(input.executablePath, [input.serverEntry], {
    ...(input.workingDirectory ? { cwd: input.workingDirectory } : {}),
    env: createSidecarEnvironment(process.env, {
      port: input.port,
      origin: input.origin,
      token: input.token,
      rendererDir: input.rendererDir,
      environmentFile: input.environmentFile
    }),
    stdio: 'inherit'
  });
  try {
    await waitForHealth(input.origin);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return Object.freeze({
    origin: input.origin,
    token: input.token,
    child,
    stop: () => stopChild(child)
  });
}
