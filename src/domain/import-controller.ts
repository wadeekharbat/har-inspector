import { type NormalizedSession, RULE_THRESHOLDS } from './types';
import { parseHarContent, parseHarData } from './parser';
import bundledDemoFixture from '../fixtures/synthetic-checkout.har.json';
import cleanSessionFixture from '../fixtures/clean-session.har.json';

export type ImportStatus = 'idle' | 'loading' | 'success' | 'error';
export type SessionSourceKind = 'none' | 'bundled-checkout-demo' | 'bundled-clean-demo' | 'imported-file';

export interface ImportState {
  status: ImportStatus;
  currentSession: NormalizedSession | null;
  activeSource: string | null;
  sourceKind: SessionSourceKind;
  error: string | null;
}

export type ImportStateListener = (state: ImportState) => void;

export interface ImportableFile {
  name: string;
  size: number;
  text: () => Promise<string>;
}

export class ImportController {
  private state: ImportState = {
    status: 'idle',
    currentSession: null,
    activeSource: null,
    sourceKind: 'none',
    error: null,
  };

  private listeners = new Set<ImportStateListener>();
  private currentOperationId = 0;

  constructor(initialSession?: NormalizedSession) {
    if (initialSession) {
      this.state = {
        status: 'success',
        currentSession: initialSession,
        activeSource: 'Initial Session',
        sourceKind: 'none',
        error: null,
      };
    }
  }

  public getState(): ImportState {
    return this.state;
  }

  public subscribe(listener: ImportStateListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.state);
    }
  }

  /**
   * Discards the current session state and returns to idle.
   */
  public reset(): void {
    // Invalidate any in-flight asynchronous imports
    this.currentOperationId++;
    this.state = {
      status: 'idle',
      currentSession: null,
      activeSource: null,
      sourceKind: 'none',
      error: null,
    };
    this.notify();
  }

  /**
   * Loads the bundled demonstration fixture through the exact same parser/normalizer pipeline.
   */
  public async loadDemo(
    customFixture?: unknown,
    customSourceName?: string,
    customSourceKind?: SessionSourceKind
  ): Promise<boolean> {
    const operationId = ++this.currentOperationId;

    this.state = {
      ...this.state,
      status: 'loading',
      error: null,
    };
    this.notify();

    // Use microtask to ensure asynchronous event loop behavior
    await Promise.resolve();

    if (operationId !== this.currentOperationId) {
      return false; // Stale operation superseded
    }

    const fixtureToParse = customFixture ?? bundledDemoFixture;
    const result = parseHarData(fixtureToParse);

    if (operationId !== this.currentOperationId) {
      return false; // Stale operation superseded
    }

    if (!result.success) {
      this.state = {
        ...this.state,
        status: 'error',
        error: result.error,
      };
      this.notify();
      return false;
    }

    const determinedKind: SessionSourceKind =
      customSourceKind ?? (customFixture ? 'none' : 'bundled-checkout-demo');

    this.state = {
      status: 'success',
      currentSession: result.session,
      activeSource: customSourceName ?? (customFixture ? 'Synthetic Test Suite' : 'Demo: Broken Checkout (Synthetic)'),
      sourceKind: determinedKind,
      error: null,
    };
    this.notify();
    return true;
  }

  /**
   * Loads the bundled clean demonstration fixture (0 findings) through the exact same parser pipeline.
   */
  public async loadCleanDemo(): Promise<boolean> {
    return this.loadDemo(
      cleanSessionFixture,
      'Demo: Clean E-Commerce Catalog (Synthetic)',
      'bundled-clean-demo'
    );
  }

  /**
   * Imports a local HAR / JSON file.
   * Enforces 10 MiB limit before reading into memory.
   * Preserves last good session on failure.
   * Handles stale/concurrent operations safely via monotonic operationId.
   */
  public async importFile(file: ImportableFile): Promise<boolean> {
    const operationId = ++this.currentOperationId;

    this.state = {
      ...this.state,
      status: 'loading',
      error: null,
    };
    this.notify();

    // 1. Enforce file size limit before reading into memory
    if (file.size > RULE_THRESHOLDS.MAX_FILE_BYTES) {
      if (operationId !== this.currentOperationId) {
        return false;
      }
      this.state = {
        ...this.state,
        status: 'error',
        error: `File "${file.name}" (${file.size.toLocaleString()} bytes) exceeds the 10 MiB limit (${RULE_THRESHOLDS.MAX_FILE_BYTES.toLocaleString()} bytes). Reading refused.`,
      };
      this.notify();
      return false;
    }

    // 2. Read file content asynchronously
    let rawContent: string;
    try {
      rawContent = await file.text();
    } catch {
      if (operationId !== this.currentOperationId) {
        return false;
      }
      this.state = {
        ...this.state,
        status: 'error',
        error: `Failed to read file "${file.name}": reading failed or was aborted.`,
      };
      this.notify();
      return false;
    }

    if (operationId !== this.currentOperationId) {
      return false; // Superseded during file read
    }

    // 3. Parse and normalize content
    const result = parseHarContent(rawContent, file.size);

    if (operationId !== this.currentOperationId) {
      return false; // Superseded during parsing
    }

    if (!result.success) {
      // Failed import preserves last good session (this.state.currentSession is unchanged)
      this.state = {
        ...this.state,
        status: 'error',
        error: `Failed to import "${file.name}": ${result.error}`,
      };
      this.notify();
      return false;
    }

    this.state = {
      status: 'success',
      currentSession: result.session,
      activeSource: file.name,
      sourceKind: 'imported-file',
      error: null,
    };
    this.notify();
    return true;
  }
}
