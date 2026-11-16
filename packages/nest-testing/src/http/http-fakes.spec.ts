import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import https from 'node:https';
import net, {
  connect as connectTcp,
  createServer as createTcpServer,
  type AddressInfo,
  type Server as TcpServer,
  type Socket,
} from 'node:net';

import { http, HttpResponse } from 'msw';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { startHttpFakes, type HttpFakes } from './http-fakes.js';

/**
 * Function requestWithNodeClient
 *
 * @description
 * Calls a URL with the `node:https` client, as libraries that do not use `fetch` do.
 *
 * @param {string} url - URL to call.
 * @returns {Promise<string>} `status <code>` for a response, `error <message>` for a failure.
 */
function requestWithNodeClient(url: string): Promise<string> {
  return new Promise<string>((resolve: (outcome: string) => void) => {
    https
      .request(url, (response: IncomingMessage): void => {
        response.resume();
        response.on('end', (): void => {
          resolve(`status ${String(response.statusCode)}`);
        });
      })
      .on('error', (error: Error): void => {
        resolve(`error ${error.message}`);
      })
      .end();
  });
}

describe('startHttpFakes', () => {
  let fakes: HttpFakes;
  let local: Server;
  let localUrl: string;

  beforeAll(async () => {
    // msw prints each refused request on the error stream: expected here, and noise in a report.
    vi.spyOn(console, 'error').mockImplementation((): void => undefined);
    local = createServer((_request: IncomingMessage, response: ServerResponse): void => {
      response.end('application under test');
    });
    await new Promise<void>((resolve: () => void) => {
      local.listen(0, '127.0.0.1', resolve);
    });
    localUrl = `http://127.0.0.1:${String((local.address() as AddressInfo).port)}`;
    fakes = startHttpFakes([
      http.get('https://api.github.test/repos/cadenway/app', () =>
        HttpResponse.json({ name: 'app' }),
      ),
    ]);
  });

  afterEach(() => {
    fakes.reset();
  });

  afterAll(async () => {
    fakes.close();
    vi.restoreAllMocks();
    await new Promise<void>((resolve: () => void) => {
      local.close((): void => {
        resolve();
      });
    });
  });

  it('answers a faked third party', async () => {
    const response: Response = await fetch('https://api.github.test/repos/cadenway/app');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: 'app' });
    expect(fakes.unhandled).toEqual([]);
  });

  it('answers the node:https client too', async () => {
    expect(await requestWithNodeClient('https://api.github.test/repos/cadenway/app')).toBe(
      'status 200',
    );
  });

  it('refuses a request no handler answers, without reaching the network', async () => {
    await expect(fetch('https://api.stripe.test/v1/charges', { method: 'POST' })).rejects.toThrow(
      TypeError,
    );
    expect(await requestWithNodeClient('https://gitlab.test/api/v4/projects')).toMatch(/^error /u);

    expect(fakes.unhandled).toEqual([
      'POST https://api.stripe.test/v1/charges',
      'GET https://gitlab.test/api/v4/projects',
    ]);
  });

  it('lets a loopback request reach the application under test', async () => {
    const response: Response = await fetch(`${localUrl}/internal/v1/tasks`);

    expect(await response.text()).toBe('application under test');
    expect(fakes.unhandled).toEqual([]);
  });

  it('takes a handler for one test and forgets it on reset', async () => {
    fakes.use(
      http.post('https://api.stripe.test/v1/charges', () =>
        HttpResponse.json({ id: 'ch_1' }, { status: 201 }),
      ),
    );
    const faked: Response = await fetch('https://api.stripe.test/v1/charges', { method: 'POST' });
    expect(faked.status).toBe(201);

    fakes.reset();

    await expect(fetch('https://api.stripe.test/v1/charges', { method: 'POST' })).rejects.toThrow(
      TypeError,
    );
  });

  it('forgets the refused requests on reset', async () => {
    await expect(fetch('https://api.stripe.test/v1/refunds')).rejects.toThrow(TypeError);
    expect(fakes.unhandled).toHaveLength(1);

    fakes.reset();

    expect(fakes.unhandled).toEqual([]);
  });
});

describe('startHttpFakes with an allowed host', () => {
  it('leaves the named host to the network and refuses the others', async () => {
    vi.spyOn(console, 'error').mockImplementation((): void => undefined);
    const fakes: HttpFakes = startHttpFakes([], { allowHosts: ['registry.invalid'] });
    try {
      // The reserved .invalid domain never resolves: the failure comes from the resolver,
      // which proves the request was let through instead of being refused by the fakes.
      await expect(fetch('https://registry.invalid/')).rejects.toThrow(TypeError);
      expect(fakes.unhandled).toEqual([]);

      await expect(fetch('https://other.invalid/')).rejects.toThrow(TypeError);
      expect(fakes.unhandled).toEqual(['GET https://other.invalid/']);
    } finally {
      fakes.close();
      vi.restoreAllMocks();
    }
  });
});

describe('startHttpFakes with a dependency that does not speak HTTP', () => {
  /**
   * Function readGreeting
   *
   * @description
   * Connects the way the NATS client does: it drops every listener of the socket once
   * connected, then waits for the server to speak first.
   *
   * @param {number} port - Port of the server.
   * @returns {Promise<string>} The first line the server sends.
   */
  function readGreeting(port: number): Promise<string> {
    return new Promise<string>(
      (resolve: (line: string) => void, reject: (error: Error) => void) => {
        const socket: Socket = connectTcp(port, '127.0.0.1', (): void => {
          socket.removeAllListeners();
          socket.once('data', (data: Buffer): void => {
            socket.destroy();
            resolve(data.toString().trim());
          });
          socket.once('error', reject);
        });
        socket.once('error', reject);
        socket.setTimeout(3000, (): void => {
          socket.destroy();
          reject(new Error('The server never spoke: the socket was held back.'));
        });
      },
    );
  }

  it('leaves the declared address alone, so a server that speaks first is heard', async () => {
    const greeter: TcpServer = createTcpServer((socket: Socket): void => {
      socket.write('INFO {"server_name":"disposable"}\r\n');
    });
    await new Promise<void>((resolve: () => void) => {
      greeter.listen(0, '127.0.0.1', resolve);
    });
    const port: number = (greeter.address() as AddressInfo).port;
    const realConnect: Socket['connect'] = net.Socket.prototype.connect;
    const fakes: HttpFakes = startHttpFakes([], {
      tcpAddresses: [`nats://127.0.0.1:${String(port)}`],
    });
    try {
      expect(await readGreeting(port)).toBe('INFO {"server_name":"disposable"}');
      expect(fakes.unhandled).toEqual([]);
    } finally {
      fakes.close();
      await new Promise<void>((resolve: () => void) => {
        greeter.close((): void => {
          resolve();
        });
      });
    }
    // Closing put the socket method of Node.js back.
    expect(net.Socket.prototype.connect).toBe(realConnect);
  });

  it('refuses an address without a port', () => {
    expect(() => startHttpFakes([], { tcpAddresses: ['nats://localhost'] })).toThrow(
      'The address nats://localhost names no port.',
    );
  });
});
