"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestProvider = void 0;
const tslib_1 = require("tslib");
const node_util_1 = require("node:util");
const datastructures_1 = require("@apify/datastructures");
const utilities_1 = require("@apify/utilities");
const utils_1 = require("@crawlee/utils");
const ow_1 = tslib_1.__importDefault(require("ow"));
const access_checking_1 = require("./access_checking");
const storage_manager_1 = require("./storage_manager");
const utils_2 = require("./utils");
const configuration_1 = require("../configuration");
const log_1 = require("../log");
const request_1 = require("../request");
class RequestProvider {
    constructor(options, config = configuration_1.Configuration.getGlobalConfig()) {
        Object.defineProperty(this, "config", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: config
        });
        Object.defineProperty(this, "id", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "name", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "timeoutSecs", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 30
        });
        Object.defineProperty(this, "clientKey", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (0, utilities_1.cryptoRandomObjectId)()
        });
        Object.defineProperty(this, "client", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "proxyConfiguration", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "log", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "internalTimeoutMillis", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 5 * 60000
        }); // defaults to 5 minutes, will be overridden by BasicCrawler
        Object.defineProperty(this, "requestLockSecs", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 3 * 60
        }); // defaults to 3 minutes, will be overridden by BasicCrawler
        // We can trust these numbers only in a case that queue is used by a single client.
        // This information is returned by getHead() under the hadMultipleClients property.
        Object.defineProperty(this, "assumedTotalCount", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "assumedHandledCount", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        /**
         * Counts enqueued `forefront` requests. This is used to invalidate the local head cache.
         * We can trust these numbers only in a case that queue is used by a single client.
         *
         * Note that this number does not have to be persisted, as the local head cache is dropped
         * on a migration event.
         */
        Object.defineProperty(this, "assumedForefrontCount", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "initialCount", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        Object.defineProperty(this, "queueHeadIds", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new datastructures_1.ListDictionary()
        });
        Object.defineProperty(this, "requestCache", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "recentlyHandledRequestsCache", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "queuePausedForMigration", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: false
        });
        Object.defineProperty(this, "lastActivity", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Date()
        });
        Object.defineProperty(this, "isFinishedCalledWhileHeadWasNotEmpty", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: 0
        });
        this.id = options.id;
        this.name = options.name;
        this.client = options.client.requestQueue(this.id, {
            clientKey: this.clientKey,
            timeoutSecs: this.timeoutSecs,
        });
        this.proxyConfiguration = options.proxyConfiguration;
        this.requestCache = new datastructures_1.LruCache({ maxLength: options.requestCacheMaxSize });
        this.recentlyHandledRequestsCache = new datastructures_1.LruCache({ maxLength: options.recentlyHandledRequestsMaxSize });
        this.log = log_1.log.child({ prefix: `${options.logPrefix}(${this.id}, ${this.name ?? 'no-name'})` });
        const eventManager = config.getEventManager();
        eventManager.on("migrating" /* EventType.MIGRATING */, async () => {
            this.queuePausedForMigration = true;
        });
    }
    /**
     * Returns an offline approximation of the total number of requests in the queue (i.e. pending + handled).
     *
     * Survives restarts and actor migrations.
     */
    getTotalCount() {
        return this.assumedTotalCount + this.initialCount;
    }
    /**
     * Adds a request to the queue.
     *
     * If a request with the same `uniqueKey` property is already present in the queue,
     * it will not be updated. You can find out whether this happened from the resulting
     * {@apilink QueueOperationInfo} object.
     *
     * To add multiple requests to the queue by extracting links from a webpage,
     * see the {@apilink enqueueLinks} helper function.
     *
     * @param requestLike {@apilink Request} object or vanilla object with request data.
     * Note that the function sets the `uniqueKey` and `id` fields to the passed Request.
     * @param [options] Request queue operation options.
     */
    async addRequest(requestLike, options = {}) {
        (0, access_checking_1.checkStorageAccess)();
        this.lastActivity = new Date();
        (0, ow_1.default)(requestLike, ow_1.default.object);
        (0, ow_1.default)(options, ow_1.default.object.exactShape({
            forefront: ow_1.default.optional.boolean,
        }));
        const { forefront = false } = options;
        if ('requestsFromUrl' in requestLike) {
            const requests = await this._fetchRequestsFromUrl(requestLike);
            const processedRequests = await this._addFetchedRequests(requestLike, requests, options);
            return processedRequests[0];
        }
        (0, ow_1.default)(requestLike, ow_1.default.object.partialShape({
            url: ow_1.default.string,
            id: ow_1.default.undefined,
        }));
        const request = requestLike instanceof request_1.Request ? requestLike : new request_1.Request(requestLike);
        const cacheKey = (0, utils_2.getRequestId)(request.uniqueKey);
        const cachedInfo = this.requestCache.get(cacheKey);
        if (cachedInfo) {
            request.id = cachedInfo.id;
            return {
                wasAlreadyPresent: true,
                // We may assume that if request is in local cache then also the information if the
                // request was already handled is there because just one client should be using one queue.
                wasAlreadyHandled: cachedInfo.isHandled,
                requestId: cachedInfo.id,
                uniqueKey: cachedInfo.uniqueKey,
            };
        }
        const queueOperationInfo = (await this.client.addRequest(request, { forefront }));
        queueOperationInfo.uniqueKey = request.uniqueKey;
        const { requestId, wasAlreadyPresent } = queueOperationInfo;
        this._cacheRequest(cacheKey, queueOperationInfo);
        if (!wasAlreadyPresent && !this.recentlyHandledRequestsCache.get(requestId)) {
            this.assumedTotalCount++;
            this.assumedForefrontCount += forefront ? 1 : 0;
            // Performance optimization: add request straight to head if possible
            this._maybeAddRequestToQueueHead(requestId, forefront);
        }
        return queueOperationInfo;
    }
    /**
     * Adds requests to the queue in batches of 25. This method will wait till all the requests are added
     * to the queue before resolving. You should prefer using `queue.addRequestsBatched()` or `crawler.addRequests()`
     * if you don't want to block the processing, as those methods will only wait for the initial 1000 requests,
     * start processing right after that happens, and continue adding more in the background.
     *
     * If a request passed in is already present due to its `uniqueKey` property being the same,
     * it will not be updated. You can find out whether this happened by finding the request in the resulting
     * {@apilink BatchAddRequestsResult} object.
     *
     * @param requestsLike {@apilink Request} objects or vanilla objects with request data.
     * Note that the function sets the `uniqueKey` and `id` fields to the passed requests if missing.
     * @param [options] Request queue operation options.
     */
    async addRequests(requestsLike, options = {}) {
        (0, access_checking_1.checkStorageAccess)();
        this.lastActivity = new Date();
        (0, ow_1.default)(requestsLike, ow_1.default.array);
        (0, ow_1.default)(options, ow_1.default.object.exactShape({
            forefront: ow_1.default.optional.boolean,
            cache: ow_1.default.optional.boolean,
        }));
        const { forefront = false, cache = true } = options;
        const uniqueKeyToCacheKey = new Map();
        const getCachedRequestId = (uniqueKey) => {
            const cached = uniqueKeyToCacheKey.get(uniqueKey);
            if (cached)
                return cached;
            const newCacheKey = (0, utils_2.getRequestId)(uniqueKey);
            uniqueKeyToCacheKey.set(uniqueKey, newCacheKey);
            return newCacheKey;
        };
        const results = {
            processedRequests: [],
            unprocessedRequests: [],
        };
        for (const requestLike of requestsLike) {
            if ('requestsFromUrl' in requestLike) {
                const requests = await this._fetchRequestsFromUrl(requestLike);
                await this._addFetchedRequests(requestLike, requests, options);
            }
        }
        const requests = requestsLike
            .filter((requestLike) => !('requestsFromUrl' in requestLike))
            .map((requestLike) => {
            return requestLike instanceof request_1.Request ? requestLike : new request_1.Request(requestLike);
        });
        const requestsToAdd = new Map();
        for (const request of requests) {
            const cacheKey = getCachedRequestId(request.uniqueKey);
            const cachedInfo = this.requestCache.get(cacheKey);
            if (cachedInfo) {
                request.id = cachedInfo.id;
                results.processedRequests.push({
                    wasAlreadyPresent: true,
                    // We may assume that if request is in local cache then also the information if the
                    // request was already handled is there because just one client should be using one queue.
                    wasAlreadyHandled: cachedInfo.isHandled,
                    requestId: cachedInfo.id,
                    uniqueKey: cachedInfo.uniqueKey,
                });
            }
            else if (!requestsToAdd.has(request.uniqueKey)) {
                requestsToAdd.set(request.uniqueKey, request);
            }
        }
        // Early exit if all provided requests were already added
        if (!requestsToAdd.size) {
            return results;
        }
        const apiResults = await this.client.batchAddRequests([...requestsToAdd.values()], { forefront });
        // Report unprocessed requests
        results.unprocessedRequests = apiResults.unprocessedRequests;
        // Add all new requests to the queue head
        for (const newRequest of apiResults.processedRequests) {
            // Add the new request to the processed list
            results.processedRequests.push(newRequest);
            const cacheKey = getCachedRequestId(newRequest.uniqueKey);
            const { requestId, wasAlreadyPresent } = newRequest;
            if (cache) {
                this._cacheRequest(cacheKey, newRequest);
            }
            if (!wasAlreadyPresent && !this.recentlyHandledRequestsCache.get(requestId)) {
                this.assumedTotalCount++;
                this.assumedForefrontCount += forefront ? 1 : 0;
                // Performance optimization: add request straight to head if possible
                this._maybeAddRequestToQueueHead(requestId, forefront);
            }
        }
        return results;
    }
    /**
     * Adds requests to the queue in batches. By default, it will resolve after the initial batch is added, and continue
     * adding the rest in the background. You can configure the batch size via `batchSize` option and the sleep time in between
     * the batches via `waitBetweenBatchesMillis`. If you want to wait for all batches to be added to the queue, you can use
     * the `waitForAllRequestsToBeAdded` promise you get in the response object.
     *
     * @param requests The requests to add
     * @param options Options for the request queue
     */
    async addRequestsBatched(requests, options = {}) {
        (0, access_checking_1.checkStorageAccess)();
        this.lastActivity = new Date();
        (0, ow_1.default)(options, ow_1.default.object.exactShape({
            forefront: ow_1.default.optional.boolean,
            waitForAllRequestsToBeAdded: ow_1.default.optional.boolean,
            batchSize: ow_1.default.optional.number,
            waitBetweenBatchesMillis: ow_1.default.optional.number,
        }));
        // The `requests` array can be huge, and `ow` is very slow for anything more complex.
        // This explicit iteration takes a few milliseconds, while the ow check can take tens of seconds.
        // ow(requests, ow.array.ofType(ow.any(
        //     ow.string,
        //     ow.object.partialShape({ url: ow.string, id: ow.undefined }),
        //     ow.object.partialShape({ requestsFromUrl: ow.string, regex: ow.optional.regExp }),
        // )));
        for (const request of requests) {
            if (typeof request === 'string') {
                continue;
            }
            if (typeof request === 'object' && request !== null) {
                if (typeof request.url === 'string' && typeof request.id === 'undefined') {
                    continue;
                }
                if (typeof request.requestsFromUrl === 'string') {
                    continue;
                }
            }
            throw new Error(`Request options are not valid, provide either a URL or an object with 'url' property (but without 'id' property), or an object with 'requestsFromUrl' property. Input: ${(0, node_util_1.inspect)(request)}`);
        }
        const { batchSize = 1000, waitBetweenBatchesMillis = 1000 } = options;
        const sources = [];
        for (const opts of requests) {
            if (opts && typeof opts === 'object' && 'requestsFromUrl' in opts) {
                await this.addRequest(opts, { forefront: options.forefront });
            }
            else {
                sources.push(typeof opts === 'string' ? { url: opts } : opts);
            }
        }
        const attemptToAddToQueueAndAddAnyUnprocessed = async (providedRequests, cache = true) => {
            const resultsToReturn = [];
            const apiResult = await this.addRequests(providedRequests, { forefront: options.forefront, cache });
            resultsToReturn.push(...apiResult.processedRequests);
            if (apiResult.unprocessedRequests.length) {
                await (0, utils_1.sleep)(waitBetweenBatchesMillis);
                resultsToReturn.push(...(await attemptToAddToQueueAndAddAnyUnprocessed(providedRequests.filter((r) => !apiResult.processedRequests.some((pr) => pr.uniqueKey === r.uniqueKey)), false)));
            }
            return resultsToReturn;
        };
        const initialChunk = sources.splice(0, batchSize);
        // Add initial batch of `batchSize` to process them right away
        const addedRequests = await attemptToAddToQueueAndAddAnyUnprocessed(initialChunk);
        // If we have no more requests to add, return early
        if (!sources.length) {
            return {
                addedRequests,
                waitForAllRequestsToBeAdded: Promise.resolve([]),
            };
        }
        // eslint-disable-next-line no-async-promise-executor
        const promise = new Promise(async (resolve) => {
            const chunks = (0, utils_1.chunk)(sources, batchSize);
            const finalAddedRequests = [];
            for (const requestChunk of chunks) {
                finalAddedRequests.push(...(await attemptToAddToQueueAndAddAnyUnprocessed(requestChunk, false)));
                await (0, utils_1.sleep)(waitBetweenBatchesMillis);
            }
            resolve(finalAddedRequests);
        });
        // If the user wants to wait for all the requests to be added, we wait for the promise to resolve for them
        if (options.waitForAllRequestsToBeAdded) {
            addedRequests.push(...(await promise));
        }
        return {
            addedRequests,
            waitForAllRequestsToBeAdded: promise,
        };
    }
    /**
     * Gets the request from the queue specified by ID.
     *
     * @param id ID of the request.
     * @returns Returns the request object, or `null` if it was not found.
     */
    async getRequest(id) {
        (0, access_checking_1.checkStorageAccess)();
        (0, ow_1.default)(id, ow_1.default.string);
        const requestOptions = await this.client.getRequest(id);
        if (!requestOptions)
            return null;
        return new request_1.Request(requestOptions);
    }
    /**
     * Marks a request that was previously returned by the
     * {@apilink RequestQueue.fetchNextRequest}
     * function as handled after successful processing.
     * Handled requests will never again be returned by the `fetchNextRequest` function.
     */
    async markRequestHandled(request) {
        (0, access_checking_1.checkStorageAccess)();
        this.lastActivity = new Date();
        (0, ow_1.default)(request, ow_1.default.object.partialShape({
            id: ow_1.default.string,
            uniqueKey: ow_1.default.string,
            handledAt: ow_1.default.optional.string,
        }));
        const handledAt = request.handledAt ?? new Date().toISOString();
        const queueOperationInfo = (await this.client.updateRequest({
            ...request,
            handledAt,
        }));
        request.handledAt = handledAt;
        queueOperationInfo.uniqueKey = request.uniqueKey;
        this.recentlyHandledRequestsCache.add(request.id, true);
        if (!queueOperationInfo.wasAlreadyHandled) {
            this.assumedHandledCount++;
        }
        this.queueHeadIds.remove(request.id);
        this._cacheRequest((0, utils_2.getRequestId)(request.uniqueKey), queueOperationInfo);
        return queueOperationInfo;
    }
    /**
     * Reclaims a failed request back to the queue, so that it can be returned for processing later again
     * by another call to {@apilink RequestQueue.fetchNextRequest}.
     * The request record in the queue is updated using the provided `request` parameter.
     * For example, this lets you store the number of retries or error messages for the request.
     */
    async reclaimRequest(request, options = {}) {
        (0, access_checking_1.checkStorageAccess)();
        this.lastActivity = new Date();
        (0, ow_1.default)(request, ow_1.default.object.partialShape({
            id: ow_1.default.string,
            uniqueKey: ow_1.default.string,
        }));
        (0, ow_1.default)(options, ow_1.default.object.exactShape({
            forefront: ow_1.default.optional.boolean,
        }));
        const { forefront = false } = options;
        // TODO: If request hasn't been changed since the last getRequest(),
        //   we don't need to call updateRequest() and thus improve performance.
        const queueOperationInfo = (await this.client.updateRequest(request, {
            forefront,
        }));
        queueOperationInfo.uniqueKey = request.uniqueKey;
        this.assumedForefrontCount += forefront ? 1 : 0;
        this._cacheRequest((0, utils_2.getRequestId)(request.uniqueKey), queueOperationInfo);
        return queueOperationInfo;
    }
    /**
     * Resolves to `true` if the next call to {@apilink RequestQueue.fetchNextRequest}
     * would return `null`, otherwise it resolves to `false`.
     * Note that even if the queue is empty, there might be some pending requests currently being processed.
     * If you need to ensure that there is no activity in the queue, use {@apilink RequestQueue.isFinished}.
     */
    async isEmpty() {
        await this.ensureHeadIsNonEmpty();
        return this.queueHeadIds.length() === 0;
    }
    /**
     * Resolves to `true` if all requests were already handled and there are no more left.
     * Due to the nature of distributed storage used by the queue,
     * the function might occasionally return a false negative,
     * but it will never return a false positive.
     */
    async isFinished() {
        // TODO: once/if we figure out why sometimes request queues get stuck (if it's even request queues), remove this once and for all :)
        if (Date.now() - this.lastActivity.getTime() > this.internalTimeoutMillis) {
            const maybeHead = await this.client.listHead({ limit: 1 });
            const request = maybeHead.items[0] ? await this.client.getRequest(maybeHead.items[0].id) : null;
            const message = `The request queue hasn't had activity for ${this.internalTimeoutMillis / 1000}s, resetting internal state.`;
            this.log.warning(message, {
                queueHeadIdsPending: this.queueHeadIds.length(),
                hasPendingOrLockedRequests: maybeHead.items.length > 0,
                pendingRequestIsLocked: request?.lockExpiresAt,
            });
            this.queueHeadIds.clear();
            // This cache may be the bane of our existence, but it's still required for v1...
            this.recentlyHandledRequestsCache.clear();
        }
        if (this.queueHeadIds.length() > 0) {
            this.log.debug('There are still ids in the queue head that are pending processing', {
                queueHeadIdsPending: this.queueHeadIds.length(),
            });
            return false;
        }
        const currentHead = await this.client.listHead({ limit: 2 });
        if (currentHead.items.length !== 0) {
            // Give users some more concrete info as to why their crawlers seem to be "hanging" doing nothing while we're waiting because the queue is technically
            // not empty. We decided that a queue with elements in its head but that are also locked shouldn't return true in this function.
            // If that ever changes, this function might need a rewrite
            // The `% 25` was absolutely arbitrarily picked. It's just to not spam the logs too much. This is also a very specific path that most crawlers shouldn't hit
            if (++this.isFinishedCalledWhileHeadWasNotEmpty % 25 === 0) {
                const requests = await Promise.all(currentHead.items.map(async (item) => this.client.getRequest(item.id)));
                this.log.info(`Queue head still returned requests that need to be processed (or that are locked by other clients)`, {
                    requests: requests
                        .map((r) => {
                        if (!r) {
                            return null;
                        }
                        return {
                            id: r.id,
                            lockExpiresAt: r.lockExpiresAt,
                            lockedBy: r.lockByClient,
                        };
                    })
                        .filter(Boolean),
                    clientKey: this.clientKey,
                });
            }
            else {
                this.log.debug('Queue head still returned requests that need to be processed (or that are locked by other clients)', {
                    requestIds: currentHead.items.map((item) => item.id),
                });
            }
        }
        return currentHead.items.length === 0;
    }
    _reset() {
        this.lastActivity = new Date();
        this.queueHeadIds.clear();
        this.recentlyHandledRequestsCache.clear();
        this.assumedTotalCount = 0;
        this.assumedHandledCount = 0;
        this.requestCache.clear();
    }
    /**
     * Caches information about request to beware of unneeded addRequest() calls.
     */
    _cacheRequest(cacheKey, queueOperationInfo) {
        // Remove the previous entry, as otherwise our cache will never update 👀
        this.requestCache.remove(cacheKey);
        this.requestCache.add(cacheKey, {
            id: queueOperationInfo.requestId,
            isHandled: queueOperationInfo.wasAlreadyHandled,
            uniqueKey: queueOperationInfo.uniqueKey,
            hydrated: null,
            lockExpiresAt: null,
        });
    }
    /**
     * Adds a request straight to the queueHeadDict, to improve performance.
     */
    _maybeAddRequestToQueueHead(requestId, forefront) {
        if (forefront) {
            this.queueHeadIds.add(requestId, requestId, true);
        }
        else if (this.assumedTotalCount < utils_2.QUERY_HEAD_MIN_LENGTH) {
            this.queueHeadIds.add(requestId, requestId, false);
        }
    }
    /**
     * Removes the queue either from the Apify Cloud storage or from the local database,
     * depending on the mode of operation.
     */
    async drop() {
        (0, access_checking_1.checkStorageAccess)();
        await this.client.delete();
        const manager = storage_manager_1.StorageManager.getManager(this.constructor, this.config);
        manager.closeStorage(this);
    }
    /**
     * Returns the number of handled requests.
     *
     * This function is just a convenient shortcut for:
     *
     * ```javascript
     * const { handledRequestCount } = await queue.getInfo();
     * ```
     */
    async handledCount() {
        // NOTE: We keep this function for compatibility with RequestList.handledCount()
        const { handledRequestCount } = (await this.getInfo()) ?? {};
        return handledRequestCount ?? 0;
    }
    /**
     * Returns an object containing general information about the request queue.
     *
     * The function returns the same object as the Apify API Client's
     * [getQueue](https://docs.apify.com/api/apify-client-js/latest#ApifyClient-requestQueues)
     * function, which in turn calls the
     * [Get request queue](https://apify.com/docs/api/v2#/reference/request-queues/queue/get-request-queue)
     * API endpoint.
     *
     * **Example:**
     * ```
     * {
     *   id: "WkzbQMuFYuamGv3YF",
     *   name: "my-queue",
     *   userId: "wRsJZtadYvn4mBZmm",
     *   createdAt: new Date("2015-12-12T07:34:14.202Z"),
     *   modifiedAt: new Date("2015-12-13T08:36:13.202Z"),
     *   accessedAt: new Date("2015-12-14T08:36:13.202Z"),
     *   totalRequestCount: 25,
     *   handledRequestCount: 5,
     *   pendingRequestCount: 20,
     * }
     * ```
     */
    async getInfo() {
        (0, access_checking_1.checkStorageAccess)();
        return this.client.get();
    }
    /**
     * Fetches URLs from requestsFromUrl and returns them in format of list of requests
     */
    async _fetchRequestsFromUrl(source) {
        const { requestsFromUrl, regex, ...sharedOpts } = source;
        // Download remote resource and parse URLs.
        let urlsArr;
        try {
            urlsArr = await this._downloadListOfUrls({
                url: requestsFromUrl,
                urlRegExp: regex,
                proxyUrl: await this.proxyConfiguration?.newUrl(),
            });
        }
        catch (err) {
            throw new Error(`Cannot fetch a request list from ${requestsFromUrl}: ${err}`);
        }
        // Skip if resource contained no URLs.
        if (!urlsArr.length) {
            this.log.warning('The fetched list contains no valid URLs.', { requestsFromUrl, regex });
            return [];
        }
        return urlsArr.map((url) => ({ url, ...sharedOpts }));
    }
    /**
     * Adds all fetched requests from a URL from a remote resource.
     */
    async _addFetchedRequests(source, fetchedRequests, options) {
        const { requestsFromUrl, regex } = source;
        const { addedRequests } = await this.addRequestsBatched(fetchedRequests, options);
        this.log.info('Fetched and loaded Requests from a remote resource.', {
            requestsFromUrl,
            regex,
            fetchedCount: fetchedRequests.length,
            importedCount: addedRequests.length,
            duplicateCount: fetchedRequests.length - addedRequests.length,
            sample: JSON.stringify(fetchedRequests.slice(0, 5)),
        });
        return addedRequests;
    }
    /**
     * @internal wraps public utility for mocking purposes
     */
    async _downloadListOfUrls(options) {
        return (0, utils_1.downloadListOfUrls)(options);
    }
    /**
     * Opens a request queue and returns a promise resolving to an instance
     * of the {@apilink RequestQueue} class.
     *
     * {@apilink RequestQueue} represents a queue of URLs to crawl, which is stored either on local filesystem or in the cloud.
     * The queue is used for deep crawling of websites, where you start with several URLs and then
     * recursively follow links to other pages. The data structure supports both breadth-first
     * and depth-first crawling orders.
     *
     * For more details and code examples, see the {@apilink RequestQueue} class.
     *
     * @param [queueIdOrName]
     *   ID or name of the request queue to be opened. If `null` or `undefined`,
     *   the function returns the default request queue associated with the crawler run.
     * @param [options] Open Request Queue options.
     */
    static async open(queueIdOrName, options = {}) {
        (0, access_checking_1.checkStorageAccess)();
        (0, ow_1.default)(queueIdOrName, ow_1.default.optional.any(ow_1.default.string, ow_1.default.null));
        (0, ow_1.default)(options, ow_1.default.object.exactShape({
            config: ow_1.default.optional.object.instanceOf(configuration_1.Configuration),
            storageClient: ow_1.default.optional.object,
            proxyConfiguration: ow_1.default.optional.object,
        }));
        options.config ?? (options.config = configuration_1.Configuration.getGlobalConfig());
        options.storageClient ?? (options.storageClient = options.config.getStorageClient());
        await (0, utils_2.purgeDefaultStorages)({ onlyPurgeOnce: true, client: options.storageClient, config: options.config });
        const manager = storage_manager_1.StorageManager.getManager(this, options.config);
        const queue = await manager.openStorage(queueIdOrName, options.storageClient);
        queue.proxyConfiguration = options.proxyConfiguration;
        // eslint-disable-next-line dot-notation
        queue['initialCount'] = (await queue.client.get())?.totalRequestCount ?? 0;
        return queue;
    }
}
exports.RequestProvider = RequestProvider;
//# sourceMappingURL=request_provider.js.map