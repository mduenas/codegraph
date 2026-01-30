/**
 * MCP HTTP Transport
 *
 * Handles JSON-RPC 2.0 communication over HTTP for MCP protocol.
 * Used for GitHub Copilot and other HTTP-based MCP clients.
 */

import * as http from 'http';
import {
  ITransport,
  MessageHandler,
  JsonRpcRequest,
  JsonRpcResponse,
  JsonRpcNotification,
  ErrorCodes,
} from './transport';

/**
 * HTTP Transport Configuration
 */
export interface HttpTransportConfig {
  /** Port to listen on (default: 3000) */
  port?: number;
  /** Host to bind to (default: 'localhost') */
  host?: string;
  /** Allowed CORS origins (default: '*') */
  corsOrigins?: string | string[];
  /** Endpoint path (default: '/mcp') */
  endpoint?: string;
}

/**
 * Pending response tracking for async message handling
 */
interface PendingResponse {
  res: http.ServerResponse;
  timestamp: number;
}

/**
 * HTTP Transport for MCP
 *
 * Provides HTTP/JSON-RPC transport for MCP protocol.
 * Supports CORS for browser-based clients.
 */
export class HttpTransport implements ITransport {
  private server: http.Server | null = null;
  private messageHandler: MessageHandler | null = null;
  private pendingResponses: Map<string | number, PendingResponse> = new Map();
  private config: Required<HttpTransportConfig>;

  constructor(config: HttpTransportConfig = {}) {
    this.config = {
      port: config.port ?? 3000,
      host: config.host ?? 'localhost',
      corsOrigins: config.corsOrigins ?? '*',
      endpoint: config.endpoint ?? '/mcp',
    };
  }

  /**
   * Start the HTTP server
   */
  start(handler: MessageHandler): void {
    this.messageHandler = handler;

    this.server = http.createServer(async (req, res) => {
      await this.handleRequest(req, res);
    });

    this.server.listen(this.config.port, this.config.host, () => {
      // Server started - log to stderr to not interfere with potential stdio
      console.error(`[codegraph] MCP HTTP server listening on http://${this.config.host}:${this.config.port}${this.config.endpoint}`);
    });

    this.server.on('error', (err) => {
      console.error(`[codegraph] HTTP server error: ${err.message}`);
    });
  }

  /**
   * Stop the HTTP server
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
    this.pendingResponses.clear();
  }

  /**
   * Send a JSON-RPC response
   * For HTTP transport, this sends the response to the pending HTTP request
   */
  send(response: JsonRpcResponse): void {
    if (response.id === null) {
      // Notifications don't have responses in HTTP context
      return;
    }

    const pending = this.pendingResponses.get(response.id);
    if (pending) {
      this.sendHttpResponse(pending.res, 200, response);
      this.pendingResponses.delete(response.id);
    }
  }

  /**
   * Send a notification
   * Note: In HTTP transport, notifications are typically not used
   * as the client initiates all requests
   */
  notify(method: string, _params?: unknown): void {
    // HTTP transport doesn't support server-initiated notifications
    // This would require SSE or WebSocket for bidirectional communication
    console.error(`[codegraph] HTTP transport cannot send notifications: ${method}`);
  }

  /**
   * Send a success result
   */
  sendResult(id: string | number, result: unknown): void {
    this.send({
      jsonrpc: '2.0',
      id,
      result,
    });
  }

  /**
   * Send an error response
   */
  sendError(id: string | number | null, code: number, message: string, data?: unknown): void {
    if (id === null) {
      // Can't send error response without an id
      console.error(`[codegraph] Cannot send error without request id: ${message}`);
      return;
    }

    this.send({
      jsonrpc: '2.0',
      id,
      error: { code, message, data },
    });
  }

  /**
   * Handle incoming HTTP request
   */
  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    // Set CORS headers
    this.setCorsHeaders(res);

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Only accept POST to the MCP endpoint
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    if (req.method !== 'POST' || url.pathname !== this.config.endpoint) {
      this.sendHttpResponse(res, 404, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: ErrorCodes.InvalidRequest,
          message: `Not found. Use POST ${this.config.endpoint}`,
        },
      });
      return;
    }

    // Check content type
    const contentType = req.headers['content-type'];
    if (!contentType || !contentType.includes('application/json')) {
      this.sendHttpResponse(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: ErrorCodes.ParseError,
          message: 'Content-Type must be application/json',
        },
      });
      return;
    }

    // Read request body
    let body = '';
    try {
      body = await this.readBody(req);
    } catch (err) {
      this.sendHttpResponse(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: ErrorCodes.ParseError,
          message: 'Failed to read request body',
        },
      });
      return;
    }

    // Parse JSON
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      this.sendHttpResponse(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: ErrorCodes.ParseError,
          message: 'Parse error: invalid JSON',
        },
      });
      return;
    }

    // Validate JSON-RPC structure
    if (!this.isValidMessage(parsed)) {
      this.sendHttpResponse(res, 400, {
        jsonrpc: '2.0',
        id: null,
        error: {
          code: ErrorCodes.InvalidRequest,
          message: 'Invalid Request: not a valid JSON-RPC 2.0 message',
        },
      });
      return;
    }

    const message = parsed as JsonRpcRequest | JsonRpcNotification;

    // Check if it's a request (has id) or notification
    if ('id' in message) {
      // Store pending response for later
      this.pendingResponses.set(message.id, {
        res,
        timestamp: Date.now(),
      });
    }

    // Handle the message
    if (this.messageHandler) {
      try {
        await this.messageHandler(message);

        // If it was a notification (no id), send empty 204 response
        if (!('id' in message)) {
          res.writeHead(204);
          res.end();
        }
        // For requests, the response is sent via send/sendResult/sendError
      } catch (err) {
        if ('id' in message) {
          this.sendError(
            message.id,
            ErrorCodes.InternalError,
            `Internal error: ${err instanceof Error ? err.message : String(err)}`
          );
        } else {
          res.writeHead(500);
          res.end();
        }
      }
    } else {
      this.sendHttpResponse(res, 500, {
        jsonrpc: '2.0',
        id: 'id' in message ? message.id : null,
        error: {
          code: ErrorCodes.InternalError,
          message: 'No message handler configured',
        },
      });
    }
  }

  /**
   * Read request body as string
   */
  private readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      req.on('error', reject);
    });
  }

  /**
   * Set CORS headers on response
   */
  private setCorsHeaders(res: http.ServerResponse): void {
    const origins = this.config.corsOrigins;
    const originHeader = Array.isArray(origins) ? origins.join(', ') : origins;

    res.setHeader('Access-Control-Allow-Origin', originHeader);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Access-Control-Max-Age', '86400');
  }

  /**
   * Send HTTP response with JSON body
   */
  private sendHttpResponse(res: http.ServerResponse, statusCode: number, body: JsonRpcResponse): void {
    const json = JSON.stringify(body);
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(json),
    });
    res.end(json);
  }

  /**
   * Check if message is a valid JSON-RPC 2.0 message
   */
  private isValidMessage(msg: unknown): boolean {
    if (typeof msg !== 'object' || msg === null) return false;
    const obj = msg as Record<string, unknown>;
    if (obj.jsonrpc !== '2.0') return false;
    if (typeof obj.method !== 'string') return false;
    return true;
  }

  /**
   * Get the server address info
   */
  getAddress(): { host: string; port: number; endpoint: string } | null {
    if (!this.server) return null;
    return {
      host: this.config.host,
      port: this.config.port,
      endpoint: this.config.endpoint,
    };
  }
}
