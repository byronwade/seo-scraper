"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdaptivePlaywrightCrawler = void 0;
exports.createAdaptivePlaywrightRouter = createAdaptivePlaywrightRouter;
const tslib_1 = require("tslib");
const timeout_1 = require("@apify/timeout");
const browser_1 = require("@crawlee/browser");
const core_1 = require("@crawlee/core");
const utils_1 = require("@crawlee/utils");
const cheerio_1 = require("cheerio");
const lodash_isequal_1 = tslib_1.__importDefault(require("lodash.isequal"));
const playwright_crawler_1 = require("./playwright-crawler");
const rendering_type_prediction_1 = require("./utils/rendering-type-prediction");
class AdaptivePlaywrightCrawlerStatistics extends core_1.Statistics {
    constructor(options = {}) {
        super(options);
        Object.defineProperty(this, "state", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: null
        }); // this needs to be assigned for a valid override, but the initialization is done by a reset() call from the parent constructor
        this.reset();
    }
    reset() {
        super.reset();
        this.state.httpOnlyRequestHandlerRuns = 0;
        this.state.browserRequestHandlerRuns = 0;
        this.state.renderingTypeMispredictions = 0;
    }
    async _maybeLoadStatistics() {
        await super._maybeLoadStatistics();
        const savedState = await this.keyValueStore?.getValue(this.persistStateKey);
        if (!savedState) {
            return;
        }
        this.state.httpOnlyRequestHandlerRuns = savedState.httpOnlyRequestHandlerRuns;
        this.state.browserRequestHandlerRuns = savedState.browserRequestHandlerRuns;
        this.state.renderingTypeMispredictions = savedState.renderingTypeMispredictions;
    }
    trackHttpOnlyRequestHandlerRun() {
        var _a;
        (_a = this.state).httpOnlyRequestHandlerRuns ?? (_a.httpOnlyRequestHandlerRuns = 0);
        this.state.httpOnlyRequestHandlerRuns += 1;
    }
    trackBrowserRequestHandlerRun() {
        var _a;
        (_a = this.state).browserRequestHandlerRuns ?? (_a.browserRequestHandlerRuns = 0);
        this.state.browserRequestHandlerRuns += 1;
    }
    trackRenderingTypeMisprediction() {
        var _a;
        (_a = this.state).renderingTypeMispredictions ?? (_a.renderingTypeMispredictions = 0);
        this.state.renderingTypeMispredictions += 1;
    }
}
const proxyLogMethods = [
    'error',
    'exception',
    'softFail',
    'info',
    'debug',
    'perf',
    'warningOnce',
    'deprecated',
];
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
class AdaptivePlaywrightCrawler extends playwright_crawler_1.PlaywrightCrawler {
    constructor(options = {}, config = core_1.Configuration.getGlobalConfig()) {
        const { requestHandler, renderingTypeDetectionRatio = 0.1, renderingTypePredictor, resultChecker, resultComparator, statisticsOptions, ...rest } = options;
        super(rest, config);
        Object.defineProperty(this, "config", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: config
        });
        Object.defineProperty(this, "adaptiveRequestHandler", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "renderingTypePredictor", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "resultChecker", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "resultComparator", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "stats", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        /**
         * Default {@apilink Router} instance that will be used if we don't specify any {@apilink AdaptivePlaywrightCrawlerOptions.requestHandler|`requestHandler`}.
         * See {@apilink Router.addHandler|`router.addHandler()`} and {@apilink Router.addDefaultHandler|`router.addDefaultHandler()`}.
         */
        // @ts-ignore
        Object.defineProperty(this, "router", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: core_1.Router.create()
        });
        this.adaptiveRequestHandler = requestHandler ?? this.router;
        this.renderingTypePredictor =
            renderingTypePredictor ?? new rendering_type_prediction_1.RenderingTypePredictor({ detectionRatio: renderingTypeDetectionRatio });
        this.resultChecker = resultChecker ?? (() => true);
        if (resultComparator !== undefined) {
            this.resultComparator = resultComparator;
        }
        else if (resultChecker !== undefined) {
            this.resultComparator = (resultA, resultB) => this.resultChecker(resultA) && this.resultChecker(resultB);
        }
        else {
            this.resultComparator = (resultA, resultB) => {
                return (resultA.datasetItems.length === resultB.datasetItems.length &&
                    resultA.datasetItems.every((itemA, i) => {
                        const itemB = resultB.datasetItems[i];
                        return (0, lodash_isequal_1.default)(itemA, itemB);
                    }));
            };
        }
        this.stats = new AdaptivePlaywrightCrawlerStatistics({
            logMessage: `${this.log.getOptions().prefix} request statistics:`,
            config,
            ...statisticsOptions,
        });
    }
    async _runRequestHandler(crawlingContext) {
        const url = new URL(crawlingContext.request.loadedUrl ?? crawlingContext.request.url);
        const renderingTypePrediction = this.renderingTypePredictor.predict(url, crawlingContext.request.label);
        const shouldDetectRenderingType = Math.random() < renderingTypePrediction.detectionProbabilityRecommendation;
        if (!shouldDetectRenderingType) {
            crawlingContext.log.debug(`Predicted rendering type ${renderingTypePrediction.renderingType} for ${crawlingContext.request.url}`);
        }
        if (renderingTypePrediction.renderingType === 'static' && !shouldDetectRenderingType) {
            crawlingContext.log.debug(`Running HTTP-only request handler for ${crawlingContext.request.url}`);
            this.stats.trackHttpOnlyRequestHandlerRun();
            const plainHTTPRun = await this.runRequestHandlerWithPlainHTTP(crawlingContext);
            if (plainHTTPRun.ok && this.resultChecker(plainHTTPRun.result)) {
                crawlingContext.log.debug(`HTTP-only request handler succeeded for ${crawlingContext.request.url}`);
                plainHTTPRun.logs?.forEach(([log, method, ...args]) => log[method](...args));
                await this.commitResult(crawlingContext, plainHTTPRun.result);
                return;
            }
            if (!plainHTTPRun.ok) {
                crawlingContext.log.exception(plainHTTPRun.error, `HTTP-only request handler failed for ${crawlingContext.request.url}`);
            }
            else {
                crawlingContext.log.warning(`HTTP-only request handler returned a suspicious result for ${crawlingContext.request.url}`);
                this.stats.trackRenderingTypeMisprediction();
            }
        }
        crawlingContext.log.debug(`Running browser request handler for ${crawlingContext.request.url}`);
        this.stats.trackBrowserRequestHandlerRun();
        // Keep a copy of the `useState` value, we need to use the old state when trying the HTTP handler to have
        // the same outcome. We don't need to care about its persistence, since we only run this for detection
        // purposes. We read the value directly instead of using `useState` so there are no side effects.
        const kvs = await crawlingContext.getKeyValueStore();
        const oldState = await kvs.getValue(AdaptivePlaywrightCrawler.CRAWLEE_STATE_KEY);
        const oldStateCopy = JSON.parse(JSON.stringify(oldState));
        const browserRun = await this.runRequestHandlerInBrowser(crawlingContext);
        if (!browserRun.ok) {
            throw browserRun.error;
        }
        await this.commitResult(crawlingContext, browserRun.result);
        if (shouldDetectRenderingType) {
            crawlingContext.log.debug(`Detecting rendering type for ${crawlingContext.request.url}`);
            const plainHTTPRun = await this.runRequestHandlerWithPlainHTTP(crawlingContext, oldStateCopy);
            const detectionResult = (() => {
                if (!plainHTTPRun.ok) {
                    return 'clientOnly';
                }
                if (this.resultComparator(plainHTTPRun.result, browserRun.result)) {
                    return 'static';
                }
                return 'clientOnly';
            })();
            crawlingContext.log.debug(`Detected rendering type ${detectionResult} for ${crawlingContext.request.url}`);
            this.renderingTypePredictor.storeResult(url, crawlingContext.request.label, detectionResult);
        }
    }
    async commitResult(crawlingContext, { calls, keyValueStoreChanges }) {
        await Promise.all([
            ...calls.pushData.map(async (params) => crawlingContext.pushData(...params)),
            ...calls.enqueueLinks.map(async (params) => await crawlingContext.enqueueLinks(...params)),
            ...calls.addRequests.map(async (params) => crawlingContext.addRequests(...params)),
            ...Object.entries(keyValueStoreChanges).map(async ([storeIdOrName, changes]) => {
                const store = await crawlingContext.getKeyValueStore(storeIdOrName);
                await Promise.all(Object.entries(changes).map(async ([key, { changedValue, options }]) => store.setValue(key, changedValue, options)));
            }),
        ]);
    }
    allowStorageAccess(func) {
        return async (...args) => (0, core_1.withCheckedStorageAccess)(() => { }, async () => func(...args));
    }
    async runRequestHandlerInBrowser(crawlingContext) {
        const result = new core_1.RequestHandlerResult(this.config, AdaptivePlaywrightCrawler.CRAWLEE_STATE_KEY);
        try {
            await super._runRequestHandler.call(new Proxy(this, {
                get: (target, propertyName, receiver) => {
                    if (propertyName === 'userProvidedRequestHandler') {
                        return async (playwrightContext) => (0, core_1.withCheckedStorageAccess)(() => {
                            throw new Error('Directly accessing storage in a request handler is not allowed in AdaptivePlaywrightCrawler');
                        }, () => this.adaptiveRequestHandler({
                            id: crawlingContext.id,
                            session: crawlingContext.session,
                            proxyInfo: crawlingContext.proxyInfo,
                            request: crawlingContext.request,
                            log: crawlingContext.log,
                            querySelector: async (selector, timeoutMs = 5000) => {
                                const locator = playwrightContext.page.locator(selector).first();
                                await locator.waitFor({ timeout: timeoutMs, state: 'attached' });
                                const $ = await playwrightContext.parseWithCheerio();
                                return $(selector);
                            },
                            async waitForSelector(selector, timeoutMs = 5000) {
                                const locator = playwrightContext.page.locator(selector).first();
                                await locator.waitFor({ timeout: timeoutMs, state: 'attached' });
                            },
                            async parseWithCheerio(selector, timeoutMs = 5000) {
                                if (selector) {
                                    const locator = playwrightContext.page.locator(selector).first();
                                    await locator.waitFor({ timeout: timeoutMs, state: 'attached' });
                                }
                                return playwrightContext.parseWithCheerio();
                            },
                            async enqueueLinks(options = {}, timeoutMs = 5000) {
                                const selector = options.selector ?? 'a';
                                const locator = playwrightContext.page.locator(selector).first();
                                await locator.waitFor({ timeout: timeoutMs, state: 'attached' });
                                const urls = await (0, browser_1.extractUrlsFromPage)(playwrightContext.page, selector, options.baseUrl ??
                                    playwrightContext.request.loadedUrl ??
                                    playwrightContext.request.url);
                                await result.enqueueLinks({ ...options, urls });
                            },
                            addRequests: result.addRequests,
                            pushData: result.pushData,
                            useState: this.allowStorageAccess(result.useState),
                            getKeyValueStore: this.allowStorageAccess(result.getKeyValueStore),
                        }));
                    }
                    return Reflect.get(target, propertyName, receiver);
                },
            }), crawlingContext);
            return { result, ok: true };
        }
        catch (error) {
            return { error, ok: false };
        }
    }
    async runRequestHandlerWithPlainHTTP(crawlingContext, oldStateCopy) {
        const result = new core_1.RequestHandlerResult(this.config, AdaptivePlaywrightCrawler.CRAWLEE_STATE_KEY);
        const logs = [];
        const response = await crawlingContext.sendRequest({});
        const loadedUrl = response.url;
        crawlingContext.request.loadedUrl = loadedUrl;
        const $ = (0, cheerio_1.load)(response.body);
        try {
            await (0, core_1.withCheckedStorageAccess)(() => {
                throw new Error('Directly accessing storage in a request handler is not allowed in AdaptivePlaywrightCrawler');
            }, async () => (0, timeout_1.addTimeoutToPromise)(async () => this.adaptiveRequestHandler({
                id: crawlingContext.id,
                session: crawlingContext.session,
                proxyInfo: crawlingContext.proxyInfo,
                request: crawlingContext.request,
                log: this.createLogProxy(crawlingContext.log, logs),
                async querySelector(selector, _timeoutMs) {
                    return $(selector);
                },
                async waitForSelector(selector, _timeoutMs) {
                    if ($(selector).get().length === 0) {
                        throw new Error(`Selector '${selector}' not found.`);
                    }
                },
                async parseWithCheerio(selector, _timeoutMs) {
                    if (selector && $(selector).get().length === 0) {
                        throw new Error(`Selector '${selector}' not found.`);
                    }
                    return $;
                },
                async enqueueLinks(options = {}) {
                    const urls = (0, utils_1.extractUrlsFromCheerio)($, options.selector, options.baseUrl ?? loadedUrl);
                    await result.enqueueLinks({ ...options, urls });
                },
                addRequests: result.addRequests,
                pushData: result.pushData,
                useState: async (defaultValue) => {
                    // return the old state before the browser handler was executed
                    // when rerunning the handler via HTTP for detection
                    if (oldStateCopy !== undefined) {
                        return oldStateCopy ?? defaultValue; // fallback to the default for `null`
                    }
                    return this.allowStorageAccess(result.useState)(defaultValue);
                },
                getKeyValueStore: this.allowStorageAccess(result.getKeyValueStore),
            }), this.requestHandlerTimeoutInnerMillis, 'Request handler timed out'));
            return { result, logs, ok: true };
        }
        catch (error) {
            return { error, logs, ok: false };
        }
    }
    createLogProxy(log, logs) {
        return new Proxy(log, {
            get(target, propertyName, receiver) {
                if (proxyLogMethods.includes(propertyName)) {
                    return (...args) => {
                        logs.push([target, propertyName, ...args]);
                    };
                }
                return Reflect.get(target, propertyName, receiver);
            },
        });
    }
}
exports.AdaptivePlaywrightCrawler = AdaptivePlaywrightCrawler;
function createAdaptivePlaywrightRouter(routes) {
    return core_1.Router.create(routes);
}
//# sourceMappingURL=adaptive-playwright-crawler.js.map