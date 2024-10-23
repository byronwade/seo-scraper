"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RenderingTypePredictor = void 0;
const tslib_1 = require("tslib");
const ml_logistic_regression_1 = tslib_1.__importDefault(require("ml-logistic-regression"));
const ml_matrix_1 = require("ml-matrix");
const string_comparison_1 = tslib_1.__importDefault(require("string-comparison"));
const urlComponents = (url) => {
    return [url.hostname, ...url.pathname.split('/')];
};
const calculateUrlSimilarity = (a, b) => {
    const values = [];
    if (a[0] !== b[0]) {
        return 0;
    }
    for (let i = 1; i < Math.max(a.length, b.length); i++) {
        values.push(string_comparison_1.default.jaroWinkler.similarity(a[i] ?? '', b[i] ?? '') > 0.8 ? 1 : 0);
    }
    return sum(values) / Math.max(a.length, b.length);
};
const sum = (values) => values.reduce((acc, value) => acc + value);
const mean = (values) => (values.length > 0 ? sum(values) / values.length : undefined);
/**
 * Stores rendering type information for previously crawled URLs and predicts the rendering type for URLs that have yet to be crawled and recommends when rendering type detection should be performed.
 *
 * @experimental
 */
class RenderingTypePredictor {
    constructor({ detectionRatio }) {
        Object.defineProperty(this, "renderingTypeDetectionResults", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: new Map()
        });
        Object.defineProperty(this, "detectionRatio", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        Object.defineProperty(this, "logreg", {
            enumerable: true,
            configurable: true,
            writable: true,
            value: void 0
        });
        this.detectionRatio = detectionRatio;
        this.logreg = new ml_logistic_regression_1.default({ numSteps: 1000, learningRate: 0.05 });
    }
    /**
     * Predict the rendering type for a given URL and request label.
     */
    predict(url, label) {
        if (this.logreg.classifiers.length === 0) {
            return { renderingType: 'clientOnly', detectionProbabilityRecommendation: 1 };
        }
        const urlFeature = new ml_matrix_1.Matrix([this.calculateFeatureVector(urlComponents(url), label)]);
        const [prediction] = this.logreg.predict(urlFeature);
        const scores = [
            this.logreg.classifiers[0].testScores(urlFeature),
            this.logreg.classifiers[1].testScores(urlFeature),
        ];
        return {
            renderingType: prediction === 1 ? 'static' : 'clientOnly',
            detectionProbabilityRecommendation: Math.abs(scores[0] - scores[1]) < 0.1
                ? 1
                : this.detectionRatio * Math.max(1, 5 - this.resultCount(label)),
        };
    }
    /**
     * Store the rendering type for a given URL and request label. This updates the underlying prediction model, which may be costly.
     */
    storeResult(url, label, renderingType) {
        if (!this.renderingTypeDetectionResults.has(renderingType)) {
            this.renderingTypeDetectionResults.set(renderingType, new Map());
        }
        if (!this.renderingTypeDetectionResults.get(renderingType).has(label)) {
            this.renderingTypeDetectionResults.get(renderingType).set(label, []);
        }
        this.renderingTypeDetectionResults.get(renderingType).get(label).push(urlComponents(url));
        this.retrain();
    }
    resultCount(label) {
        return Array.from(this.renderingTypeDetectionResults.values())
            .map((results) => results.get(label)?.length ?? 0)
            .reduce((acc, value) => acc + value, 0);
    }
    calculateFeatureVector(url, label) {
        return [
            mean((this.renderingTypeDetectionResults.get('static')?.get(label) ?? []).map((otherUrl) => calculateUrlSimilarity(url, otherUrl) ?? 0)) ?? 0,
            mean((this.renderingTypeDetectionResults.get('clientOnly')?.get(label) ?? []).map((otherUrl) => calculateUrlSimilarity(url, otherUrl) ?? 0)) ?? 0,
        ];
    }
    retrain() {
        const X = [
            [0, 1],
            [1, 0],
        ];
        const Y = [0, 1];
        for (const [renderingType, urlsByLabel] of this.renderingTypeDetectionResults.entries()) {
            for (const [label, urls] of urlsByLabel) {
                for (const url of urls) {
                    X.push(this.calculateFeatureVector(url, label));
                    Y.push(renderingType === 'static' ? 1 : 0);
                }
            }
        }
        this.logreg.train(new ml_matrix_1.Matrix(X), ml_matrix_1.Matrix.columnVector(Y));
    }
}
exports.RenderingTypePredictor = RenderingTypePredictor;
//# sourceMappingURL=rendering-type-prediction.js.map