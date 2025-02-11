/*
 * Copyright (c) Eric Traut
 * Handles the state associated with a remote language server session.
 */

import type {
    CompletionItem,
    CompletionList,
    Diagnostic,
    Position,
    Range,
    SignatureHelp,
    WorkspaceEdit,
} from 'vscode-languageserver-types';
import { endpointRequest } from './EndpointUtils';
import { PlaygroundSettings } from '@/components/PlaygroundSettings';

export interface DiagnosticEvents {
    onWaitingForDiagnostics: (isWaiting: boolean) => void;
    onDiagnostics: (diag: Diagnostic[]) => void;
    onError: (message: string) => void;
}

export interface HoverInfo {
    contents: {
        kind: string;
        value: string;
    };
    range: Range;
}

// Number of attempts to create a new session before giving up.
const maxErrorCount = 4;

// TODO: use environment variables
const appServerApiAddressPrefix = 'http://localhost:8080/lsp/';

export class LspSession {
    private readonly _settings: PlaygroundSettings | undefined;
    private readonly _eventHandlers?: DiagnosticEvents;

    private _sessionId: string | undefined;
    private _code;
    private _version: number;

    constructor(
        initialCode: string,
        settings: PlaygroundSettings,
        eventHandlers?: DiagnosticEvents
    ) {
        // When creating a new session, we can send the initial
        // code to the server to speed up initialization.
        this._code = initialCode;
        this._version = 0;
        this._settings = settings;
        this._eventHandlers = eventHandlers;
    }

    async shutdown() {
        const sessionId = this._sessionId;
        if (!sessionId) {
            return;
        }

        // Immediately discard the old session ID.
        this._sessionId = undefined;

        const endpoint = appServerApiAddressPrefix + `session/${sessionId}`;
        await endpointRequest('DELETE', endpoint);
    }

    async updateCode(code: string) {
        this._code = code;
        const version = this._version;

        this._eventHandlers?.onWaitingForDiagnostics(true);

        this.getDiagnostics(code)
            .then((diagnostics) => {
                // Ensure that the diagnostics are associated with the current version of the code.
                if (this._version === version) {
                    this._eventHandlers?.onDiagnostics(diagnostics);
                }
            })
            .catch((error) => {
                this._eventHandlers?.onError(error.message);
            })
            .finally(() => {
                if (this._version === version) {
                    this._eventHandlers?.onWaitingForDiagnostics(false);
                }
            });
    }

    async getDiagnostics(code: string): Promise<Diagnostic[]> {
        return this._doWithSession<Diagnostic[]>(async (sessionId) => {
            const endpoint = appServerApiAddressPrefix + `session/${sessionId}/diagnostics`;
            const data = await endpointRequest('POST', endpoint, { code });
            return data.diagnostics;
        });
    }

    async getHoverForPosition(code: string, position: Position): Promise<HoverInfo> {
        return this._doWithSession<HoverInfo>(async (sessionId) => {
            const endpoint = appServerApiAddressPrefix + `session/${sessionId}/hover`;
            const data = await endpointRequest('POST', endpoint, { code, position });
            return data.hover;
        });
    }

    async getRenameEditsForPosition(
        code: string,
        position: Position,
        newName: string
    ): Promise<WorkspaceEdit | undefined> {
        return this._doWithSession<WorkspaceEdit>(async (sessionId) => {
            const endpoint = appServerApiAddressPrefix + `session/${sessionId}/rename`;
            const data = await endpointRequest('POST', endpoint, { code, position, newName });
            return data.edits;
        });
    }

    async getSignatureHelpForPosition(code: string, position: Position): Promise<SignatureHelp> {
        return this._doWithSession<SignatureHelp>(async (sessionId) => {
            const endpoint = appServerApiAddressPrefix + `session/${sessionId}/signature`;
            const data = await endpointRequest('POST', endpoint, { code, position });
            return data.signatureHelp;
        });
    }

    async getCompletionForPosition(code: string, position: Position): Promise<CompletionList> {
        return this._doWithSession<CompletionList>(async (sessionId) => {
            const endpoint = appServerApiAddressPrefix + `session/${sessionId}/completion`;
            const data = await endpointRequest('POST', endpoint, { code, position });
            return data.completionList;
        });
    }

    async resolveCompletionItem(item: CompletionItem): Promise<CompletionItem> {
        return this._doWithSession<CompletionItem>(async (sessionId) => {
            const endpoint = appServerApiAddressPrefix + `session/${sessionId}/completionresolve`;
            const data = await endpointRequest('POST', endpoint, { completionItem: item });
            return data.completionItem;
        });
    }

    // Establishes a session if necessary and calls the callback to perform some
    // work. If the session cannot be established or the call fails, an attempt
    // is made to retry the operation with exponential backoff.
    private async _doWithSession<T>(callback: (sessionId: string) => Promise<T>): Promise<T> {
        let errorCount = 0;
        let backoffDelay = 100;

        while (true) {
            if (errorCount > maxErrorCount) {
                throw new Error('Could not connect to service');
            }

            try {
                const sessionId = await this._createSession();
                const result = await callback(sessionId);

                return result;
            } catch {
                // Throw away the current session.
                this._sessionId = undefined;
                errorCount++;
            }

            await this._sleep(backoffDelay);

            // Exponentially back off.
            backoffDelay *= 2;
        }
    }

    private _sleep(sleepTimeInMs: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, sleepTimeInMs));
    }

    private async _createSession(): Promise<string> {
        // If there's already a valid session ID, use it.
        if (this._sessionId) {
            return Promise.resolve(this._sessionId);
        }

        let pythonVersion: string | undefined;
        let pythonPlatform: string | undefined;
        let typeCheckingMode: 'strict' | undefined;
        let code: string | undefined;
        let configOverrides: { [name: string]: boolean } | undefined;
        let locale: string | undefined;

        if (this._settings) {
            if (this._settings.pythonVersion) {
                pythonVersion = this._settings.pythonVersion;
            }

            if (this._settings.pythonPlatform) {
                pythonPlatform = this._settings.pythonPlatform;
            }

            if (this._settings.strictMode) {
                typeCheckingMode = 'strict';
            }

            code = this._code;
            configOverrides = { ...this._settings.configOverrides };
            locale = this._settings.locale ?? navigator.language;
        }

        const endpoint = appServerApiAddressPrefix + `session`;
        const data = await endpointRequest('POST', endpoint, {
            pythonVersion,
            pythonPlatform,
            typeCheckingMode,
            code,
            configOverrides,
            locale,
        });
        this._sessionId = data.sessionId;
        return data.sessionId;
    }
}
