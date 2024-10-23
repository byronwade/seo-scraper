import type { Dictionary } from '@crawlee/types';
import type { RequestQueueOperationInfo, RequestProviderOptions } from './request_provider';
import { RequestProvider } from './request_provider';
import { Configuration } from '../configuration';
import type { Request } from '../request';
/**
 * Represents a queue of URLs to crawl, which is used for deep crawling of websites
 * where you start with several URLs and then recursively
 * follow links to other pages. The data structure supports both breadth-first and depth-first crawling orders.
 *
 * Each URL is represented using an instance of the {@apilink Request} class.
 * The queue can only contain unique URLs. More precisely, it can only contain {@apilink Request} instances
 * with distinct `uniqueKey` properties. By default, `uniqueKey` is generated from the URL, but it can also be overridden.
 * To add a single URL multiple times to the queue,
 * corresponding {@apilink Request} objects will need to have different `uniqueKey` properties.
 *
 * Do not instantiate this class directly, use the {@apilink RequestQueue.open} function instead.
 *
 * `RequestQueue` is used by {@apilink BasicCrawler}, {@apilink CheerioCrawler}, {@apilink PuppeteerCrawler}
 * and {@apilink PlaywrightCrawler} as a source of URLs to crawl.
 * Unlike {@apilink RequestList}, `RequestQueue` supports dynamic adding and removing of requests.
 * On the other hand, the queue is not optimized for operations that add or remove a large number of URLs in a batch.
 *
 * **Example usage:**
 *
 * ```javascript
 * // Open the default request queue associated with the crawler run
 * const queue = await RequestQueue.open();
 *
 * // Open a named request queue
 * const queueWithName = await RequestQueue.open('some-name');
 *
 * // Enqueue few requests
 * await queue.addRequest({ url: 'http://example.com/aaa' });
 * await queue.addRequest({ url: 'http://example.com/bbb' });
 * await queue.addRequest({ url: 'http://example.com/foo/bar' }, { forefront: true });
 * ```
 * @category Sources
 */
export declare class RequestQueue extends RequestProvider {
    private _listHeadAndLockPromise;
    /**
     * Returns `true` if there are any requests in the queue that were enqueued to the forefront.
     *
     * Can return false negatives, but never false positives.
     * @returns `true` if there are `forefront` requests in the queue.
     */
    private hasPendingForefrontRequests;
    constructor(options: RequestProviderOptions, config?: Configuration);
    /**
     * Caches information about request to beware of unneeded addRequest() calls.
     */
    protected _cacheRequest(cacheKey: string, queueOperationInfo: RequestQueueOperationInfo): void;
    /**
     * @inheritDoc
     */
    fetchNextRequest<T extends Dictionary = Dictionary>(): Promise<Request<T> | null>;
    /**
     * @inheritDoc
     */
    reclaimRequest(...args: Parameters<RequestProvider['reclaimRequest']>): ReturnType<RequestProvider['reclaimRequest']>;
    protected ensureHeadIsNonEmpty(): Promise<void>;
    private _listHeadAndLock;
    private getOrHydrateRequest;
    private _prolongRequestLock;
    protected _reset(): void;
    protected _maybeAddRequestToQueueHead(): void;
    protected _clearPossibleLocks(): Promise<void>;
    /**
     * @inheritDoc
     */
    static open(...args: Parameters<typeof RequestProvider.open>): Promise<RequestQueue>;
}
//# sourceMappingURL=request_queue_v2.d.ts.map