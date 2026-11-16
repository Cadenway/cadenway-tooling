import net from 'node:net';

import type { AnyHandler } from 'msw';
import { setupServer, type SetupServer } from 'msw/node';

/**
 * Interface HttpFakesOptions
 *
 * @description
 * Options of `startHttpFakes`.
 */
export interface HttpFakesOptions {
  // #region Properties
  /**
   * Property tcpAddresses
   *
   * @description
   * Addresses of the dependencies that do not speak HTTP, as URLs or `host:port`: the disposable
   * NATS, PostgreSQL and Redis servers. Their connections are left alone entirely. `msw`
   * otherwise holds every new socket until the client writes, to tell whether it carries HTTP,
   * and the NATS client, which waits for the server to speak first, would never connect.
   *
   * @type {readonly string[] | undefined}
   * @readonly
   */
  readonly tcpAddresses?: readonly string[];

  /**
   * Property allowHosts
   *
   * @description
   * Host names that stay reachable for real besides the loopback ones, for a dependency of the
   * test itself that speaks HTTP on another address. Never a third party.
   *
   * @type {readonly string[] | undefined}
   * @readonly
   */
  readonly allowHosts?: readonly string[];
  // #endregion
}

/**
 * Interface HttpFakes
 *
 * @description
 * Fakes of the HTTP systems the application under test calls, built on `msw`. While they run, a
 * request that no handler answers fails instead of reaching the network; only loopback addresses
 * stay reachable, so the application under test can still be called.
 */
export interface HttpFakes {
  // #region Properties
  /**
   * Property unhandled
   *
   * @description
   * Requests that were refused because no handler answered them, as `<METHOD> <url>`, in order.
   * Empty in a test that fakes everything it calls.
   *
   * @type {readonly string[]}
   * @readonly
   */
  readonly unhandled: readonly string[];
  // #endregion

  // #region Methods
  /**
   * Method use
   *
   * @description
   * Adds handlers for the current test; they take precedence over the initial ones.
   *
   * @param {AnyHandler[]} handlers - Handlers built with `http` of this package.
   * @returns {void}
   */
  use(...handlers: AnyHandler[]): void;

  /**
   * Method reset
   *
   * @description
   * Removes the handlers added with `use` and forgets the refused requests, between two tests.
   *
   * @returns {void}
   */
  reset(): void;

  /**
   * Method close
   *
   * @description
   * Stops intercepting requests.
   *
   * @returns {void}
   */
  close(): void;
  // #endregion
}

/**
 * Interface UnhandledFrame
 *
 * @description
 * What this module reads of an `msw` network frame no handler answered.
 */
interface UnhandledFrame {
  // #region Properties
  /**
   * Property protocol
   *
   * @description
   * `http` for a request, `ws` for a WebSocket connection.
   *
   * @type {string}
   * @readonly
   */
  readonly protocol: string;

  /**
   * Property data
   *
   * @description
   * Payload of the frame: the request of an HTTP frame.
   *
   * @type {unknown}
   * @readonly
   */
  readonly data: unknown;
  // #endregion

  // #region Methods
  /**
   * Method errorWith
   *
   * @description
   * Fails the frame.
   *
   * @param {unknown} reason - Why it fails.
   * @returns {void}
   */
  errorWith(reason?: unknown): void;
  // #endregion
}

/**
 * Function requestOf
 *
 * @description
 * Reads the request of an HTTP frame.
 *
 * @param {UnhandledFrame} frame - Frame no handler answered.
 * @returns {Request | undefined} The request, or `undefined` for another kind of frame.
 */
function requestOf(frame: UnhandledFrame): Request | undefined {
  const data: unknown = frame.data;
  if (frame.protocol === 'http' && typeof data === 'object' && data !== null && 'request' in data) {
    return data.request instanceof Request ? data.request : undefined;
  }
  return undefined;
}

/**
 * Function isLoopback
 *
 * @description
 * Tells whether a host name designates this machine.
 *
 * @param {string} hostname - Host name of a URL.
 * @returns {boolean} Whether it is a loopback name or address.
 */
function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname === '[::1]' ||
    hostname === '::1' ||
    /^127(\.\d{1,3}){3}$/u.test(hostname)
  );
}

/**
 * Function portOf
 *
 * @description
 * Reads the port of a dependency address.
 *
 * @param {string} address - URL such as `nats://localhost:4222`, or `host:port`.
 * @returns {number} The port.
 * @throws {Error} When the address names no port.
 */
