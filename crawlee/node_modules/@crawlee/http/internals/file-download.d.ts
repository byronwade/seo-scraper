import type { Dictionary } from '@crawlee/types';
// @ts-ignore optional peer dependency or compatibility with es2022
import type { Request } from 'got-scraping';
import type { ErrorHandler, GetUserDataFromRequest, HttpCrawlerOptions, InternalHttpCrawlingContext, InternalHttpHook, RequestHandler, RouterRoutes } from '../index';
import { HttpCrawler } from '../index';
export type FileDownloadErrorHandler<UserData extends Dictionary = any, // with default to Dictionary we cant use a typed router in untyped crawler
JSONData extends Dictionary = any> = ErrorHandler<FileDownloadCrawlingContext<UserData, JSONData>>;
export type StreamHandlerContext = Omit<FileDownloadCrawlingContext, 'body' | 'response' | 'parseWithCheerio' | 'json' | 'addRequests' | 'contentType'> & {
    stream: Request;
};
type StreamHandler = (context: StreamHandlerContext) => void | Promise<void>;
export type FileDownloadOptions<UserData extends Dictionary = any, // with default to Dictionary we cant use a typed router in untyped crawler
JSONData extends Dictionary = any> = (Omit<HttpCrawlerOptions<FileDownloadCrawlingContext<UserData, JSONData>>, 'requestHandler'> & {
    requestHandler?: never;
    streamHandler?: StreamHandler;
}) | (Omit<HttpCrawlerOptions<FileDownloadCrawlingContext<UserData, JSONData>>, 'requestHandler'> & {
    requestHandler: FileDownloadRequestHandler;
    streamHandler?: never;
});
export type FileDownloadHook<UserData extends Dictionary = any, // with default to Dictionary we cant use a typed router in untyped crawler
JSONData extends Dictionary = any> = InternalHttpHook<FileDownloadCrawlingContext<UserData, JSONData>>;
export interface FileDownloadCrawlingContext<UserData extends Dictionary = any, // with default to Dictionary we cant use a typed router in untyped crawler
JSONData extends Dictionary = any> extends InternalHttpCrawlingContext<UserData, JSONData, FileDownload> {
}
export type FileDownloadRequestHandler<UserData extends Dictionary = any, // with default to Dictionary we cant use a typed router in untyped crawler
JSONData extends Dictionary = any> = RequestHandler<FileDownloadCrawlingContext<UserData, JSONData>>;
/**
 * Provides a framework for downloading files in parallel using plain HTTP requests. The URLs to download are fed either from a static list of URLs or they can be added on the fly from another crawler.
 *
 * Since `FileDownload` uses raw HTTP requests to download the files, it is very fast and bandwidth-efficient.
 * However, it doesn't parse the content - if you need to e.g. extract data from the downloaded files,
 * you might need to use {@apilink CheerioCrawler}, {@apilink PuppeteerCrawler} or {@apilink PlaywrightCrawler} instead.
 *
 * `FileCrawler` downloads each URL using a plain HTTP request and then invokes the user-provided {@apilink FileDownloadOptions.requestHandler} where the user can specify what to do with the downloaded data.
 *
 * The source URLs are represented using {@apilink Request} objects that are fed from {@apilink RequestList} or {@apilink RequestQueue} instances provided by the {@apilink FileDownloadOptions.requestList} or {@apilink FileDownloadOptions.requestQueue} constructor options, respectively.
 *
 * If both {@apilink FileDownloadOptions.requestList} and {@apilink FileDownloadOptions.requestQueue} are used, the instance first processes URLs from the {@apilink RequestList} and automatically enqueues all of them to {@apilink RequestQueue} before it starts their processing. This ensures that a single URL is not crawled multiple times.
 *
 * The crawler finishes when there are no more {@apilink Request} objects to crawl.
 *
 * We can use the `preNavigationHooks` to adjust `gotOptions`:
 *
 * ```
 * preNavigationHooks: [
 *     (crawlingContext, gotOptions) => {
 *         // ...
 *     },
 * ]
 * ```
 *
 * New requests are only dispatched when there is enough free CPU and memory available, using the functionality provided by the {@apilink AutoscaledPool} class. All {@apilink AutoscaledPool} configuration options can be passed to the `autoscaledPoolOptions` parameter of the `FileCrawler` constructor. For user convenience, the `minConcurrency` and `maxConcurrency` {@apilink AutoscaledPool} options are available directly in the `FileCrawler` constructor.
 *
 * ## Example usage
 *
 * ```ts
 * const crawler = new FileDownloader({
 *     requestHandler({ body, request }) {
 *         writeFileSync(request.url.replace(/[^a-z0-9\.]/gi, '_'), body);
 *     },
 * });
 *
 * await crawler.run([
 *     'http://www.example.com/document.pdf',
 *     'http://www.example.com/sound.mp3',
 *     'http://www.example.com/video.mkv',
 * ]);
 * ```
 */
export declare class FileDownload extends HttpCrawler<FileDownloadCrawlingContext> {
    private streamHandler?;
    constructor(options?: FileDownloadOptions);
    protected _runRequestHandler(context: FileDownloadCrawlingContext): Promise<void>;
    private streamRequestHandler;
}
/**
 * Creates new {@apilink Router} instance that works based on request labels.
 * This instance can then serve as a `requestHandler` of your {@apilink FileDownload}.
 * Defaults to the {@apilink FileDownloadCrawlingContext}.
 *
 * > Serves as a shortcut for using `Router.create<FileDownloadCrawlingContext>()`.
 *
 * ```ts
 * import { FileDownload, createFileRouter } from 'crawlee';
 *
 * const router = createFileRouter();
 * router.addHandler('label-a', async (ctx) => {
 *    ctx.log.info('...');
 * });
 * router.addDefaultHandler(async (ctx) => {
 *    ctx.log.info('...');
 * });
 *
 * const crawler = new FileDownload({
 *     requestHandler: router,
 * });
 * await crawler.run();
 * ```
 */
// @ts-ignore optional peer dependency or compatibility with es2022
export declare function createFileRouter<Context extends FileDownloadCrawlingContext = FileDownloadCrawlingContext, UserData extends Dictionary = GetUserDataFromRequest<Context['request']>>(routes?: RouterRoutes<Context, UserData>): import("packages/core/dist/router").RouterHandler<Context>;
export {};
//# sourceMappingURL=file-download.d.ts.map