export type RenderingType = 'clientOnly' | 'static';
type URLComponents = string[];
type FeatureVector = [staticResultsSimilarity: number, clientOnlyResultsSimilarity: number];
export interface RenderingTypePredictorOptions {
    /** A number between 0 and 1 that determines the desired ratio of rendering type detections */
    detectionRatio: number;
}
/**
 * Stores rendering type information for previously crawled URLs and predicts the rendering type for URLs that have yet to be crawled and recommends when rendering type detection should be performed.
 *
 * @experimental
 */
export declare class RenderingTypePredictor {
    private renderingTypeDetectionResults;
    private detectionRatio;
    private logreg;
    constructor({ detectionRatio }: RenderingTypePredictorOptions);
    /**
     * Predict the rendering type for a given URL and request label.
     */
    predict(url: URL, label: string | undefined): {
        renderingType: RenderingType;
        detectionProbabilityRecommendation: number;
    };
    /**
     * Store the rendering type for a given URL and request label. This updates the underlying prediction model, which may be costly.
     */
    storeResult(url: URL, label: string | undefined, renderingType: RenderingType): void;
    private resultCount;
    protected calculateFeatureVector(url: URLComponents, label: string | undefined): FeatureVector;
    protected retrain(): void;
}
export {};
//# sourceMappingURL=rendering-type-prediction.d.ts.map