function portOf(address: string): number {
  const port: number = Number(new URL(address.includes('://') ? address : `tcp://${address}`).port);
  if (!Number.isInteger(port) || port === 0) {
    throw new Error(`The address ${address} names no port.`);
  }
  return port;
}

/**
 * Function connectPortOf
 *
 * @description
 * Reads the port a `net.Socket.prototype.connect` call targets, whatever the form of its
 * arguments: `(options)`, `(port, host)` or the normalized array `net.connect` passes.
 *
 * @param {readonly unknown[]} args - Arguments of the call.
 * @returns {number | undefined} The port, or `undefined` for a pipe or a path.
 */
function connectPortOf(args: readonly unknown[]): number | undefined {
  const first: unknown = Array.isArray(args[0]) ? (args[0] as unknown[])[0] : args[0];
  const port: unknown =
    typeof first === 'object' && first !== null && 'port' in first ? first.port : first;
  const parsed: number = typeof port === 'string' ? Number(port) : NaN;
  return typeof port === 'number' ? port : Number.isInteger(parsed) ? parsed : undefined;
}

/**
 * Function startHttpFakes
 *
 * @description
 * Starts intercepting the outgoing HTTP requests of the process: `fetch` and the `node:http` and
 * `node:https` clients. A request a handler matches gets the faked response; a request to a
 * loopback address goes through; every other request fails with a network error and is listed
 * in `unhandled`. A test therefore never reaches a third party.
 *
 * @param {readonly AnyHandler[]} handlers - Initial handlers, built with `http` of this package.
 * @param {HttpFakesOptions} options - Further hosts to leave reachable.
 * @returns {HttpFakes} The running fakes; call `close` when the tests are done.
 */
export function startHttpFakes(
  handlers: readonly AnyHandler[] = [],
  options: HttpFakesOptions = {},
): HttpFakes {
  const allowed: ReadonlySet<string> = new Set<string>(options.allowHosts ?? []);
  const tcpPorts: ReadonlySet<number> = new Set<number>((options.tcpAddresses ?? []).map(portOf));
  const unhandled: string[] = [];
  const server: SetupServer = setupServer(...handlers);
  const realConnect: net.Socket['connect'] = net.Socket.prototype.connect;
  server.listen({
    onUnhandledFrame: ({
      frame,
      defaults,
    }: {
      frame: UnhandledFrame;
      defaults: { error: () => void };
    }): void => {
      const request: Request | undefined = requestOf(frame);
      if (request === undefined) {
        // A WebSocket connection: no handler, no connection.
        unhandled.push(`${frame.protocol.toUpperCase()} connection`);
        frame.errorWith(new Error('No fake answers this connection.'));
        return;
      }
      const hostname: string = new URL(request.url).hostname;
      if (isLoopback(hostname) || allowed.has(hostname)) {
        return;
      }
      unhandled.push(`${request.method} ${request.url}`);
      defaults.error();
      if ('respondWith' in frame && typeof frame.respondWith === 'function') {
        (frame.respondWith as (response: Response) => void)(Response.error());
      } else {
        frame.errorWith(new Error('No fake answers this request.'));
      }
    },
  });
  // msw replaced the connect method of every socket. The sockets of the dependencies that do
  // not speak HTTP keep the real one: they are disposable servers on mapped ports, never a
  // third party.
  const interceptedConnect: net.Socket['connect'] = net.Socket.prototype.connect;
  /**
   * Function routedConnect
   *
   * @description
   * Connects a socket for real when it targets a non-HTTP dependency, through `msw` otherwise.
   *
   * @param {unknown[]} args - Arguments of the connect call.
   * @returns {net.Socket} The socket.
   */
  const routedConnect = function (this: net.Socket, ...args: unknown[]): net.Socket {
    const port: number | undefined = connectPortOf(args);
    const connect: net.Socket['connect'] =
      port !== undefined && tcpPorts.has(port) ? realConnect : interceptedConnect;
    return Reflect.apply(connect, this, args) as net.Socket;
  } as net.Socket['connect'];
  if (tcpPorts.size > 0) {
    net.Socket.prototype.connect = routedConnect;
  }
  return {
    get unhandled(): readonly string[] {
      return [...unhandled];
    },
    use: (...added: AnyHandler[]): void => {
      server.use(...added);
    },
    reset: (): void => {
      server.resetHandlers();
      unhandled.length = 0;
    },
    close: (): void => {
      if (net.Socket.prototype.connect === routedConnect) {
        net.Socket.prototype.connect = interceptedConnect;
      }
      server.close();
    },
  };
}
