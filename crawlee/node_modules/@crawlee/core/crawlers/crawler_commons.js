"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RequestHandlerResult = void 0;
const storages_1 = require("../storages");
/**
 * A partial implementation of {@apilink RestrictedCrawlingContext} that stores parameters of calls to context methods for later inspection.
 *
 * @experimental
 */
class RequestHandlerResult {
    constructor(config, crawleeStateKey) {
        Object.defineProperty(this, "config", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: config
        });
        Object.defineProperty(this, "crawleeStateKey", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: crawleeStateKey
        });
        Object.defineProperty(this, "_keyValueStoreChanges", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: {}
        });
        Object.defineProperty(this, "pushDataCalls", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "addRequestsCalls", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "enqueueLinksCalls", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: []
        });
        Object.defineProperty(this, "pushData", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: async (data, datasetIdOrName) => {
                this.pushDataCalls.push([data, datasetIdOrName]);
            }
        });
        Object.defineProperty(this, "enqueueLinks", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: async (options) => {
                this.enqueueLinksCalls.push([options]);
            }
        });
        Object.defineProperty(this, "addRequests", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: async (requests, options = {}) => {
                this.addRequestsCalls.push([requests, options]);
            }
        });
        Object.defineProperty(this, "useState", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: async (defaultValue) => {
                const store = await this.getKeyValueStore(undefined);
                return await store.getAutoSavedValue(this.crawleeStateKey, defaultValue);
            }
        });
        Object.defineProperty(this, "getKeyValueStore", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: async (idOrName) => {
                const store = await storages_1.KeyValueStore.open(idOrName, { config: this.config });
                return {
                    id: this.idOrDefault(idOrName),
                    name: idOrName,
                    getValue: async (key) => this.getKeyValueStoreChangedValue(idOrName, key) ?? (await store.getValue(key)),
                    getAutoSavedValue: async (key, defaultValue = {}) => {
                        let value = this.getKeyValueStoreChangedValue(idOrName, key);
                        if (value === null) {
                            value = (await store.getValue(key)) ?? defaultValue;
                            this.setKeyValueStoreChangedValue(idOrName, key, value);
                        }
                        return value;
                    },
                    setValue: async (key, value, options) => {
                        this.setKeyValueStoreChangedValue(idOrName, key, value, options);
                    },
                };
            }
        });
        Object.defineProperty(this, "idOrDefault", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (idOrName) => idOrName ?? this.config.get('defaultKeyValueStoreId')
        });
        Object.defineProperty(this, "getKeyValueStoreChangedValue", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (idOrName, key) => {
                var _a;
                const id = this.idOrDefault(idOrName);
                (_a = this._keyValueStoreChanges)[id] ?? (_a[id] = {});
                return this.keyValueStoreChanges[id][key]?.changedValue ?? null;
            }
        });
        Object.defineProperty(this, "setKeyValueStoreChangedValue", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: (idOrName, key, changedValue, options) => {
                var _a;
                const id = this.idOrDefault(idOrName);
                (_a = this._keyValueStoreChanges)[id] ?? (_a[id] = {});
                this._keyValueStoreChanges[id][key] = { changedValue, options };
            }
        });
    }
    /**
     * A record of calls to {@apilink RestrictedCrawlingContext.pushData}, {@apilink RestrictedCrawlingContext.addRequests}, {@apilink RestrictedCrawlingContext.enqueueLinks} made by a request handler.
     */
    get calls() {
        return {
            pushData: this.pushDataCalls,
            addRequests: this.addRequestsCalls,
            enqueueLinks: this.enqueueLinksCalls,
        };
    }
    /**
     * A record of changes made to key-value stores by a request handler.
     */
    get keyValueStoreChanges() {
        return this._keyValueStoreChanges;
    }
    /**
     * Items added to datasets by a request handler.
     */
    get datasetItems() {
        return this.pushDataCalls.flatMap(([data, datasetIdOrName]) => (Array.isArray(data) ? data : [data]).map((item) => ({ item, datasetIdOrName })));
    }
    /**
     * URLs enqueued to the request queue by a request handler, either via {@apilink RestrictedCrawlingContext.addRequests} or {@apilink RestrictedCrawlingContext.enqueueLinks}
     */
    get enqueuedUrls() {
        const result = [];
        for (const [options] of this.enqueueLinksCalls) {
            result.push(...(options?.urls?.map((url) => ({ url, label: options?.label })) ?? []));
        }
        for (const [requests] of this.addRequestsCalls) {
            for (const request of requests) {
                if (typeof request === 'object' &&
                    (!('requestsFromUrl' in request) || request.requestsFromUrl !== undefined) &&
                    request.url !== undefined) {
                    result.push({ url: request.url, label: request.label });
                }
                else if (typeof request === 'string') {
                    result.push({ url: request });
                }
            }
        }
        return result;
    }
    /**
     * URL lists enqueued to the request queue by a request handler via {@apilink RestrictedCrawlingContext.addRequests} using the `requestsFromUrl` option.
     */
    get enqueuedUrlLists() {
        const result = [];
        for (const [requests] of this.addRequestsCalls) {
            for (const request of requests) {
                if (typeof request === 'object' &&
                    'requestsFromUrl' in request &&
                    request.requestsFromUrl !== undefined) {
                    result.push({ listUrl: request.requestsFromUrl, label: request.label });
                }
            }
        }
        return result;
    }
}
exports.RequestHandlerResult = RequestHandlerResult;
//# sourceMappingURL=crawler_commons.js.map