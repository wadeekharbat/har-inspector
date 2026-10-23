import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ImportController, type ImportableFile } from './import-controller';
import { RULE_THRESHOLDS } from './types';
import syntheticCheckoutFixture from '../fixtures/synthetic-checkout.har.json';

describe('ImportController ()', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Spy on global fetch to verify that import never executes network requests to recorded domains
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('Network request forbidden during local HAR import');
    });
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it('loads bundled demo through the same parser and never makes network requests', async () => {
    const controller = new ImportController();
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().currentSession).toBeNull();

    const success = await controller.loadDemo();
    expect(success).toBe(true);

    const state = controller.getState();
    expect(state.status).toBe('success');
    expect(state.activeSource).toContain('Demo: Broken Checkout');
    expect(state.currentSession).not.toBeNull();
    expect(state.currentSession?.requests).toHaveLength(10);
    expect(state.error).toBeNull();

    // Verify zero network requests were attempted
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('imports a valid local file successfully and never contacts recorded domains', async () => {
    const controller = new ImportController();
    const validHarContent = JSON.stringify(syntheticCheckoutFixture);

    const mockFile: ImportableFile = {
      name: 'my-recording.har',
      size: validHarContent.length,
      text: vi.fn().mockResolvedValue(validHarContent),
    };

    const success = await controller.importFile(mockFile);
    expect(success).toBe(true);

    const state = controller.getState();
    expect(state.status).toBe('success');
    expect(state.activeSource).toBe('my-recording.har');
    expect(state.currentSession?.requests).toHaveLength(10);
    expect(state.error).toBeNull();

    expect(mockFile.text).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('enforces 10 MiB limit before reading file into memory', async () => {
    const controller = new ImportController();
    const textReaderMock = vi.fn().mockResolvedValue('{"dummy":"content"}');

    const overLimitFile: ImportableFile = {
      name: 'giant-recording.har',
      size: RULE_THRESHOLDS.MAX_FILE_BYTES + 1, // 10,485,761 bytes
      text: textReaderMock,
    };

    const success = await controller.importFile(overLimitFile);
    expect(success).toBe(false);

    const state = controller.getState();
    expect(state.status).toBe('error');
    expect(state.error).toContain('exceeds the 10 MiB limit');
    expect(state.error).toContain('Reading refused');

    // CRITICAL: file.text() must NEVER be called if size exceeds 10 MiB
    expect(textReaderMock).not.toHaveBeenCalled();
  });

  it('preserves the last good session when a subsequent import fails', async () => {
    const controller = new ImportController();

    // 1. Load good demo first
    const demoOk = await controller.loadDemo();
    expect(demoOk).toBe(true);
    const goodSession = controller.getState().currentSession;
    expect(goodSession).not.toBeNull();
    expect(controller.getState().activeSource).toContain('Demo: Broken Checkout');

    // 2. Attempt to import an invalid file (malformed JSON)
    const invalidFile: ImportableFile = {
      name: 'corrupt.har',
      size: 15,
      text: vi.fn().mockResolvedValue('not json at all'),
    };

    const importOk = await controller.importFile(invalidFile);
    expect(importOk).toBe(false);

    // 3. Verify error is shown but last-good session is retained in state
    const state = controller.getState();
    expect(state.status).toBe('error');
    expect(state.error).toContain('Failed to import "corrupt.har"');
    expect(state.currentSession).toBe(goodSession); // Preserved reference!
    expect(state.activeSource).toContain('Demo: Broken Checkout'); // Preserved source!
  });

  it('preserves last good session and leaks NO raw secret fragments when malformed file contains synthetic secrets', async () => {
    const controller = new ImportController();
    await controller.loadDemo();
    const goodSession = controller.getState().currentSession;
    expect(goodSession).not.toBeNull();

    // Malformed JSON containing synthetic secret
    const secretContent = 'SECRET_QUERY_TOKEN_12345 is not valid JSON at all';
    const invalidFile: ImportableFile = {
      name: 'secret-payload.har',
      size: secretContent.length,
      text: vi.fn().mockResolvedValue(secretContent),
    };

    const importOk = await controller.importFile(invalidFile);
    expect(importOk).toBe(false);

    const state = controller.getState();
    expect(state.status).toBe('error');
    expect(state.currentSession).toBe(goodSession); // Last good session survives!
    expect(state.activeSource).toContain('Demo: Broken Checkout');

    // Assert that the error message contains NO secret fragments
    expect(state.error).not.toContain('SECRET');
    expect(state.error).not.toContain('QUERY_TOKEN');
    expect(state.error).not.toContain('12345');
    expect(state.error).toBe('Failed to import "secret-payload.har": Invalid JSON format: file content could not be parsed as valid JSON.');
  });

  it('preserves last good session and leaks NO secret file-read exception message if reading throws', async () => {
    const controller = new ImportController();
    await controller.loadDemo();
    const goodSession = controller.getState().currentSession;

    const throwingFile: ImportableFile = {
      name: 'disk-error.har',
      size: 50,
      text: vi.fn().mockRejectedValue(new Error('EACCES on /secret/path/CONFIDENTIAL_KEY_XYZ')),
    };

    const importOk = await controller.importFile(throwingFile);
    expect(importOk).toBe(false);

    const state = controller.getState();
    expect(state.status).toBe('error');
    expect(state.currentSession).toBe(goodSession);
    expect(state.error).not.toContain('CONFIDENTIAL');
    expect(state.error).not.toContain('/secret/path');
    expect(state.error).toBe('Failed to read file "disk-error.har": reading failed or was aborted.');
  });

  it('handles empty recording import with null timeline origin and 0 requests', async () => {
    const controller = new ImportController();
    const emptyHar = JSON.stringify({ log: { version: '1.2', entries: [] } });

    const emptyFile: ImportableFile = {
      name: 'empty.har',
      size: emptyHar.length,
      text: vi.fn().mockResolvedValue(emptyHar),
    };

    const ok = await controller.importFile(emptyFile);
    expect(ok).toBe(true);

    const state = controller.getState();
    expect(state.status).toBe('success');
    expect(state.activeSource).toBe('empty.har');
    expect(state.currentSession?.requests).toHaveLength(0);
    expect(state.currentSession?.timeline.originTimestampMs).toBeNull();
    expect(state.currentSession?.timeline.totalSpanMs).toBe(0);
  });

  it('handles concurrent and stale imports safely without state race conditions', async () => {
    const controller = new ImportController();

    let resolveSlow: (val: string) => void = () => {};
    const slowPromise = new Promise<string>((resolve) => {
      resolveSlow = resolve;
    });

    const slowFile: ImportableFile = {
      name: 'slow.har',
      size: 100,
      text: () => slowPromise,
    };

    const fastValidHar = JSON.stringify({
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/fast' },
            response: { status: 200, bodySize: 10 },
          },
        ],
      },
    });

    const fastFile: ImportableFile = {
      name: 'fast.har',
      size: fastValidHar.length,
      text: vi.fn().mockResolvedValue(fastValidHar),
    };

    // Start slow import (operation 1)
    const slowImportPromise = controller.importFile(slowFile);

    // While slow is in-flight, user initiates fast import (operation 2)
    const fastImportPromise = controller.importFile(fastFile);

    // Fast finishes first
    const fastResult = await fastImportPromise;
    expect(fastResult).toBe(true);
    expect(controller.getState().activeSource).toBe('fast.har');
    expect(controller.getState().currentSession?.requests[0].displayUrl).toBe('https://example.com/fast');

    // Now slow completes later with different data
    const slowValidHar = JSON.stringify({
      log: {
        version: '1.2',
        entries: [
          {
            startedDateTime: '2026-10-22T10:00:00Z',
            time: 50,
            request: { method: 'GET', url: 'https://example.com/slow' },
            response: { status: 200, bodySize: 10 },
          },
        ],
      },
    });
    resolveSlow(slowValidHar);

    const slowResult = await slowImportPromise;
    // Superseded operation must return false and NOT overwrite the newer state
    expect(slowResult).toBe(false);
    expect(controller.getState().activeSource).toBe('fast.har');
    expect(controller.getState().currentSession?.requests[0].displayUrl).toBe('https://example.com/fast');
  });

  it('discards in-flight import if reset is called while reading', async () => {
    const controller = new ImportController();

    let resolveRead: (val: string) => void = () => {};
    const readPromise = new Promise<string>((resolve) => {
      resolveRead = resolve;
    });

    const pendingFile: ImportableFile = {
      name: 'pending.har',
      size: 100,
      text: () => readPromise,
    };

    const importPromise = controller.importFile(pendingFile);
    expect(controller.getState().status).toBe('loading');

    // User resets while file is still reading
    controller.reset();
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().currentSession).toBeNull();

    // Now read finishes
    resolveRead(JSON.stringify(syntheticCheckoutFixture));
    const result = await importPromise;

    expect(result).toBe(false);
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().currentSession).toBeNull();
  });

  it('resets session state cleanly and notifies subscribers', () => {
    const controller = new ImportController();
    const notifications: string[] = [];

    controller.subscribe((s) => {
      notifications.push(s.status);
    });

    controller.reset();
    expect(controller.getState().status).toBe('idle');
    expect(controller.getState().currentSession).toBeNull();
    expect(controller.getState().error).toBeNull();
    expect(notifications).toContain('idle');
  });

  it('loads clean demo through real pipeline with zero errors and zero findings', async () => {
    const controller = new ImportController();
    const success = await controller.loadCleanDemo();
    expect(success).toBe(true);

    const state = controller.getState();
    expect(state.status).toBe('success');
    expect(state.activeSource).toBe('Demo: Clean E-Commerce Catalog (Synthetic)');
    expect(state.currentSession).not.toBeNull();
    expect(state.currentSession?.requests).toHaveLength(6);
    expect(state.currentSession?.warnings).toHaveLength(0);
    expect(state.error).toBeNull();

    // Verify zero network requests
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('sets sourceKind explicitly on bundled demo, clean demo, and reset', async () => {
    const controller = new ImportController();
    expect(controller.getState().sourceKind).toBe('none');

    await controller.loadDemo();
    expect(controller.getState().sourceKind).toBe('bundled-checkout-demo');

    await controller.loadCleanDemo();
    expect(controller.getState().sourceKind).toBe('bundled-clean-demo');

    controller.reset();
    expect(controller.getState().sourceKind).toBe('none');
  });

  it('classifies misleadingly named user files as imported-file, not bundled-checkout-demo', async () => {
    const controller = new ImportController();
    const mockFile: ImportableFile = {
      name: 'Broken Checkout.har', // Misleading filename mimicking the demo label
      size: JSON.stringify(syntheticCheckoutFixture).length,
      text: vi.fn().mockResolvedValue(JSON.stringify(syntheticCheckoutFixture)),
    };

    const success = await controller.importFile(mockFile);
    expect(success).toBe(true);

    const state = controller.getState();
    expect(state.activeSource).toBe('Broken Checkout.har');
    // Critical: sourceKind MUST be 'imported-file', NOT 'bundled-checkout-demo'
    expect(state.sourceKind).toBe('imported-file');
    expect(state.sourceKind === 'bundled-checkout-demo').toBe(false);
  });

  it('transitions sourceKind from bundled-checkout-demo to imported-file upon successful import', async () => {
    const controller = new ImportController();
    await controller.loadDemo();
    expect(controller.getState().sourceKind).toBe('bundled-checkout-demo');

    const cleanFixtureContent = JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 'test' },
        entries: [],
      },
    });

    const file: ImportableFile = {
      name: 'other-session.har',
      size: cleanFixtureContent.length,
      text: vi.fn().mockResolvedValue(cleanFixtureContent),
    };

    const success = await controller.importFile(file);
    expect(success).toBe(true);
    expect(controller.getState().sourceKind).toBe('imported-file');
  });

  it('preserves sourceKind: bundled-checkout-demo when subsequent file import fails', async () => {
    const controller = new ImportController();
    await controller.loadDemo();
    expect(controller.getState().sourceKind).toBe('bundled-checkout-demo');
    const previousSession = controller.getState().currentSession;

    const corruptFile: ImportableFile = {
      name: 'corrupt.har',
      size: 50,
      text: vi.fn().mockResolvedValue('invalid json content'),
    };

    const success = await controller.importFile(corruptFile);
    expect(success).toBe(false);

    const state = controller.getState();
    expect(state.status).toBe('error');
    // Source identity and session must be preserved
    expect(state.sourceKind).toBe('bundled-checkout-demo');
    expect(state.currentSession).toBe(previousSession);
    expect(state.activeSource).toContain('Broken Checkout');
  });
});

