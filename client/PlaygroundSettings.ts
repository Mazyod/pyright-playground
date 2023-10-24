/*
 * Copyright (c) Eric Traut
 * Interface that defines the settings for the pyright playground.
 */

export interface PlaygroundSettings {
    strictMode?: boolean;
    configOverrides: { [name: string]: boolean };
    pyrightVersion?: string;
    pythonVersion?: string;
    pythonPlatform?: string;
    language?: string;
}
