import { ConfigService } from '@nestjs/config';
import { ImageEmbeddingService } from './image-embedding.service';

/**
 * Spec for the Replicate-backed `ImageEmbeddingService`.
 *
 * We mock `global.fetch` because hitting the real Replicate API
 * costs money and is slow (~2-3s per call). The integration smoke
 * lives in `apps/api/src/scripts/verify-embedding-compat.ts` and is
 * a manual gate before deploy, not a unit test.
 *
 * What this catches:
 *  - Token/flag gating: disabled state returns null without an HTTP call.
 *  - Happy path: 512-dim succeeded response → Float32Array of length 512.
 *  - Polling fallback: non-terminal first response triggers GET poll.
 *  - Error paths return null (preserves the previous local-CLIP contract
 *    that "any failure returns null, never throws in request path").
 *  - Dimension guard rejects unexpected output shapes.
 */

const makeService = (env: Record<string, string | undefined>) => {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  const svc = new ImageEmbeddingService(config);
  svc.onModuleInit();
  return svc;
};

const okResponse = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response);

const errResponse = (status: number, text: string) =>
  Promise.resolve({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => text,
  } as Response);

describe('ImageEmbeddingService — Replicate integration', () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.useRealTimers();
  });

  describe('disabled state', () => {
    it('returns null when CLIP_ENABLED is unset', async () => {
      const svc = makeService({});
      expect(svc.isEnabled()).toBe(false);
      const fetchSpy = jest.fn();
      global.fetch = fetchSpy as unknown as typeof global.fetch;
      const result = await svc.embedFromUrl('https://example.com/img.jpg');
      expect(result).toBeNull();
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns null when CLIP_ENABLED=false', async () => {
      const svc = makeService({ CLIP_ENABLED: 'false' });
      expect(svc.isEnabled()).toBe(false);
      const result = await svc.embedFromUrl('https://example.com/img.jpg');
      expect(result).toBeNull();
    });

    it('disables itself when CLIP_ENABLED=true but token missing', async () => {
      const svc = makeService({ CLIP_ENABLED: 'true' });
      expect(svc.isEnabled()).toBe(false);
    });
  });

  describe('successful embedding', () => {
    it('returns Float32Array of length 768 on synchronous response', async () => {
      const svc = makeService({
        CLIP_ENABLED: 'true',
        REPLICATE_API_TOKEN: 'r8_test_token',
      });
      expect(svc.isEnabled()).toBe(true);

      const seenCalls: Array<{ url: string; init: RequestInit }> = [];
      global.fetch = ((url: string, init: RequestInit) => {
        seenCalls.push({ url, init });
        return okResponse({
          id: 'pred_1',
          status: 'succeeded',
          output: { embedding: new Array(768).fill(0.1) },
        });
      }) as unknown as typeof global.fetch;

      const result = await svc.embedFromUrl(
        'https://cdn.directmate.app/img.jpg',
      );
      expect(result).toBeInstanceOf(Float32Array);
      expect(result?.length).toBe(768);
      expect(seenCalls.length).toBe(1);

      const headers = seenCalls[0].init.headers as Record<string, string>;
      expect(headers.Authorization).toBe('Token r8_test_token');
      expect(headers.Prefer).toBe('wait');
      const body = JSON.parse(seenCalls[0].init.body as string);
      expect(body.input.image).toBe('https://cdn.directmate.app/img.jpg');
      expect(typeof body.version).toBe('string');
      expect(body.version.length).toBeGreaterThan(20);
    });

    it('polls when initial response is non-terminal', async () => {
      jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });

      const svc = makeService({
        CLIP_ENABLED: 'true',
        REPLICATE_API_TOKEN: 'r8_test_token',
      });

      const seenCalls: Array<{ url: string; init: RequestInit | undefined }> =
        [];
      let callCount = 0;
      global.fetch = ((url: string, init?: RequestInit) => {
        seenCalls.push({ url, init });
        callCount++;
        if (callCount === 1) {
          return okResponse({ id: 'pred_2', status: 'starting' });
        }
        if (callCount === 2) {
          return okResponse({ id: 'pred_2', status: 'processing' });
        }
        return okResponse({
          id: 'pred_2',
          status: 'succeeded',
          output: { embedding: new Array(768).fill(0.2) },
        });
      }) as unknown as typeof global.fetch;

      const resultPromise = svc.embedFromUrl('https://example.com/img.jpg');
      // Each poll sleeps 1s before the next fetch. Advance enough to drain
      // both polls.
      await jest.advanceTimersByTimeAsync(2500);
      const result = await resultPromise;

      expect(result).toBeInstanceOf(Float32Array);
      expect(result?.length).toBe(768);
      expect(callCount).toBe(3);

      // Polls are GETs to /predictions/{id}, not the create endpoint.
      expect(seenCalls[1].init?.method ?? 'GET').toBe('GET');
      expect(seenCalls[1].url).toContain('/predictions/pred_2');
    });
  });

  describe('error handling', () => {
    it('returns null on HTTP error response', async () => {
      const svc = makeService({
        CLIP_ENABLED: 'true',
        REPLICATE_API_TOKEN: 'r8_test_token',
      });
      global.fetch = jest.fn(() =>
        errResponse(500, 'internal server error'),
      ) as unknown as typeof global.fetch;

      const result = await svc.embedFromUrl('https://example.com/img.jpg');
      expect(result).toBeNull();
    });

    it('returns null when prediction status is failed', async () => {
      const svc = makeService({
        CLIP_ENABLED: 'true',
        REPLICATE_API_TOKEN: 'r8_test_token',
      });
      global.fetch = jest.fn(() =>
        okResponse({
          id: 'pred_3',
          status: 'failed',
          error: 'image fetch failed',
        }),
      ) as unknown as typeof global.fetch;

      const result = await svc.embedFromUrl('https://example.com/img.jpg');
      expect(result).toBeNull();
    });

    it('returns null when embedding is missing from output', async () => {
      const svc = makeService({
        CLIP_ENABLED: 'true',
        REPLICATE_API_TOKEN: 'r8_test_token',
      });
      global.fetch = jest.fn(() =>
        okResponse({ id: 'pred_4', status: 'succeeded', output: {} }),
      ) as unknown as typeof global.fetch;

      const result = await svc.embedFromUrl('https://example.com/img.jpg');
      expect(result).toBeNull();
    });

    it('returns null on unexpected dimension', async () => {
      const svc = makeService({
        CLIP_ENABLED: 'true',
        REPLICATE_API_TOKEN: 'r8_test_token',
      });
      global.fetch = jest.fn(() =>
        okResponse({
          id: 'pred_5',
          status: 'succeeded',
          // 512 is the old ViT-B/32 dim — must be rejected now that
          // we expect 768 from ViT-L/14. Catches accidental model
          // downgrade.
          output: { embedding: new Array(512).fill(0.3) },
        }),
      ) as unknown as typeof global.fetch;

      const result = await svc.embedFromUrl('https://example.com/img.jpg');
      expect(result).toBeNull();
    });
  });

  describe('helper methods (unchanged math, regression guard)', () => {
    it('cosine returns dot product for L2-normalized vectors', () => {
      const svc = makeService({});
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([1, 0, 0]);
      expect(svc.cosine(a, b)).toBeCloseTo(1.0);
      const c = new Float32Array([0, 1, 0]);
      expect(svc.cosine(a, c)).toBeCloseTo(0.0);
    });

    it('cosine returns -1 on dim mismatch', () => {
      const svc = makeService({});
      const a = new Float32Array([1, 0, 0]);
      const b = new Float32Array([1, 0]);
      expect(svc.cosine(a, b)).toBe(-1);
    });

    it('serialize/deserialize round-trips a 768-dim vector', () => {
      const svc = makeService({});
      const v = new Float32Array(768);
      for (let i = 0; i < 768; i++) v[i] = Math.sin(i);
      const buf = svc.serializeEmbedding(v);
      expect(buf.byteLength).toBe(768 * 4);
      const back = svc.deserializeEmbedding(buf);
      expect(back).not.toBeNull();
      expect(back?.length).toBe(768);
      // Float32 equality should be exact for round-trip of the same bytes.
      for (let i = 0; i < 768; i++) expect(back![i]).toBe(v[i]);
    });

    it('deserialize returns null on size mismatch', () => {
      const svc = makeService({});
      expect(svc.deserializeEmbedding(null)).toBeNull();
      expect(svc.deserializeEmbedding(Buffer.alloc(100))).toBeNull();
    });
  });
});
