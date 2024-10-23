"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.withCheckedStorageAccess = exports.checkStorageAccess = void 0;
const async_hooks_1 = require("async_hooks");
const storage = new async_hooks_1.AsyncLocalStorage();
/**
 * Invoke a storage access checker function defined using {@link withCheckedStorageAccess} higher up in the call stack.
 */
const checkStorageAccess = () => storage.getStore()?.checkFunction();
exports.checkStorageAccess = checkStorageAccess;
/**
 * Define a storage access checker function that should be used by calls to {@link checkStorageAccess} in the callbacks.
 *
 * @param checkFunction The check function that should be invoked by {@link checkStorageAccess} calls
 * @param callback The code that should be invoked with the `checkFunction` setting
 */
const withCheckedStorageAccess = async (checkFunction, callback) => storage.run({ checkFunction }, callback);
exports.withCheckedStorageAccess = withCheckedStorageAccess;
//# sourceMappingURL=access_checking.js.map