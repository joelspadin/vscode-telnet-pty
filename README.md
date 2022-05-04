# Telnet Psuedoterminal for Visual Studio Code

This library implements [`vscode.Pseudoterminal`](https://code.visualstudio.com/api/references/vscode-api#Pseudoterminal)
for a telnet client.

## Usage

```ts
import * as vscode from 'vscode';
import { TelnetPseudoterminal } from 'vscode-telnet-pty';

vscode.window.createTerminal({
    name: 'telnet',
    pty: new TelnetPseudoterminal('localhost'),
});
```

You can configure the hostname, port, and encoding used. If not specified, the
port defaults to 23 and the encoding defaults to utf-8.

```ts
new TelnetPseudoterminal('localhost');
new TelnetPseudoterminal('localhost', 2323);
new TelnetPseudoterminal({ host: 'localhost', encoding: 'latin1' });
```

## Compatibility

So far this has only been tested with a telnet server running on Ubuntu 21.10.

Patches to improve compatibility with other servers are welcome, however if you
have a custom application with special compatibility requirements, you can
extend `TelnetPseudoterminal` and override its protected functions to change the
behavior as needed.

## Credits

All the heavy lifting is done by [blinkdog/telnet-stream](https://github.com/blinkdog/telnet-stream).
