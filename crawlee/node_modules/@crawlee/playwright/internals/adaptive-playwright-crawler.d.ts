import type { Log } from '@apify/log';
import { type LoadedContext, type RouterHandler } from '@crawlee/browser';
import type { RestrictedCrawlingContext, StatisticState, StatisticsOptions, GetUserDataFromRequest, RouterRoutes } from '@crawlee/core';
import { Configuration, RequestHandlerResult, Statistics } from '@crawlee/core';
import type { Awaitable, Dictionary } from '@crawlee/types';
import { type CheerioRoot } from '@crawlee/utils';
import { type Cheerio, type Element } from 'cheerio';
import type { PlaywrightCrawlerOptions, PlaywrightCrawlingContext } from './playwright-crawler';
import { PlaywrightCrawler } from './playwright-crawler';
import { RenderingTypePredictor } from './utils/rendering-type-prediction';
type Result<TResult> = {
    result: TResult;
    ok: true;
    logs?: LogProxyCall[];
} | {
    error: unknown;
    ok: false;
    logs?: LogProxyCall[];
};
interface AdaptivePlaywrightCrawlerStatisticState extends StatisticState {
    httpOnlyRequestHandlerRuns?: number;
    browserRequestHandlerRuns?: number;
    renderingTypeMispredictions?: number;
}
declare class AdaptivePlaywrightCrawlerStatistics extends Statistics {
    state: AdaptivePlaywrightCrawlerStatisticState;
    constructor(options?: StatisticsOptions);
    reset(): void;
    protected _maybeLoadStatistics(): Promise<void>;
    trackHttpOnlyRequestHandlerRun(): void;
    trackBrowserRequestHandlerRun(): void;
    trackRenderingTypeMisprediction(): void;
}
export interface AdaptivePlaywrightCrawlerContext extends RestrictedCrawlingContext {
    /**
     * Wait for an element matching the selector to appear and return a Cheerio object of matched elements.
     * Timeout defaults to 5s.
     */
    querySelector(selector: string, timeoutMs?: number): Promise<Cheerio<Element>>;
    /**
     * Wait for an element matching the selector to appear.
     * Timeout defaults to 5s.
     *
     * **Example usage:**
     * ```ts
     * async requestHandler({ waitForSelector, parseWithCheerio }) {
     *     await waitForSelector('article h1');
     *     const $ = await parseWithCheerio();
     *     const title = $('title').text();
     * });
     * ```
     */
    waitForSelector(selector: string, timeoutMs?: number): Promise<void>;
    /**
     * Returns Cheerio handle for `page.content()`, allowing to work with the data same way as with {@apilink CheerioCrawler}.
     * When provided with the `selector` argument, it will first look for the selector with a 5s timeout.
     *
     * **Example usage:**
     * ```ts
     * async requestHandler({ parseWithCheerio }) {
     *     const $ = await parseWithCheerio();
     *     const title = $('title').text();
     * });
     * ```
     */
    parseWithCheerio(selector?: string, timeoutMs?: number): Promise<CheerioRoot>;
}
export interface AdaptivePlaywrightCrawlerOptions extends Omit<PlaywrightCrawlerOptions, 'requestHandler' | 'handlePageFunction'> {
    /**
     * Function that is called to process each request.
     *
     * The function receives the {@apilink AdaptivePlaywrightCrawlingContext} as an argument, and it must refrain from calling code with side effects,
     * other than the methods of the crawling context. Any other side effects may be invoked repeatedly by the crawler, which can lead to inconsistent results.
     *
     * The function must return a promise, which is then awaited by the crawler.
     *
     * If the function throws an exception, the crawler will try to re-crawl the
     * request later, up to `option.maxRequestRetries` times.
     */
    requestHandler?: (crawlingContext: LoadedContext<AdaptivePlaywrightCrawlerContext>) => Awaitable<void>;
    /**
     * Specifies the frequency of rendering type detection checks - 0.1 means roughly 10% of requests.
     * Defaults to 0.1 (so 10%).
     */
    renderingTypeDetectionRatio?: number;
    /**
     * An optional callback that is called on dataset items found by the request handler in plain HTTP mode.
     * If it returns false, the request is retried in a browser.
     * If no callback is specified, every dataset item is considered valid.
     */
    resultChecker?: (result: RequestHandlerResult) => boolean;
    /**
     * An optional callback used in rendering type detection. On each detection, the result of the plain HTTP run is compared to that of the browser one.
     * If the callback returns true, the results are considered equal and the target site is considered static.
     * If no result comparator is specified, but there is a `resultChecker`, any site where the `resultChecker` returns true is considered static.
     * If neither `resultComparator` nor `resultChecker` are specified, a deep comparison of returned dataset items is used as a default.
     */
    resultComparator?: (resultA: RequestHandlerResult, resultB: RequestHandlerResult) => boolean;
    /**
     * A custom rendering type predictor
     */
    renderingTypePredictor?: Pick<RenderingTypePredictor, 'predict' | 'storeResult'>;
}
declare const proxyLogMethods: readonly ["error", "exception", "softFail", "info", "debug", "perf", "warningOnce", "deprecated"];
type LogProxyCall = [log: Log, method: (typeof proxyLogMethods)[number], ...args: unknown[]];
/**
 * An extension of {@apilink PlaywrightCrawler} that uses a more limited request handler interface so that it is able to switch to HTTP-only crawling when it detects it may be possible.
 *
 * **Example usage:**
 *
 * ```javascript
 * const crawler = new AdaptivePlaywrightCrawler({
 *     renderingTypeDetectionRatio: 0.1,
 *     async requestHandler({ querySelector, pushData, enqueueLinks, request, log }) {
 *         // This function is called to extract data from a single web page
 *         const $prices = await querySelector('span.price')
 *
 *         await pushData({
 *             url: request.url,
 *             price: $prices.filter(':contains("$")').first().text(),
 *         })
 *
 *         await enqueueLinks({ selector: '.pagination a' })
 *     },
 * });
 *
 * await crawler.run([
 *     'http://www.example.com/page-1',
 *     'http://www.example.com/page-2',
 * ]);
 * ```
 *
 * @experimental
 */
