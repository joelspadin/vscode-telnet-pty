import * as net from 'net';
import * as vscode from 'vscode';
import { TelnetSocket } from 'telnet-stream';

const ECHO = 1; // RFC 857
const SUPPRESS_GO_AHEAD = 3; // RFC 858
const TERMINAL_TYPE = 24; // RFC 1091
const NAWS = 31; // Negotiate about window size (RFC 1073)
const NEW_ENVIRON = 39; // RFC 1572

const IS = 0;
const SEND = 1;

export interface TelnetPseudoterminalOptions {
    host: string;
    port?: number;
    encoding?: BufferEncoding;
}

export class TelnetPseudoterminal implements vscode.Pseudoterminal {
    private closeEmitter = new vscode.EventEmitter<void>();
    private writeEmitter = new vscode.EventEmitter<string>();

    onDidClose = this.closeEmitter.event;
    onDidWrite = this.writeEmitter.event;

    protected readonly host: string;
    protected readonly port: number;
    protected readonly encoding: BufferEncoding;

    private _dimensions?: vscode.TerminalDimensions;
    protected get dimensions(): vscode.TerminalDimensions | undefined {
        return this._dimensions;
    }
    protected set dimensions(value: vscode.TerminalDimensions | undefined) {
        this._dimensions = value;
        this.sendWindowSize();
    }

    private _socket?: TelnetSocket;
    protected get socket(): TelnetSocket {
        if (!this._socket) {
            throw new Error('Terminal not ready');
        }
        return this._socket;
    }

    private _serverNawsOk = false;
    protected get serverNawsOk(): boolean {
        return this._serverNawsOk;
    }
    private set serverNawsOk(value: boolean) {
        if (value === this.serverNawsOk) {
            return;
        }

        this._serverNawsOk = value;
        if (value) {
            this.socket.writeWill(NAWS);
            this.sendWindowSize();
        } else {
            this.socket.writeWont(NAWS);
        }
    }

    constructor(options: TelnetPseudoterminalOptions);
    constructor(host: string, port?: number, encoding?: string);
    constructor(optionsOrHost: TelnetPseudoterminalOptions | string, port = 23, encoding: BufferEncoding = 'utf8') {
        if (typeof optionsOrHost === 'string') {
            this.host = optionsOrHost;
            this.port = port;
            this.encoding = encoding;
        } else {
            this.host = optionsOrHost.host;
            this.port = optionsOrHost.port ?? port;
            this.encoding = optionsOrHost.encoding ?? encoding;
        }
    }

    open(initialDimensions: vscode.TerminalDimensions | undefined): void {
        this._dimensions = initialDimensions;
        this._socket = new TelnetSocket(net.createConnection(this.port, this.host));

        this.socket.on('close', () => {
            this.closeEmitter.fire();
        });

        this.socket.on('data', (buffer) => {
            this.handleData(buffer);
        });

        this.socket.on('do', (option) => {
            this.handleDo(option);
        });

        this.socket.on('dont', (option) => {
            this.handleDont(option);
        });

        this.socket.on('will', (option) => {
            this.handleWill(option);
        });

        this.socket.on('wont', (option) => {
            this.handleWont(option);
        });

        this.socket.on('sub', (option, buffer: Buffer) => {
            this.handleSubnegotiation(option, buffer);
        });

        this.socket.writeDo(ECHO);
        this.socket.writeDo(SUPPRESS_GO_AHEAD);
        this.socket.writeWill(SUPPRESS_GO_AHEAD);
        this.socket.writeWill(NAWS);
    }

    close(): void {
        this.socket.end();
    }

    handleInput(data: string): void {
        this.socket?.write(this.translateInput(data));

        // TODO: write out input in darkened text and erase it when the server sends data.
    }

    setDimensions(dimensions: vscode.TerminalDimensions): void {
        this.dimensions = dimensions;
    }

