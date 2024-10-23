"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryAbsoluteURL = void 0;
exports.updateEnqueueLinksPatternCache = updateEnqueueLinksPatternCache;
exports.constructRegExpObjectsFromPseudoUrls = constructRegExpObjectsFromPseudoUrls;
exports.constructGlobObjectsFromGlobs = constructGlobObjectsFromGlobs;
exports.validateGlobPattern = validateGlobPattern;
exports.constructRegExpObjectsFromRegExps = constructRegExpObjectsFromRegExps;
exports.createRequests = createRequests;
exports.filterRequestsByPatterns = filterRequestsByPatterns;
exports.createRequestOptions = createRequestOptions;
const url_1 = require("url");
const pseudo_url_1 = require("@apify/pseudo_url");
const minimatch_1 = require("minimatch");
const request_1 = require("../request");
var utils_1 = require("@crawlee/utils");
Object.defineProperty(exports, "tryAbsoluteURL", { enumerable: true, get: function () { return utils_1.tryAbsoluteURL; } });
const MAX_ENQUEUE_LINKS_CACHE_SIZE = 1000;
/**
 * To enable direct use of the Actor UI `globs`/`regexps`/`pseudoUrls` output while keeping high performance,
 * all the regexps from the output are only constructed once and kept in a cache
 * by the `enqueueLinks()` function.
 * @ignore
 */
const enqueueLinksPatternCache = new Map();
/**
 * @ignore
 */
function updateEnqueueLinksPatternCache(item, pattern) {
    enqueueLinksPatternCache.set(item, pattern);
    if (enqueueLinksPatternCache.size > MAX_ENQUEUE_LINKS_CACHE_SIZE) {
        const key = enqueueLinksPatternCache.keys().next().value;
        enqueueLinksPatternCache.delete(key);
    }
}
/**
 * Helper factory used in the `enqueueLinks()` and enqueueLinksByClickingElements() function
 * to construct RegExps from PseudoUrl strings.
 * @ignore
 */
function constructRegExpObjectsFromPseudoUrls(pseudoUrls) {
    return pseudoUrls.map((item) => {
        // Get pseudoUrl object from cache.
        let regexpObject = enqueueLinksPatternCache.get(item);
        if (regexpObject)
            return regexpObject;
        if (typeof item === 'string') {
            regexpObject = { regexp: (0, pseudo_url_1.purlToRegExp)(item) };
        }
        else {
            const { purl, ...requestOptions } = item;
            regexpObject = { regexp: (0, pseudo_url_1.purlToRegExp)(purl), ...requestOptions };
        }
        updateEnqueueLinksPatternCache(item, regexpObject);
        return regexpObject;
    });
}
/**
 * Helper factory used in the `enqueueLinks()` and enqueueLinksByClickingElements() function
 * to construct Glob objects from Glob pattern strings.
 * @ignore
 */
function constructGlobObjectsFromGlobs(globs) {
    return globs
        .filter((glob) => {
        // Skip possibly nullish, empty strings
        if (!glob) {
            return false;
        }
        if (typeof glob === 'string') {
            return glob.trim().length > 0;
        }
        if (glob.glob) {
            return glob.glob.trim().length > 0;
        }
        return false;
    })
        .map((item) => {
        // Get glob object from cache.
        let globObject = enqueueLinksPatternCache.get(item);
        if (globObject)
            return globObject;
        if (typeof item === 'string') {
            globObject = { glob: validateGlobPattern(item) };
        }
        else {
            const { glob, ...requestOptions } = item;
            globObject = { glob: validateGlobPattern(glob), ...requestOptions };
        }
        updateEnqueueLinksPatternCache(item, globObject);
        return globObject;
    });
}
/**
 * @internal
 */
function validateGlobPattern(glob) {
    const globTrimmed = glob.trim();
    if (globTrimmed.length === 0)
        throw new Error(`Cannot parse Glob pattern '${globTrimmed}': it must be an non-empty string`);
    return globTrimmed;
}
/**
 * Helper factory used in the `enqueueLinks()` and enqueueLinksByClickingElements() function
 * to check RegExps input and return valid RegExps.
 * @ignore
 */
function constructRegExpObjectsFromRegExps(regexps) {
    return regexps.map((item) => {
        // Get regexp object from cache.
        let regexpObject = enqueueLinksPatternCache.get(item);
        if (regexpObject)
            return regexpObject;
        if (item instanceof RegExp) {
            regexpObject = { regexp: item };
        }
        else {
            regexpObject = item;
        }
        updateEnqueueLinksPatternCache(item, regexpObject);
        return regexpObject;
    });
}
/**
 * @ignore
 */
function createRequests(requestOptions, urlPatternObjects, excludePatternObjects = [], strategy) {
    return requestOptions
        .map((opts) => ({ url: typeof opts === 'string' ? opts : opts.url, opts }))
        .filter(({ url }) => {
        return !excludePatternObjects.some((excludePatternObject) => {
            const { regexp, glob } = excludePatternObject;
            return (regexp && url.match(regexp)) || (glob && (0, minimatch_1.minimatch)(url, glob, { nocase: true }));
        });
    })
        .map(({ url, opts }) => {
        if (!urlPatternObjects || !urlPatternObjects.length) {
            return new request_1.Request(typeof opts === 'string' ? { url: opts, enqueueStrategy: strategy } : { ...opts });
        }
        for (const urlPatternObject of urlPatternObjects) {
            const { regexp, glob, ...requestRegExpOptions } = urlPatternObject;
            if ((regexp && url.match(regexp)) || (glob && (0, minimatch_1.minimatch)(url, glob, { nocase: true }))) {
                const request = typeof opts === 'string'
                    ? { url: opts, ...requestRegExpOptions, enqueueStrategy: strategy }
                    : { ...opts, ...requestRegExpOptions, enqueueStrategy: strategy };
                return new request_1.Request(request);
            }
        }
        // didn't match any positive pattern
        return null;
    })
        .filter((request) => request);
}
function filterRequestsByPatterns(requests, patterns) {
    if (!patterns?.length) {
        return requests;
    }
    const filtered = [];
    for (const request of requests) {
        for (const urlPatternObject of patterns) {
            const { regexp, glob } = urlPatternObject;
            if ((regexp && request.url.match(regexp)) || (glob && (0, minimatch_1.minimatch)(request.url, glob, { nocase: true }))) {
                filtered.push(request);
                // Break the pattern loop, as we already matched this request once
                break;
            }
        }
    }
    return filtered;
}
/**
 * @ignore
 */
function createRequestOptions(sources, options = {}) {
    return sources
        .map((src) => typeof src === 'string'
        ? { url: src, enqueueStrategy: options.strategy }
        : { ...src, enqueueStrategy: options.strategy })
        .filter(({ url }) => {
        try {
            return new url_1.URL(url, options.baseUrl).href;
        }
        catch (err) {
            return false;
        }
    })
        .map((requestOptions) => {
        requestOptions.url = new url_1.URL(requestOptions.url, options.baseUrl).href;
        requestOptions.userData ?? (requestOptions.userData = options.userData ?? {});
        if (typeof options.label === 'string') {
            requestOptions.userData = {
                ...requestOptions.userData,
                label: options.label,
            };
        }
        if (options.skipNavigation) {
            requestOptions.skipNavigation = true;
        }
        return requestOptions;
    });
}
//# sourceMappingURL=shared.js.map