export declare class AdaptivePlaywrightCrawler extends PlaywrightCrawler {
    readonly config: Configuration;
    private adaptiveRequestHandler;
    private renderingTypePredictor;
    private resultChecker;
    private resultComparator;
    readonly stats: AdaptivePlaywrightCrawlerStatistics;
    /**
     * Default {@apilink Router} instance that will be used if we don't specify any {@apilink AdaptivePlaywrightCrawlerOptions.requestHandler|`requestHandler`}.
     * See {@apilink Router.addHandler|`router.addHandler()`} and {@apilink Router.addDefaultHandler|`router.addDefaultHandler()`}.
     */
// @ts-ignore optional peer dependency or compatibility with es2022
    readonly router: RouterHandler<AdaptivePlaywrightCrawlerContext>;
    constructor(options?: AdaptivePlaywrightCrawlerOptions, config?: Configuration);
    protected _runRequestHandler(crawlingContext: PlaywrightCrawlingContext): Promise<void>;
    protected commitResult(crawlingContext: PlaywrightCrawlingContext, { calls, keyValueStoreChanges }: RequestHandlerResult): Promise<void>;
    protected allowStorageAccess<R, TArgs extends any[]>(func: (...args: TArgs) => Promise<R>): (...args: TArgs) => Promise<R>;
    protected runRequestHandlerInBrowser(crawlingContext: PlaywrightCrawlingContext): Promise<Result<RequestHandlerResult>>;
    protected runRequestHandlerWithPlainHTTP(crawlingContext: PlaywrightCrawlingContext, oldStateCopy?: Dictionary): Promise<Result<RequestHandlerResult>>;
    private createLogProxy;
}
export declare function createAdaptivePlaywrightRouter<Context extends AdaptivePlaywrightCrawlerContext = AdaptivePlaywrightCrawlerContext, UserData extends Dictionary = GetUserDataFromRequest<Context['request']>>(routes?: RouterRoutes<Context, UserData>): RouterHandler<Context>;
export {};
//# sourceMappingURL=adaptive-playwright-crawler.d.ts.map