    /**
     * Override this to modify the data given to handleInput() before it is sent
     * to the server.
     *
     * The base implementation replaces "\r" with "\r\n"
     */
    protected translateInput(data: string): string {
        // Return should always be sent as \r\n.
        if (data === '\r') {
            return '\r\n';
        }
        return data;
    }

    /**
     * Override this to handle non-command data sent from the server.
     *
     * The base implementation writes the data to the terminal.
     */
    protected handleData(data: string | Buffer): void {
        this.writeEmitter.fire(data.toString(this.encoding));
    }

    /**
     * Override this to handle `IAC DO` commands.
     *
     * The base implementation confirms `NAWS`, `TERMINAL-TYPE`, and `NEW-ENVIRON`
     * with `WILL` and responds `WONT` to all other options. If the server sends
     * `DO NAWS`, the terminal will send window size updates.
     */
    protected handleDo(option: number): void {
        switch (option) {
            case NAWS:
                this.serverNawsOk = true;
                break;

            case TERMINAL_TYPE:
            case NEW_ENVIRON:
                this.socket.writeWill(option);
                break;

            default:
                this.socket.writeWont(option);
                break;
        }
    }

    /**
     * Override this to handle IAC DONT commands.
     *
     * The base implementation confirms all options with WONT. If the server
     * sends DONT NAWS, the terminal will stop sending window size updates.
     */
    protected handleDont(option: number): void {
        switch (option) {
            case NAWS:
                this.serverNawsOk = false;
                break;

            default:
                this.socket.writeWont(option);
                break;
        }
    }

    /**
     * Override this to handle `IAC WONT` commands.
     *
     * The base implementation confirms `ECHO` and `SUPPRESS-GO-AHEAD` with `DO`
     * and responds `DONT` to all other options.
     */
    protected handleWill(option: number): void {
        switch (option) {
            case ECHO:
            case SUPPRESS_GO_AHEAD:
                this.socket.writeDo(option);
                break;

            default:
                this.socket.writeDont(option);
                break;
        }
    }

    /**
     * Override this to handle `IAC WONT` commands.
     *
     * The base implementation responds `DO` to `ECHO` to request that the server
     * echo, and confirms `DONT` to all other options.
     */
    protected handleWont(option: number): void {
        switch (option) {
            case ECHO:
                this.socket.writeDo(option);
                break;

            default:
                this.socket.writeDont(option);
                break;
        }
    }

    /**
     * Override this to handle` IAC SUB` commands.
     *
     * The base implementation responds as follows
     * - `TERMINAL-TYPE` -> `IS XTERM`
     * - `NEW-ENVIRON` -> `IS`
     */
    protected handleSubnegotiation(option: number, buffer: Buffer): void {
        switch (option) {
            case TERMINAL_TYPE:
                if (buffer[0] === SEND) {
                    this.sendTerminalType();
                }
                break;

            case NEW_ENVIRON:
                if (buffer[0] === SEND) {
                    this.sendEnvironment();
                }
                break;
        }
    }

    private writeSub(option: number, ...data: (number | string | Buffer)[]) {
        const buffer = Buffer.concat(
            data.map((d) => {
                if (typeof d === 'number') {
                    return Buffer.from([d]);
                }
                if (typeof d === 'string') {
                    return Buffer.from(d);
                }
                return d;
            }),
        );

        this.socket.writeSub(option, buffer);
    }

    private sendEnvironment() {
        this.writeSub(NEW_ENVIRON, IS);
    }

    private sendTerminalType() {
        this.writeSub(TERMINAL_TYPE, IS, 'XTERM');
    }

    private sendWindowSize() {
        if (!this.serverNawsOk || !this.dimensions) {
            return;
        }

        const buffer = Buffer.alloc(4);
        buffer.writeInt16BE(this.dimensions.columns, 0);
        buffer.writeInt16BE(this.dimensions.rows, 2);
        this.socket.writeSub(NAWS, buffer);
    }
}
