/*
 * Copyright (C) 2018 TypeFox and others.
 *
 * Licensed under the Apache License, Version 2.0 (the "License"); you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at http://www.apache.org/licenses/LICENSE-2.0
 */

import { injectable, inject } from "inversify";
import { TextDocumentContentChangeEvent } from "vscode-languageserver-types";
import { Resource, ResourceResolver, Emitter, Event, DisposableCollection } from "@theia/core";
import URI from "@theia/core/lib/common/uri";
import { FileSystem, FileStat } from "../common/filesystem";
import { FileSystemWatcher } from "./filesystem-watcher";

export class FileResource implements Resource {

    protected readonly toDispose = new DisposableCollection();
    protected readonly onDidChangeContentsEmitter = new Emitter<void>();
    readonly onDidChangeContents: Event<void> = this.onDidChangeContentsEmitter.event;

    protected stat: FileStat | undefined;
    protected uriString: string;

    constructor(
        readonly uri: URI,
        protected readonly fileSystem: FileSystem,
        protected readonly fileSystemWatcher: FileSystemWatcher
    ) {
        this.uriString = this.uri.toString();
        this.toDispose.push(this.onDidChangeContentsEmitter);
    }

    async init(): Promise<void> {
        const stat = await this.getFileStat();
        if (stat && stat.isDirectory) {
            throw new Error('The given uri is a directory: ' + this.uriString);
        }
        this.stat = stat;
        this.toDispose.push(await this.fileSystemWatcher.watchFileChanges(this.uri));
        this.toDispose.push(this.fileSystemWatcher.onFilesChanged(changes => {
            if (changes.some(e => e.uri.toString() === this.uriString)) {
                this.sync();
            }
        }));
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    async readContents(options?: { encoding?: string }): Promise<string> {
        const { stat, content } = await this.fileSystem.resolveContent(this.uriString, options);
        this.stat = stat;
        return content;
    }

    async saveContents(content: string, options?: { encoding?: string }): Promise<void> {
        this.stat = await this.doSaveContents(content, options);
    }
    protected async doSaveContents(content: string, options?: { encoding?: string }): Promise<FileStat> {
        const stat = await this.getFileStat();
        if (stat) {
            return this.fileSystem.setContent(stat, content, options);
        }
        return this.fileSystem.createFile(this.uriString, { content, ...options });
    }

    async saveContentChanges(changes: TextDocumentContentChangeEvent[], options?: { encoding?: string }): Promise<void> {
        if (!this.stat) {
            throw new Error(this.uriString + ' has not been read yet');
        }
        this.stat = await this.fileSystem.updateContent(this.stat, changes, options);
    }

    protected async sync(): Promise<void> {
        if (await this.isInSync(this.stat)) {
            return;
        }
        this.onDidChangeContentsEmitter.fire(undefined);
    }
    protected async isInSync(current: FileStat | undefined): Promise<boolean> {
        const stat = await this.getFileStat();
        if (!current) {
            return !stat;
        }
        return !!stat && current.lastModification >= stat.lastModification;
    }

    protected async getFileStat(): Promise<FileStat | undefined> {
        if (!this.fileSystem.exists(this.uriString)) {
            return undefined;
        }
        try {
            return this.fileSystem.getFileStat(this.uriString);
        } catch {
            return undefined;
        }
    }

}

@injectable()
export class FileResourceResolver implements ResourceResolver {

    @inject(FileSystem)
    protected readonly fileSystem: FileSystem;

    @inject(FileSystemWatcher)
    protected readonly fileSystemWatcher: FileSystemWatcher;

    async resolve(uri: URI): Promise<FileResource> {
        if (uri.scheme !== 'file') {
            throw new Error('The given uri is not file uri: ' + uri);
        }
        const resource = new FileResource(uri, this.fileSystem, this.fileSystemWatcher);
        await resource.init();
        return resource;
    }

}
